/**
 * Frontend-tree owner for public editor extensions. It composes passive shell
 * rows around the Blue-owned editor, multiplexes completion sources, and holds
 * the pre-clear asynchronous submit transaction.
 *
 * @module @dsh-blue/blue-interaction/editor-extension-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  BlueEditorAttachment,
  BlueEditorCompletionItem,
  BlueEditorCompletionRequestV2,
  BlueEditorExtensionContribution,
  BlueEditorSubmitRequest,
  BlueResult,
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
  type BlueEditorSubmitAttempt,
  type BlueFocusable,
} from '@dsh-blue/blue-core'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { EditorExtensionBinding, SubmitTransformation } from './editor-instance.ts'

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

type CallbackOutcome<Value> =
  | { readonly kind: 'value', readonly value: Value }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'rejected', readonly error: unknown }

/** Construction dependencies retained only for the input Fiber lifetime. */
export interface EditorExtensionRuntimeOptions {
  readonly ctx: Context
  readonly editor: BlueEditor
  readonly notice: (text: string) => void
  readonly shouldTransformSubmit: (text: string) => boolean
}

function success<Value>(value: Value): BlueResult<Value> { return { ok: true, value } }

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

function completionContext(line: string, cursorCol: number, force: boolean | undefined): { request: BlueEditorCompletionRequestV2, prefix: string } | undefined {
  const before = line.slice(0, cursorCol)
  const slash = /^\/(\S*)$/u.exec(before)
  /* v8 ignore next -- the mandatory `(\S*)` capture exists for every successful match. */
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

function completionItems(result: unknown): BlueResult<readonly BlueEditorCompletionItem[]> {
  try {
    if (typeof result !== 'object' || result === null) throw new Error('completion result must be a BlueResult')
    if (ownData(result, 'ok') !== true) return { ok: false, code: 'BLUE_ACTION_REJECTED', message: failureMessage(result, 'completion failed') }
    const value = ownData(result, 'value')
    if (!Array.isArray(value) || value.length > MAX_COMPLETIONS) throw new Error(`completion result must contain at most ${String(MAX_COMPLETIONS)} items`)
    const seen = new Set<string>()
    const items = value.map((candidate, index): BlueEditorCompletionItem => {
      if (typeof candidate !== 'object' || candidate === null) throw new Error(`completion item ${String(index)} must be an object`)
      const id = ownData(candidate, 'id')
      const label = ownData(candidate, 'label')
      const insertText = ownData(candidate, 'insertText')
      const detailDescriptor = Object.getOwnPropertyDescriptor(candidate, 'detail')
      const detail = detailDescriptor === undefined ? undefined : 'value' in detailDescriptor ? detailDescriptor.value : null
      if (typeof id !== 'string' || id.length === 0 || id.length > 128 || seen.has(id)) throw new Error(`completion item ${String(index)} has an invalid or duplicate id`)
      if (typeof label !== 'string' || label.length > MAX_COMPLETION_TEXT) throw new Error(`completion item ${String(index)} has an invalid label`)
      if (typeof insertText !== 'string' || insertText.length > MAX_COMPLETION_TEXT) throw new Error(`completion item ${String(index)} has invalid insertText`)
      if (detail !== undefined && (typeof detail !== 'string' || detail.length > MAX_COMPLETION_TEXT)) throw new Error(`completion item ${String(index)} has an invalid detail`)
      seen.add(id)
      return Object.freeze({ id, label, insertText, ...(detail === undefined ? {} : { detail }) })
    })
    return success(Object.freeze(items))
  } catch (error) {
    return { ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: error instanceof Error ? error.message : 'completion result was rejected' }
  }
}

function submitValue(result: unknown): BlueResult<{ readonly text: string }> {
  try {
    if (typeof result !== 'object' || result === null) throw new Error('submit transform must return a BlueResult')
    if (ownData(result, 'ok') !== true) return { ok: false, code: 'BLUE_ACTION_REJECTED', message: failureMessage(result, 'submit transform failed') }
    const value = ownData(result, 'value')
    if (typeof value !== 'object' || value === null) throw new Error('submit transform value must be an object')
    const text = ownData(value, 'text')
    if (typeof text !== 'string' || text.length > MAX_SUBMIT_TEXT) throw new Error(`submit transform text exceeds ${String(MAX_SUBMIT_TEXT)} characters or is invalid`)
    return success({ text })
  } catch (error) {
    return { ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: error instanceof Error ? error.message : 'submit transform was rejected' }
  }
}

function eventResult(result: unknown): BlueResult {
  try {
    if (typeof result !== 'object' || result === null) throw new Error('editor action must return a BlueResult')
    if (ownData(result, 'ok') === true) return success(undefined)
    return { ok: false, code: 'BLUE_ACTION_REJECTED', message: failureMessage(result, 'editor action failed') }
  } catch (error) {
    return { ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: boundedMessage(error, 'editor action result was rejected') }
  }
}

function isPassive(node: BlueUiNode): boolean {
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
  private binding: EditorExtensionBinding | undefined
  private component: BlueComponent
  private focusTarget: BlueFocusable
  private readonly eventActions = new Map<string, { entry: BlueEditorExtensionContribution, actionId: string }>()
  private readonly pending = new Set<AbortController>()
  private readonly eventTails = new Map<string, Promise<void>>()
  private actionGeneration = 0
  private completionLifecycle = new AbortController()
  private prepared: PreparedSubmit | undefined
  private readonly unsubscribe: () => void

  constructor(private readonly options: EditorExtensionRuntimeOptions) {
    this.component = options.editor
    this.focusTarget = options.editor
    this.unsubscribe = options.ctx.blueEditorHost.subscribeEditorState(() => this.sync())
    this.sync()
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
    this.unsubscribe()
    this.abortPending()
    this.options.editor.setSubmitBarrier(undefined)
    this.prepared = undefined
    this.focusTarget.focused = false
  }

  /** Abort session-scoped async work without removing registered extensions. */
  invalidateSession(): void { this.abortPending() }

  private sync(): void {
    this.abortPending()
    this.binding = this.options.ctx.blueEditorHost.extensions
    this.compileShell()
    this.installCompletionProvider()
    const transforms = this.binding?.entries.some(entry => entry.transformSubmit !== undefined) === true
    const handler = transforms ? (attempt: BlueEditorSubmitAttempt): void => { this.beginSubmit(attempt) } : undefined
    this.options.editor.setSubmitBarrier(handler)
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

  private compileShell(): void {
    const binding = this.binding
    this.eventActions.clear()
    const children: Array<{ node: BlueUiNode | { readonly kind: 'editor-control' } }> = []
    if (binding !== undefined) {
      for (const entry of binding.entries) {
        if (entry.before === undefined) continue
        const admitted = validateBlueUiNode(entry.before)
        if (admitted.ok && isPassive(admitted.value)) children.push({ node: admitted.value })
        else this.options.notice(admitted.ok ? 'editor extension before must be passive' : admitted.message.slice(0, MAX_NOTICE_TEXT))
      }
    }
    children.push({ node: { kind: 'editor-control' } })
    if (binding !== undefined) {
      for (const [entryIndex, entry] of binding.entries.entries()) {
        const rows: BlueUiNode[] = []
        if (typeof entry.hint === 'string') {
          const admitted = validateBlueUiNode({ kind: 'text', content: entry.hint, tone: 'muted' })
          if (admitted.ok) rows.push(admitted.value)
          else this.options.notice(admitted.message.slice(0, MAX_NOTICE_TEXT))
        }
        if (Array.isArray(entry.diagnostics)) for (const diagnostic of entry.diagnostics) {
          let candidate: BlueUiNode | undefined
          try {
            if (typeof diagnostic !== 'object' || diagnostic === null) throw new Error('editor extension diagnostic must be an object')
            const message = ownData(diagnostic, 'message')
            const tone = optionalOwnData(diagnostic, 'tone')
            const admitted = validateBlueUiNode({ kind: 'text', content: message, ...(tone === undefined ? { tone: 'warning' as const } : { tone }) })
            if (!admitted.ok) throw new Error(admitted.message)
            candidate = admitted.value
          } catch (error) { this.options.notice(boundedMessage(error, 'editor extension diagnostic was rejected')) }
          if (candidate !== undefined) rows.push(candidate)
        }
        if (Array.isArray(entry.actions) && entry.actions.length > 0) {
          const admitted = validateBlueUiNode({ kind: 'actions', id: `extension-actions-${String(entryIndex)}`, items: entry.actions })
          if (admitted.ok) {
            const actions = admitted.value as Extract<BlueUiNode, { readonly kind: 'actions' }>
            const items = actions.items.map((action, actionIndex) => {
              const id = `extension-${String(entryIndex)}-${String(actionIndex)}`
              this.eventActions.set(id, { entry, actionId: action.id })
              return { ...action, id }
            })
            rows.push({ ...actions, items })
          } else this.options.notice(admitted.message.slice(0, MAX_NOTICE_TEXT))
        }
        for (const row of rows) children.push({ node: row })
        if (entry.after !== undefined) {
          const admitted = validateBlueUiNode(entry.after)
          if (admitted.ok && isPassive(admitted.value)) children.push({ node: admitted.value })
          else this.options.notice(admitted.ok ? 'editor extension after must be passive' : admitted.message.slice(0, MAX_NOTICE_TEXT))
        }
      }
    }
    const node = children.length === 1
      ? { kind: 'editor-control' as const }
      : { kind: 'stack' as const, direction: 'column' as const, children }
    if (node.kind === 'editor-control') {
      this.component = this.options.editor
      this.focusTarget = this.options.editor
      this.focusTarget.focused = this.ownFocused
      return
    }
    const result = compileBlueEditorShellNode(node, {
      editor: this.options.editor,
      components: this.options.ctx.blueComponents,
      colors: this.options.ctx.blueTheme.colors,
      getViewport: () => ({ columns: this.columns, rows: Number.MAX_SAFE_INTEGER }),
      screenMode: 'main',
      emit: event => this.dispatchEvent(event),
    })
    this.component = result.ok ? result.value.component : this.options.editor
    this.focusTarget = result.ok ? result.value.focusTarget : this.options.editor
    if (!result.ok) this.options.notice(result.message.slice(0, MAX_NOTICE_TEXT))
    this.focusTarget.focused = this.ownFocused
  }

  private dispatchEvent(event: BlueUiEvent): void {
    if (event.kind !== 'activate') return
    const target = this.eventActions.get(event.controlId)
    const binding = this.binding
    if (target === undefined || binding === undefined || target.entry.onEvent === undefined) return
    const revision = ++this.operationRevision
    const generation = this.actionGeneration
    const translated: BlueUiEvent = { kind: 'activate', controlId: target.actionId }
    const previous = this.eventTails.get(target.entry.id) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(async () => {
      if (this.actionGeneration !== generation) return
      const controller = new AbortController()
      this.pending.add(controller)
      try {
        const outcome = await settleCallback(
          () => binding.dispatch(target.entry, translated, controller.signal, revision),
          controller.signal,
          ACTION_TIMEOUT_MS,
        )
        if (this.binding !== binding || controller.signal.aborted || outcome.kind === 'aborted') return
        if (outcome.kind === 'timeout') { controller.abort(); this.options.notice('editor extension action timed out'); return }
        if (outcome.kind === 'rejected') { this.options.notice(boundedMessage(outcome.error, 'editor extension action failed')); return }
        const result = eventResult(outcome.value)
        if (!result.ok) this.options.notice(result.message.slice(0, MAX_NOTICE_TEXT))
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

  private installCompletionProvider(): void {
    const binding = this.binding
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
        if (binding !== undefined && context !== undefined) {
          const revision = ++this.operationRevision
          const requests = binding.entries.filter(entry => entry.completeV2 !== undefined
            || (context.request.trigger !== '#' && entry.complete !== undefined)).map(async entry => {
            const deadline = new AbortController()
            const entrySignal = AbortSignal.any([signal, deadline.signal])
            const outcome = await settleCallback(
              () => binding.complete(entry, Object.freeze(context.request), entrySignal, revision),
              entrySignal,
              COMPLETION_TIMEOUT_MS,
            )
            if (outcome.kind === 'timeout') deadline.abort()
            return outcome
          })
          for (const outcome of await Promise.all(requests)) {
            if (signal.aborted || this.binding !== binding) return null
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
        return { lines: lines.map((line, index) => index === cursorLine ? head + current.slice(cursorCol) : line), cursorLine, cursorCol: head.length }
      },
      shouldTriggerFileCompletion: (lines, cursorLine, cursorCol) => sources.some(source => {
        try { return source.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) === true } catch { return false }
      }),
    }
    this.options.editor.setAutocompleteProvider(provider)
  }

  private beginSubmit(attempt: BlueEditorSubmitAttempt): void {
    const binding = this.binding
    if (binding === undefined || !this.options.shouldTransformSubmit(attempt.text)) { attempt.commit(); return }
    const transforms = binding.entries.filter(entry => entry.transformSubmit !== undefined)
    if (transforms.length === 0) { attempt.commit(); return }
    const controller = new AbortController()
    const abort = () => controller.abort()
    attempt.signal.addEventListener('abort', abort, { once: true })
    controller.signal.addEventListener('abort', () => attempt.cancel(), { once: true })
    this.pending.add(controller)
    const revision = ++this.operationRevision
    const captured = captureAttachments(this.options.ctx, attempt.text)
    const attachments = Object.freeze(captured.attachments.map(attachment => attachment.public))
    void (async () => {
      let text = captured.text
      for (const entry of transforms) {
        if (controller.signal.aborted || this.binding !== binding) return
        const request: BlueEditorSubmitRequest = Object.freeze({ text, attachments })
        const outcome = await settleCallback(
          () => binding.transform(entry, request, controller.signal, revision),
          controller.signal,
          SUBMIT_TIMEOUT_MS,
        )
        if (controller.signal.aborted || this.binding !== binding) return
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
