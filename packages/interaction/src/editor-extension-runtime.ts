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
  BlueEditorExtensionSnapshot,
  BlueEditorProvider,
  BlueEditorShellNode,
  BlueEditorSnapshot,
  BlueSessionSnapshot,
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
  type BlueEditorShellComponent,
  type BlueEditorSubmitAttempt,
  type BlueFocusable,
} from '@dsh-blue/blue-core'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { EditorExtensionBinding, EditorProviderBinding, SubmitTransformation } from './editor-instance.ts'

const MAX_COMPLETIONS = 200
const MAX_COMPLETION_TEXT = 2_000
const MAX_SUBMIT_TEXT = 20_000
const MAX_NOTICE_TEXT = 2_000
const COMPLETION_TIMEOUT_MS = 5_000
const SUBMIT_TIMEOUT_MS = 30_000
const ACTION_TIMEOUT_MS = 30_000
const PROVIDER_FAILURE_LIMIT = 3
const PROVIDER_FAILURE_WINDOW_MS = 60_000
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
  readonly checked?: BlueEditorShellComponent
  readonly extensionBinding?: EditorExtensionBinding
  readonly extensionActions: ReadonlyMap<string, ExtensionActionBinding>
  readonly provider?: {
    readonly binding: EditorProviderBinding
    readonly entry: BlueEditorProvider
    readonly generation: number
  }
}

type EditorShellCandidate = { readonly shell: EditorShell } | { readonly failure: string }

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

/** Readonly selection and failure state exposed for owner diagnostics/tests. */
export interface EditorProviderRuntimeSnapshot {
  readonly desiredId: string
  readonly activeId: string
  readonly breakerOpen: boolean
  readonly runtimeFailure?: string
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
  private providerBinding: EditorProviderBinding | undefined
  private component: BlueComponent
  private focusTarget: BlueFocusable
  private shell: EditorShell
  private defaultShell: EditorShell
  private readonly pending = new Set<AbortController>()
  private readonly eventTails = new Map<string, Promise<void>>()
  private actionGeneration = 0
  private providerGeneration = 0
  private providerOperationRevision = 0
  private providerLifecycle = new AbortController()
  private readonly providerPending = new Set<AbortController>()
  private readonly providerEventTails = new Map<string, Promise<void>>()
  private providerChange: AbortController | undefined
  private measuredWidth: number | undefined
  private session: BlueSessionSnapshot | null
  private activeProvider: BlueEditorProvider | undefined
  private desiredProvider = 'blue.default'
  private providerAttemptNeeded = false
  private providerEpoch = 0
  private breakerProvider: BlueEditorProvider | undefined
  private failureProvider: BlueEditorProvider | undefined
  private readonly providerFailureTimes: number[] = []
  private providerRuntimeFailure: string | undefined
  private providerFallback: EditorShell | undefined
  private attachmentSignature = ''
  private initialized = false
  private completionLifecycle = new AbortController()
  private prepared: PreparedSubmit | undefined
  private readonly unsubscribe: () => void

  constructor(private readonly options: EditorExtensionRuntimeOptions) {
    this.component = options.editor
    this.focusTarget = options.editor
    this.shell = this.plainShell()
    this.defaultShell = this.shell
    this.session = options.ctx.blueSessionReader.current()
    this.unsubscribe = options.ctx.blueEditorHost.subscribeEditorState(() => this.sync())
    this.sync()
  }

  get focused(): boolean { return this.ownFocused }
  set focused(value: boolean) {
    this.ownFocused = value
    this.focusTarget.focused = value
  }

  get providerStatus(): EditorProviderRuntimeSnapshot {
    return Object.freeze({
      desiredId: this.desiredProvider,
      activeId: this.activeProvider?.id ?? 'blue.default',
      breakerOpen: this.breakerProvider?.id === this.desiredProvider,
      ...(this.providerRuntimeFailure === undefined ? {} : { runtimeFailure: this.providerRuntimeFailure }),
    })
  }

  render(width: number): string[] {
    const columns = Math.max(1, Number.isFinite(width) ? Math.floor(width) : 1)
    if (this.measuredWidth !== columns) {
      this.measuredWidth = columns
      this.providerAttemptNeeded = this.desiredProvider !== 'blue.default'
    }
    if (this.desiredProvider !== 'blue.default') {
      const signature = this.currentAttachmentSignature()
      if (signature !== this.attachmentSignature) {
        this.attachmentSignature = signature
        this.providerEpoch += 1
        this.providerAttemptNeeded = true
      }
    }
    this.columns = columns
    this.attemptDesiredProvider()
    const renderedShell = this.shell
    const checked = renderedShell.checked
    if (renderedShell.provider === undefined || checked === undefined) return renderedShell.component.render(columns)
    const rendered = checked.renderChecked(columns)
    if (rendered.runtimeFailure === undefined) {
      this.clearProviderFailures(renderedShell.provider)
      return rendered.rows
    }
    this.providerRuntimeFailure = rendered.runtimeFailure
    this.recordProviderFailure(renderedShell.provider.entry, rendered.runtimeFailure)
    const fallback = this.breakerProvider === renderedShell.provider.entry
      ? this.defaultShell
      : this.providerFallback ?? this.defaultShell
    this.abortProviderPending()
    this.providerFallback = undefined
    this.activeProvider = fallback.provider?.entry
    this.activateShell(fallback)
    if (fallback.provider === undefined || fallback.checked === undefined) return fallback.component.render(columns)
    const fallbackRendered = fallback.checked.renderChecked(columns)
    if (fallbackRendered.runtimeFailure === undefined) return fallbackRendered.rows
    this.activeProvider = undefined
    this.activateShell(this.defaultShell)
    return this.defaultShell.component.render(columns)
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
    this.abortProviderPending()
    this.providerEpoch += 1
    this.options.editor.setSubmitBarrier(undefined)
    this.prepared = undefined
    this.focusTarget.focused = false
  }

  /** Abort route-scoped extension work without resetting the selected shell. */
  invalidateRoute(): void { this.abortPending() }

  /** Compatibility invalidation used by direct runtime consumers and tests. */
  invalidateSession(): void {
    this.abortPending()
    this.abortProviderPending()
  }

  /** Refresh provider session facts and fence all work from a retired session. */
  updateSession(session: BlueSessionSnapshot | null): void {
    const switched = this.session?.id !== session?.id
    const changed = switched || this.session?.mode !== session?.mode || this.session?.status !== session?.status
    this.session = session
    if (!changed) return
    if (switched) this.abortPending()
    this.abortProviderPending()
    this.providerEpoch += 1
    if (switched) {
      this.providerFallback = undefined
      this.activeProvider = undefined
      this.activateShell(this.defaultShell)
    }
    this.providerAttemptNeeded = this.desiredProvider !== 'blue.default'
    this.attemptDesiredProvider()
  }

  /** Rebuild only when public attachment metadata changed with the draft. */
  refreshProviderSnapshot(): void {
    if (this.desiredProvider === 'blue.default') return
    const signature = this.currentAttachmentSignature()
    if (signature === this.attachmentSignature) return
    this.attachmentSignature = signature
    this.providerEpoch += 1
    this.providerAttemptNeeded = true
    this.attemptDesiredProvider()
  }

  private sync(): void {
    const nextExtensions = this.options.ctx.blueEditorHost.extensions
    const nextProviders = this.options.ctx.blueEditorHost.providers
    const extensionChanged = !this.initialized || nextExtensions !== this.binding
    const providerChanged = !this.initialized || nextProviders !== this.providerBinding
    if (extensionChanged) {
      this.abortPending()
      this.abortProviderPending()
      this.binding = nextExtensions
      this.defaultShell = this.compileDefaultShell()
      if (this.shell.provider === undefined) this.activateShell(this.defaultShell)
      else {
        this.providerEpoch += 1
        this.providerAttemptNeeded = this.desiredProvider !== 'blue.default'
      }
      const transforms = this.binding?.entries.some(entry => entry.transformSubmit !== undefined) === true
      const handler = transforms ? (attempt: BlueEditorSubmitAttempt): void => { this.beginSubmit(attempt) } : undefined
      this.options.editor.setSubmitBarrier(handler)
    }
    if (!providerChanged) this.installCompletionProvider()
    else this.syncProviderBinding(nextProviders)
    if (!this.initialized) this.installCompletionProvider()
    this.initialized = true
    this.attemptDesiredProvider()
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

  private abortProviderPending(): void {
    this.providerGeneration += 1
    this.providerLifecycle.abort()
    this.providerLifecycle = new AbortController()
    this.providerChange?.abort()
    this.providerChange = undefined
    for (const controller of this.providerPending) controller.abort()
    this.providerPending.clear()
    this.providerEventTails.clear()
  }

  private plainShell(): EditorShell {
    return {
      component: this.options.editor,
      focusTarget: this.options.editor,
      extensionActions: new Map(),
    }
  }

  private activateShell(shell: EditorShell): void {
    if (this.shell !== shell) this.focusTarget.focused = false
    this.shell = shell
    this.component = shell.component
    this.focusTarget = shell.focusTarget
    shell.checked?.focusEditor()
    this.focusTarget.focused = this.ownFocused
    try { this.component.invalidate() } catch { /* renderer invalidation is contained */ }
    try { this.options.ctx.blueScreen.requestRender() } catch { /* repaint is best effort */ }
  }

  private extensionEnvelope(base: BlueEditorShellNode): { readonly node: BlueEditorShellNode, readonly actions: ReadonlyMap<string, ExtensionActionBinding> } {
    const binding = this.binding
    const actions = new Map<string, ExtensionActionBinding>()
    const children: Array<{ node: BlueEditorShellNode }> = []
    if (binding !== undefined) {
      for (const entry of binding.entries) {
        if (entry.before === undefined) continue
        const admitted = validateBlueUiNode(entry.before)
        if (admitted.ok && isPassive(admitted.value)) children.push({ node: admitted.value })
        else this.options.notice(admitted.ok ? 'editor extension before must be passive' : admitted.message.slice(0, MAX_NOTICE_TEXT))
      }
    }
    children.push({ node: base })
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
    }
    const node: BlueEditorShellNode = children.length === 1
      ? base
      : { kind: 'stack' as const, direction: 'column' as const, children }
    return { node, actions }
  }

  private compileShellNode(
    node: BlueEditorShellNode,
    extensionActions: ReadonlyMap<string, ExtensionActionBinding>,
    extensionBinding: EditorExtensionBinding | undefined,
    provider?: EditorShell['provider'],
  ): EditorShellCandidate {
    let shell!: EditorShell
    const result = compileBlueEditorShellNode(node, {
      editor: this.options.editor,
      components: this.options.ctx.blueComponents,
      colors: this.options.ctx.blueTheme.colors,
      getViewport: () => ({ columns: this.columns, rows: Number.MAX_SAFE_INTEGER }),
      screenMode: 'main',
      emit: event => { this.dispatchShellEvent(shell, event) },
    })
    if (!result.ok) return { failure: result.message.slice(0, MAX_NOTICE_TEXT) }
    shell = {
      component: result.value.component,
      focusTarget: result.value.focusTarget,
      checked: result.value.component,
      extensionActions,
      ...(extensionBinding === undefined ? {} : { extensionBinding }),
      ...(provider === undefined ? {} : { provider }),
    }
    return { shell }
  }

  private compileDefaultShell(): EditorShell {
    const envelope = this.extensionEnvelope({ kind: 'editor-control' })
    if (envelope.node.kind === 'editor-control') return this.plainShell()
    const compiled = this.compileShellNode(envelope.node, envelope.actions, this.binding)
    if ('shell' in compiled) return compiled.shell
    this.options.notice(compiled.failure)
    return this.plainShell()
  }

  private dispatchShellEvent(shell: EditorShell, event: BlueUiEvent): void {
    const target = event.kind === 'activate' ? shell.extensionActions.get(event.controlId) : undefined
    const binding = shell.extensionBinding
    if (target === undefined) {
      if (shell.provider !== undefined) this.dispatchProviderEvent(shell.provider, event)
      return
    }
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
        if (shell !== this.shell || controller.signal.aborted || outcome.kind === 'aborted') return
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

  /** @internal Dispatch a semantic event against the currently committed shell. */
  dispatchEvent(event: BlueUiEvent): void { this.dispatchShellEvent(this.shell, event) }

  private syncProviderBinding(next: EditorProviderBinding | undefined): void {
    const previous = this.providerBinding
    if (previous === next) return
    const previousDesired = this.desiredProvider
    const previousCandidate = previous?.entries.find(entry => entry.id === previousDesired)
    this.providerBinding = next
    this.abortProviderPending()
    this.providerEpoch += 1
    if (next === undefined) {
      this.desiredProvider = 'blue.default'
      this.activeProvider = undefined
      this.providerFallback = undefined
      this.providerAttemptNeeded = false
      this.providerRuntimeFailure = undefined
      this.activateShell(this.defaultShell)
      return
    }
    this.desiredProvider = next.desiredId.trim() === '' ? 'blue.default' : next.desiredId
    const candidate = next.entries.find(entry => entry.id === this.desiredProvider)
    const desiredChanged = this.desiredProvider !== previousDesired
    const generationChanged = candidate !== undefined && candidate !== previousCandidate
    if (desiredChanged || generationChanged) {
      this.breakerProvider = undefined
      this.failureProvider = undefined
      this.providerFailureTimes.length = 0
      this.providerRuntimeFailure = undefined
    }
    if (this.activeProvider !== undefined && !next.entries.includes(this.activeProvider)) {
      this.activeProvider = undefined
      this.providerFallback = undefined
      this.activateShell(this.defaultShell)
    }
    if (this.desiredProvider === 'blue.default') {
      this.activeProvider = undefined
      this.providerFallback = undefined
      this.providerAttemptNeeded = false
      this.activateShell(this.defaultShell)
      return
    }
    this.providerAttemptNeeded = candidate === undefined || this.breakerProvider !== candidate
  }

  private extensionSnapshots(): readonly BlueEditorExtensionSnapshot[] {
    const snapshots = (this.binding?.entries ?? []).map(entry => {
      let before: BlueUiNode | undefined
      let after: BlueUiNode | undefined
      if (entry.before !== undefined) {
        const admitted = validateBlueUiNode(entry.before)
        if (admitted.ok && isPassive(admitted.value)) before = admitted.value
      }
      if (entry.after !== undefined) {
        const admitted = validateBlueUiNode(entry.after)
        if (admitted.ok && isPassive(admitted.value)) after = admitted.value
      }
      return Object.freeze({
        id: entry.id,
        ...(before === undefined ? {} : { before }),
        ...(after === undefined ? {} : { after }),
        ...(entry.hint === undefined ? {} : { hint: entry.hint }),
        ...(entry.diagnostics === undefined ? {} : {
          diagnostics: Object.freeze(entry.diagnostics.map(diagnostic => Object.freeze({
            id: diagnostic.id,
            message: diagnostic.message,
            ...(diagnostic.tone === undefined ? {} : { tone: diagnostic.tone }),
          }))),
        }),
        ...(entry.actions === undefined ? {} : {
          actions: Object.freeze(entry.actions.map(action => Object.freeze({
            id: action.id,
            label: action.label,
            ...(action.intent === undefined ? {} : { intent: action.intent }),
            ...(action.disabled === undefined ? {} : { disabled: action.disabled }),
            ...(action.busy === undefined ? {} : { busy: action.busy }),
            ...(action.confirm === undefined ? {} : { confirm: action.confirm }),
          }))),
        }),
      })
    })
    return Object.freeze(snapshots)
  }

  private attachmentSnapshots(): readonly BlueEditorAttachment[] {
    const source = this.options.editor.getText()
    const attachments = [...this.options.ctx.blueInteractionState.pasteImage.pastedImages.entries()].flatMap(([marker, ref]) => {
      if (!source.includes(marker)) return []
      return [Object.freeze({
        id: String(ref.attachmentId),
        label: ref.name ?? marker,
        mediaType: ref.mediaType,
        size: ref.bytes,
      })]
    })
    return Object.freeze(attachments)
  }

  private currentAttachmentSignature(): string {
    const source = this.options.editor.getText()
    return [...this.options.ctx.blueInteractionState.pasteImage.pastedImages.entries()]
      .filter(([marker]) => source.includes(marker))
      .map(([marker, ref]) => `${marker}\u0000${String(ref.attachmentId)}\u0000${ref.name ?? ''}\u0000${ref.mediaType ?? ''}\u0000${String(ref.bytes ?? '')}`)
      .join('\u0001')
  }

  private providerSnapshot(): BlueEditorSnapshot {
    this.attachmentSignature = this.currentAttachmentSignature()
    return Object.freeze({
      mode: this.session?.mode ?? 'normal',
      busy: this.session?.status === 'running',
      attachments: this.attachmentSnapshots(),
      extensions: this.extensionSnapshots(),
    })
  }

  private candidateShell(provider: BlueEditorProvider, binding: EditorProviderBinding, width: number, generation: number): EditorShellCandidate {
    let node: BlueEditorShellNode
    try { node = provider.render(this.providerSnapshot()) }
    catch (error) { return { failure: boundedMessage(error, 'editor provider render failed') } }
    const providerBinding = { binding, entry: provider, generation }
    const standalone = this.compileShellNode(node, new Map(), undefined, providerBinding)
    if ('failure' in standalone) return standalone
    const standaloneDry = standalone.shell.checked!.renderChecked(width, { dryRun: true })
    if (standaloneDry.runtimeFailure !== undefined) return { failure: standaloneDry.runtimeFailure }

    const envelope = this.extensionEnvelope(node)
    if (envelope.node === node) return standalone
    const combined = this.compileShellNode(envelope.node, envelope.actions, this.binding, providerBinding)
    if ('failure' in combined) {
      this.options.notice(`editor extensions could not wrap provider: ${combined.failure}`.slice(0, MAX_NOTICE_TEXT))
      return standalone
    }
    const combinedDry = combined.shell.checked!.renderChecked(width, { dryRun: true })
    if (combinedDry.runtimeFailure !== undefined) {
      this.options.notice(`editor extensions failed around provider: ${combinedDry.runtimeFailure}`.slice(0, MAX_NOTICE_TEXT))
      return standalone
    }
    return combined
  }

  private attemptDesiredProvider(): void {
    const binding = this.providerBinding
    const width = this.measuredWidth
    if (!this.providerAttemptNeeded || binding === undefined || width === undefined || this.desiredProvider === 'blue.default') return
    const provider = binding.entries.find(entry => entry.id === this.desiredProvider)
    this.providerAttemptNeeded = false
    if (provider === undefined) {
      this.providerRuntimeFailure = `editor provider "${this.desiredProvider}" is unavailable`
      return
    }
    if (this.breakerProvider === provider) return
    const fence = ++this.providerEpoch
    const candidate = this.candidateShell(provider, binding, width, fence)
    if (fence !== this.providerEpoch || binding !== this.providerBinding || this.desiredProvider !== provider.id) return
    if ('failure' in candidate) {
      this.providerRuntimeFailure = candidate.failure
      this.recordProviderFailure(provider, candidate.failure)
      return
    }
    this.abortProviderPending()
    this.providerFallback = this.shell.provider === undefined ? this.defaultShell : this.shell
    this.activeProvider = provider
    this.providerRuntimeFailure = undefined
    this.activateShell(candidate.shell)
  }

  private clearProviderFailures(provider: NonNullable<EditorShell['provider']>): void {
    if (provider.generation !== this.providerEpoch || this.failureProvider !== provider.entry) return
    this.failureProvider = undefined
    this.providerFailureTimes.length = 0
    this.providerRuntimeFailure = undefined
  }

  private recordProviderFailure(provider: BlueEditorProvider, message: string): void {
    const now = Date.now()
    if (this.failureProvider !== provider) {
      this.failureProvider = provider
      this.providerFailureTimes.length = 0
    }
    while (this.providerFailureTimes.length > 0 && this.providerFailureTimes[0]! <= now - PROVIDER_FAILURE_WINDOW_MS) this.providerFailureTimes.shift()
    this.providerFailureTimes.push(now)
    this.providerRuntimeFailure = message
    if (this.providerFailureTimes.length < PROVIDER_FAILURE_LIMIT) return
    this.breakerProvider = provider
    this.activeProvider = undefined
    this.providerFallback = undefined
    this.activateShell(this.defaultShell)
  }

  private dispatchProviderEvent(provider: NonNullable<EditorShell['provider']>, event: BlueUiEvent): void {
    if (provider.entry.onEvent === undefined || this.shell.provider !== provider) return
    const revision = ++this.providerOperationRevision
    const generation = this.providerGeneration
    const run = async (controller: AbortController): Promise<void> => {
      this.providerPending.add(controller)
      try {
        const outcome = await settleCallback(
          () => provider.binding.dispatch(provider.entry, event, controller.signal, revision),
          controller.signal,
          ACTION_TIMEOUT_MS,
        )
        if (controller.signal.aborted || generation !== this.providerGeneration || this.shell.provider !== provider || outcome.kind === 'aborted') return
        if (outcome.kind === 'timeout') { controller.abort(); this.options.notice('editor provider action timed out'); return }
        if (outcome.kind === 'rejected') { this.options.notice(boundedMessage(outcome.error, 'editor provider action failed')); return }
        const result = eventResult(outcome.value)
        if (!result.ok) this.options.notice(result.message.slice(0, MAX_NOTICE_TEXT))
      } finally {
        this.providerPending.delete(controller)
        if (this.providerChange === controller) this.providerChange = undefined
      }
    }
    const latestWins = event.kind === 'selection-change' || event.kind === 'value-change' || event.kind === 'tab-change'
    if (latestWins) {
      this.providerChange?.abort()
      const controller = new AbortController()
      this.providerChange = controller
      void run(controller).catch(error => {
        if (!controller.signal.aborted) {
          try { this.options.notice(boundedMessage(error, 'editor provider action failed')) } catch { /* notice failures are contained */ }
        }
      })
      return
    }
    const previous = this.providerEventTails.get(provider.entry.id) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(async () => {
      if (generation !== this.providerGeneration || this.shell.provider !== provider) return
      await run(new AbortController())
    })
    this.providerEventTails.set(provider.entry.id, next)
    const clearTail = (): void => {
      if (this.providerEventTails.get(provider.entry.id) === next) this.providerEventTails.delete(provider.entry.id)
    }
    void next.then(clearTail, error => {
      clearTail()
      try { this.options.notice(boundedMessage(error, 'editor provider action failed')) } catch { /* notice failures are contained */ }
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
