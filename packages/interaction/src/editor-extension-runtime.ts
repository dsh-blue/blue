/**
 * Frontend-tree owner for direct editor extensions. It composes passive rows
 * around the Blue-owned editor and contains asynchronous plugin callbacks.
 *
 * @module @dsh-blue/blue-interaction/editor-extension-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  BlueEditorAttachment,
  BlueEditorCompletionItem,
  BlueEditorCompletionRequest,
  BlueEditorExtensionContribution,
  BlueEditorExtensionNode,
  BlueEditorSubmitRequest,
  BlueUiEvent,
  BlueUiNode,
} from '@dsh-blue/blue-api'
import {
  compileBlueEditorShellNode,
  validateBlueUiNode,
  type BlueAutocompleteItem,
  type BlueAutocompleteProvider,
  type BlueAutocompleteSuggestions,
  type BlueComponent,
  type BlueEditor,
  type BlueEditorShellNode,
  type BlueEditorSubmitAttempt,
  type BlueFocusable,
} from '@dsh-blue/blue-core'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubmitTransformation } from './editor-instance.ts'

const MAX_COMPLETIONS = 200
const MAX_COMPLETION_TEXT = 2_000
const MAX_SUBMIT_TEXT = 20_000
const MAX_NOTICE_TEXT = 2_000
const COMPLETION_TIMEOUT_MS = 5_000
const SUBMIT_TIMEOUT_MS = 30_000
const ACTION_TIMEOUT_MS = 30_000
const IMAGE_MARKER = /\[image #\d+\]/gu
const TOKEN_DELIMITERS = new Set([' ', '\t', '"', "'", '='])

interface AttachmentBinding {
  readonly marker: string
  readonly ref: ImageAttachmentRef
  readonly public: BlueEditorAttachment
}

interface PreparedSubmit {
  readonly source: string
  readonly text: string
  readonly attachments: readonly AttachmentBinding[]
}

interface CompletionApplication {
  readonly provider?: BlueAutocompleteProvider
  readonly item: BlueAutocompleteItem
  readonly prefix: string
  readonly insertText?: string
}

interface ExtensionActionBinding {
  readonly entry: BlueEditorExtensionContribution
  readonly actionId: string
}

interface EditorShell {
  readonly component: BlueComponent
  readonly focusTarget: BlueFocusable
  readonly extensionActions: ReadonlyMap<string, ExtensionActionBinding>
}

type CallbackOutcome<Value> =
  | { readonly kind: 'value', readonly value: Value }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'rejected', readonly error: unknown }

type Admission<Value> =
  | { readonly ok: true, readonly value: Value }
  | { readonly ok: false, readonly message: string }

/** Construction dependencies retained only for the input Fiber lifetime. */
export interface EditorExtensionRuntimeOptions {
  readonly ctx: Context
  readonly editor: BlueEditor
  readonly notice: (text: string) => void
  readonly shouldTransformSubmit: (text: string) => boolean
}

function failureMessage(value: unknown, fallback: string): string {
  try {
    if (typeof value !== 'object' || value === null) return fallback
    const descriptor = Object.getOwnPropertyDescriptor(value, 'message')
    return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value.trim() || fallback
      : fallback
  } catch { return fallback }
}

function boundedMessage(value: unknown, fallback: string): string {
  return failureMessage(value, fallback).slice(0, MAX_NOTICE_TEXT)
}

function settleCallback<Value>(
  callback: () => Value | PromiseLike<Value>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<CallbackOutcome<Value>> {
  if (signal.aborted) return Promise.resolve({ kind: 'aborted' })
  return new Promise(resolve => {
    let settled = false
    const finish = (outcome: CallbackOutcome<Value>): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      resolve(outcome)
    }
    const onAbort = (): void => { finish({ kind: 'aborted' }) }
    const timeout = setTimeout(() => { finish({ kind: 'timeout' }) }, timeoutMs)
    signal.addEventListener('abort', onAbort, { once: true })
    void Promise.resolve().then(callback).then(
      value => { finish({ kind: 'value', value }) },
      error => { finish({ kind: 'rejected', error }) },
    )
  })
}

function completionContext(
  line: string,
  cursorCol: number,
  force: boolean | undefined,
): { request: BlueEditorCompletionRequest, prefix: string } | undefined {
  const before = line.slice(0, cursorCol)
  const slash = /^\/(\S*)$/u.exec(before)
  /* v8 ignore next -- the mandatory capture exists for every successful match. */
  if (slash !== null) return { request: { trigger: '/', query: slash[1] ?? '' }, prefix: before }
  let start = 0
  for (let index = before.length - 1; index >= 0; index -= 1) {
    if (TOKEN_DELIMITERS.has(before.charAt(index))) { start = index + 1; break }
  }
  const token = before.slice(start)
  if (token.startsWith('@')) return { request: { trigger: '@', query: token.slice(1) }, prefix: token }
  if (token.startsWith('#')) return { request: { trigger: '#', query: token.slice(1) }, prefix: token }
  return force === true ? { request: { trigger: 'manual', query: token }, prefix: token } : undefined
}

function ownData(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  if (descriptor === undefined || !('value' in descriptor)) throw new Error(`${key} must be an own data property`)
  return descriptor.value
}

function optionalOwnData(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  if (descriptor === undefined) return undefined
  if (!('value' in descriptor)) throw new Error(`${key} must be an own data property`)
  return descriptor.value
}

function completionItems(result: unknown): Admission<readonly BlueEditorCompletionItem[]> {
  try {
    if (!Array.isArray(result) || result.length > MAX_COMPLETIONS) {
      throw new Error(`completion callback must return at most ${String(MAX_COMPLETIONS)} items`)
    }
    const seen = new Set<string>()
    const items = result.map((candidate, index): BlueEditorCompletionItem => {
      if (typeof candidate !== 'object' || candidate === null) throw new Error(`completion item ${String(index)} must be an object`)
      const id = ownData(candidate, 'id')
      const label = ownData(candidate, 'label')
      const insertText = ownData(candidate, 'insertText')
      const detail = optionalOwnData(candidate, 'detail')
      if (typeof id !== 'string' || id.length === 0 || id.length > 128 || seen.has(id)) throw new Error(`completion item ${String(index)} has an invalid or duplicate id`)
      if (typeof label !== 'string' || label.length > MAX_COMPLETION_TEXT) throw new Error(`completion item ${String(index)} has an invalid label`)
      if (typeof insertText !== 'string' || insertText.length > MAX_COMPLETION_TEXT) throw new Error(`completion item ${String(index)} has invalid insertText`)
      if (detail !== undefined && (typeof detail !== 'string' || detail.length > MAX_COMPLETION_TEXT)) throw new Error(`completion item ${String(index)} has an invalid detail`)
      seen.add(id)
      return Object.freeze({ id, label, insertText, ...(detail === undefined ? {} : { detail }) })
    })
    return { ok: true, value: Object.freeze(items) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'completion result was rejected' }
  }
}

function submitValue(result: unknown): Admission<{ readonly text: string }> {
  try {
    if (typeof result !== 'object' || result === null) throw new Error('submit transform must return an object')
    const text = ownData(result, 'text')
    if (typeof text !== 'string' || text.length > MAX_SUBMIT_TEXT) throw new Error(`submit transform text exceeds ${String(MAX_SUBMIT_TEXT)} characters or is invalid`)
    return { ok: true, value: { text } }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'submit transform was rejected' }
  }
}

function isPassive(node: BlueUiNode): node is BlueEditorExtensionNode {
  switch (node.kind) {
    case 'text':
    case 'rich-text':
    case 'fields':
    case 'code':
    case 'diff':
    case 'sections':
    case 'progress':
    case 'spacer':
    case 'divider': return true
    case 'stack': return node.children.every(child => isPassive(child.node))
    case 'surface': return isPassive(node.child) && (node.footer === undefined || isPassive(node.footer))
    default: return false
  }
}

function captureAttachments(ctx: Context, source: string): { text: string, attachments: readonly AttachmentBinding[] } {
  const attachments: AttachmentBinding[] = []
  const text = source.replace(IMAGE_MARKER, marker => {
    const ref = ctx.blueInteractionState.pasteImage.pastedImages.get(marker)
    if (ref === undefined) return marker
    attachments.push(Object.freeze({
      marker,
      ref,
      public: Object.freeze({
        id: String(ref.attachmentId),
        label: ref.name ?? marker,
        mediaType: ref.mediaType,
        size: ref.bytes,
      }),
    }))
    return ''
  }).trim()
  return { text, attachments: Object.freeze(attachments) }
}

/** Mutable delegate whose outer focus identity survives extension refresh. */
export class EditorExtensionRuntime implements BlueFocusable {
  private ownFocused = false
  private columns = 80
  private operationRevision = 0
  private entries: readonly BlueEditorExtensionContribution[] = []
  private component: BlueComponent
  private focusTarget: BlueFocusable
  private shell: EditorShell
  private readonly pending = new Set<AbortController>()
  private readonly eventTails = new Map<string, Promise<void>>()
  private actionGeneration = 0
  private completionLifecycle = new AbortController()
  private prepared: PreparedSubmit | undefined
  private initialized = false
  private readonly unsubscribeExtensions: () => void
  private readonly unsubscribeHost: () => void

  constructor(private readonly options: EditorExtensionRuntimeOptions) {
    this.component = options.editor
    this.focusTarget = options.editor
    this.shell = this.plainShell()
    this.unsubscribeExtensions = options.ctx.blueEditorExtensions.subscribe(entries => {
      this.entries = entries
      if (this.initialized) this.syncExtensions()
    })
    this.unsubscribeHost = options.ctx.blueEditorHost.subscribeEditorState(() => {
      /* v8 ignore else -- the immediate subscription replay intentionally precedes initialization. */
      if (this.initialized) this.syncAutocomplete()
    })
    this.initialized = true
    this.syncExtensions()
  }

  get focused(): boolean { return this.ownFocused }
  set focused(value: boolean) {
    this.ownFocused = value
    this.focusTarget.focused = value
  }

  render(width: number): string[] {
    this.columns = Math.max(1, Number.isFinite(width) ? Math.floor(width) : 1)
    return this.component.render(this.columns)
  }

  handleInput(data: string): void { this.focusTarget.handleInput?.(data) }
  invalidate(): void { this.component.invalidate() }

  /** Consume the successful transform prepared before core cleared the editor. */
  takePrepared(source: string): { readonly text: string, readonly transformation?: SubmitTransformation } | undefined {
    const prepared = this.prepared
    this.prepared = undefined
    if (prepared === undefined || prepared.source !== source) return undefined
    if (prepared.attachments.length === 0) return { text: prepared.text }
    const images = this.options.ctx.blueInteractionState.pasteImage.pastedImages
    const consumed: AttachmentBinding[] = []
    for (const attachment of prepared.attachments) {
      if (images.get(attachment.marker) !== attachment.ref) continue
      images.delete(attachment.marker)
      consumed.push(attachment)
    }
    const blocks: ContentBlock[] = []
    if (prepared.text.length > 0) blocks.push({ type: 'text', text: prepared.text })
    for (const attachment of consumed) blocks.push({ type: 'image', attachment: attachment.ref })
    let rolledBack = false
    return {
      text: prepared.text,
      transformation: {
        blocks,
        rollback: () => {
          if (rolledBack) return
          rolledBack = true
          for (const attachment of consumed) if (!images.has(attachment.marker)) images.set(attachment.marker, attachment.ref)
        },
      },
    }
  }

  dispose(): void {
    this.unsubscribeExtensions()
    this.unsubscribeHost()
    this.abortPending()
    this.options.editor.setSubmitBarrier(undefined)
    this.prepared = undefined
    this.focusTarget.focused = false
  }

  /** Fence extension work whose route or current Agent has retired. */
  invalidateRoute(): void { this.abortPending() }
  invalidateSession(): void { this.abortPending() }

  private syncExtensions(): void {
    this.abortPending()
    this.activateShell(this.compileShell())
    const transforms = this.entries.some(entry => entry.transformSubmit !== undefined)
    this.options.editor.setSubmitBarrier(transforms ? attempt => { this.beginSubmit(attempt) } : undefined)
    this.installCompletionProvider()
    this.options.ctx.blueScreen.requestRender()
  }

  private syncAutocomplete(): void {
    this.completionLifecycle.abort()
    this.completionLifecycle = new AbortController()
    this.installCompletionProvider()
    this.options.ctx.blueScreen.requestRender()
  }

  private abortPending(): void {
    this.actionGeneration += 1
    this.completionLifecycle.abort()
    this.completionLifecycle = new AbortController()
    for (const controller of this.pending) controller.abort()
    this.pending.clear()
    this.eventTails.clear()
    this.prepared = undefined
  }

  private plainShell(): EditorShell {
    return { component: this.options.editor, focusTarget: this.options.editor, extensionActions: new Map() }
  }

  private activateShell(shell: EditorShell): void {
    /* v8 ignore else -- reactivating the same shell needs no focus handoff. */
    if (this.shell !== shell) this.focusTarget.focused = false
    this.shell = shell
    this.component = shell.component
    this.focusTarget = shell.focusTarget
    this.focusTarget.focused = this.ownFocused
    try { this.component.invalidate() } catch { /* renderer invalidation is contained */ }
  }

  private extensionEnvelope(): { readonly node: BlueEditorShellNode, readonly actions: ReadonlyMap<string, ExtensionActionBinding> } {
    const actions = new Map<string, ExtensionActionBinding>()
    const children: Array<{ node: BlueEditorShellNode }> = []
    for (const entry of this.entries) {
      if (entry.before === undefined) continue
      const admitted = validateBlueUiNode(entry.before)
      if (admitted.ok && isPassive(admitted.value)) children.push({ node: admitted.value })
      else this.options.notice(admitted.ok ? 'editor extension before must be passive' : admitted.message.slice(0, MAX_NOTICE_TEXT))
    }
    children.push({ node: { kind: 'editor-control' } })
    for (const [entryIndex, entry] of this.entries.entries()) {
      const rows: BlueUiNode[] = []
      if (typeof entry.hint === 'string') {
        const admitted = validateBlueUiNode({ kind: 'text', content: entry.hint, tone: 'muted' })
        if (admitted.ok) rows.push(admitted.value)
        else this.options.notice(admitted.message.slice(0, MAX_NOTICE_TEXT))
      }
      if (Array.isArray(entry.diagnostics)) for (const diagnostic of entry.diagnostics) {
        try {
          if (typeof diagnostic !== 'object' || diagnostic === null) throw new Error('editor extension diagnostic must be an object')
          const message = ownData(diagnostic, 'message')
          const tone = optionalOwnData(diagnostic, 'tone')
          const admitted = validateBlueUiNode({ kind: 'text', content: message, ...(tone === undefined ? { tone: 'warning' as const } : { tone }) })
          if (!admitted.ok) throw new Error(admitted.message)
          rows.push(admitted.value)
        } catch (error) { this.options.notice(boundedMessage(error, 'editor extension diagnostic was rejected')) }
      }
      if (Array.isArray(entry.actions) && entry.actions.length > 0) {
        const admitted = validateBlueUiNode({ kind: 'actions', id: `extension-actions-${String(entryIndex)}`, items: entry.actions })
        if (admitted.ok) {
          const actionNode = admitted.value as Extract<BlueUiNode, { readonly kind: 'actions' }>
          const items = actionNode.items.map((action, actionIndex) => {
            const id = `extension-${String(entryIndex)}-${String(actionIndex)}`
            actions.set(id, { entry, actionId: action.id })
            return { ...action, id }
          })
          rows.push({ ...actionNode, items })
        } else this.options.notice(admitted.message.slice(0, MAX_NOTICE_TEXT))
      }
      for (const row of rows) children.push({ node: row })
      if (entry.after !== undefined) {
        const admitted = validateBlueUiNode(entry.after)
        if (admitted.ok && isPassive(admitted.value)) children.push({ node: admitted.value })
        else this.options.notice(admitted.ok ? 'editor extension after must be passive' : admitted.message.slice(0, MAX_NOTICE_TEXT))
      }
    }
    return {
      node: children.length === 1
        ? { kind: 'editor-control' }
        : { kind: 'stack', direction: 'column', children },
      actions,
    }
  }

  private compileShell(): EditorShell {
    const envelope = this.extensionEnvelope()
    if (envelope.node.kind === 'editor-control') return this.plainShell()
    let shell!: EditorShell
    const result = compileBlueEditorShellNode(envelope.node, {
      editor: this.options.editor,
      components: this.options.ctx.blueComponents,
      colors: this.options.ctx.blueTheme.colors,
      getViewport: () => ({ columns: this.columns, rows: Number.MAX_SAFE_INTEGER }),
      screenMode: 'main',
      emit: event => { this.dispatchShellEvent(shell, event) },
    })
    if (!result.ok) {
      this.options.notice(result.message.slice(0, MAX_NOTICE_TEXT))
      return this.plainShell()
    }
    shell = {
      component: result.value.component,
      focusTarget: result.value.focusTarget,
      extensionActions: envelope.actions,
    }
    result.value.component.focusEditor()
    return shell
  }

  private dispatchShellEvent(shell: EditorShell, event: BlueUiEvent): void {
    const target = event.kind === 'activate' ? shell.extensionActions.get(event.controlId) : undefined
    if (target === undefined || target.entry.onEvent === undefined) return
    const revision = ++this.operationRevision
    const generation = this.actionGeneration
    const translated: BlueUiEvent = { kind: 'activate', controlId: target.actionId }
    const previous = this.eventTails.get(target.entry.id) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(async () => {
      if (this.actionGeneration !== generation || shell !== this.shell) return
      const controller = new AbortController()
      this.pending.add(controller)
      try {
        const outcome = await settleCallback(
          () => target.entry.onEvent!(translated, { surfaceId: target.entry.id, signal: controller.signal, revision }),
          controller.signal,
          ACTION_TIMEOUT_MS,
        )
        if (shell !== this.shell || controller.signal.aborted || outcome.kind === 'aborted') return
        if (outcome.kind === 'timeout') { controller.abort(); this.options.notice('editor extension action timed out'); return }
        if (outcome.kind === 'rejected') this.options.notice(boundedMessage(outcome.error, 'editor extension action failed'))
      } finally { this.pending.delete(controller) }
    })
    this.eventTails.set(target.entry.id, next)
    const clearTail = (): void => {
      if (this.eventTails.get(target.entry.id) === next) this.eventTails.delete(target.entry.id)
    }
    void next.then(clearTail, error => {
      clearTail()
      try { this.options.notice(boundedMessage(error, 'editor extension action failed')) } catch { /* owner notice failures are contained */ }
    })
  }

  /** @internal Dispatch a semantic event against the currently committed shell. */
  dispatchEvent(event: BlueUiEvent): void { this.dispatchShellEvent(this.shell, event) }

  private installCompletionProvider(): void {
    const entries = this.entries
    const sources = this.options.ctx.blueEditorHost.listAutocompleteSources()
    const applications = new WeakMap<BlueAutocompleteItem, CompletionApplication>()
    const provider: BlueAutocompleteProvider = {
      triggerCharacters: [...new Set([...sources.flatMap(source => source.triggerCharacters ?? []), '/', '@', '#'])],
      getSuggestions: async (lines, cursorLine, cursorCol, completionOptions): Promise<BlueAutocompleteSuggestions | null> => {
        const signal = AbortSignal.any([completionOptions.signal, this.completionLifecycle.signal])
        const line = lines[cursorLine] ?? ''
        const context = completionContext(line, cursorCol, completionOptions.force)
        const base = await Promise.all(sources.map(async source => {
          const deadline = new AbortController()
          const sourceSignal = AbortSignal.any([signal, deadline.signal])
          const outcome = await settleCallback(
            () => source.getSuggestions(lines, cursorLine, cursorCol, { signal: sourceSignal, ...(completionOptions.force === undefined ? {} : { force: completionOptions.force }) }),
            sourceSignal,
            COMPLETION_TIMEOUT_MS,
          )
          if (outcome.kind === 'timeout') deadline.abort()
          return { source, result: outcome.kind === 'value' ? outcome.value : null }
        }))
        if (signal.aborted) return null
        const output: BlueAutocompleteItem[] = []
        let prefix = context?.prefix
        for (const { source, result } of base) {
          if (result === null) continue
          prefix ??= result.prefix
          for (const item of result.items) {
            if (output.length >= MAX_COMPLETIONS) break
            output.push(item)
            applications.set(item, { provider: source, item, prefix: result.prefix })
          }
        }
        if (context !== undefined) {
          const revision = ++this.operationRevision
          const requests = entries.filter(entry => entry.complete !== undefined).map(async entry => {
            const deadline = new AbortController()
            const entrySignal = AbortSignal.any([signal, deadline.signal])
            const outcome = await settleCallback(
              () => entry.complete!(Object.freeze(context.request), { surfaceId: entry.id, signal: entrySignal, revision }),
              entrySignal,
              COMPLETION_TIMEOUT_MS,
            )
            if (outcome.kind === 'timeout') deadline.abort()
            return outcome
          })
          for (const outcome of await Promise.all(requests)) {
            if (signal.aborted || this.entries !== entries) return null
            if (outcome.kind === 'timeout') { this.options.notice('editor extension completion timed out'); continue }
            if (outcome.kind === 'rejected') { this.options.notice(boundedMessage(outcome.error, 'editor extension completion failed')); continue }
            /* v8 ignore next -- an aborted entry necessarily sets the shared signal tested above. */
            if (outcome.kind !== 'value') return null
            const result = completionItems(outcome.value)
            if (!result.ok) { this.options.notice(result.message); continue }
            for (const candidate of result.value) {
              if (output.length >= MAX_COMPLETIONS) break
              const item: BlueAutocompleteItem = {
                value: candidate.insertText,
                label: candidate.label,
                ...(candidate.detail === undefined ? {} : { description: candidate.detail }),
              }
              output.push(item)
              applications.set(item, { item, prefix: context.prefix, insertText: candidate.insertText })
            }
          }
        }
        return output.length === 0 ? null : { items: output, prefix: prefix ?? context?.prefix ?? '' }
      },
      applyCompletion: (lines, cursorLine, cursorCol, item, prefix) => {
        const application = applications.get(item)
        if (application?.provider !== undefined) return application.provider.applyCompletion(lines, cursorLine, cursorCol, application.item, application.prefix)
        const replace = application?.insertText ?? item.value
        const current = lines[cursorLine] ?? ''
        const appliedPrefix = application?.prefix ?? prefix
        const head = current.slice(0, Math.max(0, cursorCol - appliedPrefix.length)) + replace
        return { lines: lines.map((source, index) => index === cursorLine ? head + current.slice(cursorCol) : source), cursorLine, cursorCol: head.length }
      },
      shouldTriggerFileCompletion: (lines, cursorLine, cursorCol) => sources.some(source => {
        try { return source.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) === true } catch { return false }
      }),
    }
    this.options.editor.setAutocompleteProvider(provider)
  }

  private beginSubmit(attempt: BlueEditorSubmitAttempt): void {
    const entries = this.entries
    if (!this.options.shouldTransformSubmit(attempt.text)) { attempt.commit(); return }
    const transforms = entries.filter(entry => entry.transformSubmit !== undefined)
    if (transforms.length === 0) { attempt.commit(); return }
    const controller = new AbortController()
    const abort = (): void => { controller.abort() }
    attempt.signal.addEventListener('abort', abort, { once: true })
    controller.signal.addEventListener('abort', () => { attempt.cancel() }, { once: true })
    this.pending.add(controller)
    const revision = ++this.operationRevision
    const captured = captureAttachments(this.options.ctx, attempt.text)
    const attachments = Object.freeze(captured.attachments.map(attachment => attachment.public))
    void (async () => {
      let text = captured.text
      for (const entry of transforms) {
        if (controller.signal.aborted || this.entries !== entries) return
        const request: BlueEditorSubmitRequest = Object.freeze({ text, attachments })
        const outcome = await settleCallback(
          () => entry.transformSubmit!(request, { surfaceId: entry.id, signal: controller.signal, revision }),
          controller.signal,
          SUBMIT_TIMEOUT_MS,
        )
        if (controller.signal.aborted || this.entries !== entries) return
        if (outcome.kind === 'timeout') {
          controller.abort()
          this.options.notice('editor extension submit transform timed out')
          return
        }
        if (outcome.kind === 'rejected') {
          this.options.notice(boundedMessage(outcome.error, 'editor extension submit transform failed'))
          attempt.cancel()
          return
        }
        /* v8 ignore next -- an aborted transform necessarily aborts the controller tested above. */
        if (outcome.kind !== 'value') return
        const result = submitValue(outcome.value)
        if (!result.ok) {
          this.options.notice(result.message)
          attempt.cancel()
          return
        }
        text = result.value.text
      }
      if (text.trim().length === 0 && captured.attachments.length === 0) {
        this.options.notice('submit transform produced an empty prompt')
        attempt.cancel()
        return
      }
      this.prepared = { source: attempt.text, text, attachments: captured.attachments }
      if (!attempt.commit()) this.prepared = undefined
    })().catch(error => {
      if (!controller.signal.aborted) this.options.notice(failureMessage(error, 'submit transform failed'))
      attempt.cancel()
    }).finally(() => {
      attempt.signal.removeEventListener('abort', abort)
      this.pending.delete(controller)
    })
  }
}
