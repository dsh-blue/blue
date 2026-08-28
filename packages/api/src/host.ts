/** Cordis-owned, renderer-independent host for stable Blue plugin contributions. */
import { Service, symbols, type Context } from '@deepseek-ai/cordis'
import type {
  BlueCommandContribution, BlueEditorExtensionContribution,
  BlueEditorProvider, BlueErrorCode, BlueNotification, BlueOverlayOpenOptions,
  BlueOverlayRequest, BlueOverlayRegistry, BluePaneContribution, BluePaneRegistration,
  BluePaneRegistry, BluePluginApi, BluePluginHost, BluePublicOverlayHandle,
  BlueRefreshRegistration, BlueRegistration, BlueRegistry, BlueResult,
  BlueSessionAction, BlueSessionReader, BlueSessionRequester, BlueSessionSnapshot,
  BlueStatusEntryContribution, BlueStatusProvider, BlueUserGesture,
} from './contracts.ts'
import { validateBlueManifest, type BlueCapability, type BluePluginManifest } from './manifest.ts'

declare module '@deepseek-ai/cordis' { interface Context { bluePluginHost: BluePluginHostService } }

type Capability = 'commands' | 'status' | 'notifications' | 'panes' | 'overlays' | 'editor.extensions' | 'session.read' | 'session.act' | 'status.provider' | 'editor.provider'
type HostCapability = BlueCapability
type EffectOwner = { effect(callback: () => () => void): unknown }
type Consumer = { effect(callback: () => () => void): unknown }
type Prioritized = { readonly id: string, readonly priority?: number }

export interface BluePluginHostPaneEntry extends Prioritized {
  readonly contribution: BluePaneContribution
  readonly hidden: boolean
  /** Owner-only render generation; public refresh bumps it after coalescing. */
  readonly revision?: number
}
export interface BluePluginHostOverlayEntry {
  readonly id: string
  readonly request: BlueOverlayRequest & { readonly capturing: boolean, readonly dismissible: boolean }
  readonly order: number
  /** Owner-only render generation; public refresh bumps it after coalescing. */
  readonly revision?: number
}
export interface BluePluginHostSnapshot {
  /** Monotonic owner snapshot fence across every aggregate mutation. */
  readonly revision?: number
  /** Monotonic fence for additive status mutations only. */
  readonly statusRevision?: number
  /** Monotonic fence for status-provider candidate mutations only. */
  readonly statusProvidersRevision?: number
  /** Monotonic fence for editor-extension mutations only. */
  readonly editorExtensionsRevision?: number
  /** Monotonic fence for editor-provider candidate mutations only. */
  readonly editorProvidersRevision?: number
  readonly commands: readonly BlueCommandContribution[]
  readonly status: readonly BlueStatusEntryContribution[]
  readonly panes: readonly BluePluginHostPaneEntry[]
  readonly overlays: readonly BluePluginHostOverlayEntry[]
  readonly editorExtensions: readonly BlueEditorExtensionContribution[]
  readonly statusProviders: readonly BlueStatusProvider[]
  readonly editorProviders: readonly BlueEditorProvider[]
}
export interface BluePluginHostOptions { readonly now?: () => number }

const API_MAJOR = /^\^?1(?:\.|$)/
const ID_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,127}$/u
const OWNER_ID_PATTERN = /^(?:blue[.:-]|@dsh-blue\/)/u
const IMPLEMENTED_CAPABILITIES = new Set<Capability>(['commands', 'status', 'notifications', 'panes', 'overlays', 'editor.extensions', 'session.read', 'session.act', 'status.provider', 'editor.provider'])

function success<T>(value: T): BlueResult<T> { return { ok: true, value } }
function failure(code: BlueErrorCode, message: string): BlueResult<never> { return { ok: false, code, message } }
function message(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback }
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
function absent(capability: Capability): BlueResult<never> { return failure('BLUE_CAPABILITY_ABSENT', `capability "${capability}" has no active Blue owner adapter`) }
function consumerDisposed(): BlueResult<never> { return failure('BLUE_ACTION_REJECTED', 'plugin consumer is disposed') }
function aborted(): BlueResult<never> { return failure('BLUE_ABORTED', 'session action was aborted') }
function sessionUnavailable(): BlueResult<never> { return failure('BLUE_SESSION_UNAVAILABLE', 'no Blue session is active') }
function staleSession(): BlueResult<never> { return failure('BLUE_ACTION_REJECTED', 'session action result is stale') }
function rejectDisposedAdmission(added: BlueResult<BlueRegistration>): BlueResult<never> { if (added.ok) added.value.dispose(); return consumerDisposed() }
function invalid(error: unknown): BlueResult<never> { return failure('BLUE_INVALID_CONTRIBUTION', message(error, 'plugin input could not be inspected')) }

function own(input: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key)
  if (descriptor === undefined) return undefined
  if (!('value' in descriptor)) throw new Error(`${key} must be an own data property`)
  return descriptor.value
}
function fields(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!object(input)) return {}
  const copy: Record<string, unknown> = {}
  for (const key of keys) copy[key] = own(input, key)
  return copy
}
function cloneData(input: unknown, seen = new Set<object>()): unknown {
  if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('nested contribution numbers must be finite')
    return input
  }
  if (!object(input) || seen.has(input)) throw new Error('nested contribution data must be finite, acyclic JSON-shaped data')
  seen.add(input)
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (Array.isArray(input)) {
    const length = descriptors.length
    /* v8 ignore next -- Array length is a non-configurable own data descriptor. */
    if (length === undefined || !('value' in length) || typeof length.value !== 'number') throw new Error('array length must be an own data property')
    const copy: unknown[] = []
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = descriptors[String(index)]
      if (descriptor === undefined || !('value' in descriptor)) throw new Error('array entries must be own data properties')
      copy.push(cloneData(descriptor.value, seen))
    }
    seen.delete(input)
    return Object.freeze(copy)
  }
  const copy: Record<string, unknown> = {}
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable) continue
    if (!('value' in descriptor)) throw new Error(`${key} must be an own data property`)
    Object.defineProperty(copy, key, { value: cloneData(descriptor.value, seen), enumerable: true })
  }
  seen.delete(input)
  return Object.freeze(copy)
}

function sessionSnapshot(input: unknown): BlueSessionSnapshot | null {
  if (input === null) return null
  const value = fields(input, ['revision', 'id', 'cwd', 'status', 'mode', 'model'])
  if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('session revision must be a non-negative safe integer')
  if (typeof value.id !== 'string' || value.id.length === 0) throw new Error('session id must be a non-empty string')
  if (typeof value.cwd !== 'string') throw new Error('session cwd must be a string')
  if (!['idle', 'running', 'waiting', 'failed'].includes(value.status as string)) throw new Error('session status is invalid')
  if (!['normal', 'plan', 'yolo'].includes(value.mode as string)) throw new Error('session mode is invalid')
  let model: BlueSessionSnapshot['model']
  if (value.model !== undefined) {
    const modelValue = fields(value.model, ['id', 'provider', 'effort'])
    if (typeof modelValue.id !== 'string' || modelValue.id.length === 0) throw new Error('session model id must be a non-empty string')
    for (const key of ['provider', 'effort'] as const) if (modelValue[key] !== undefined && typeof modelValue[key] !== 'string') throw new Error(`session model ${key} must be a string`)
    model = Object.freeze({ id: modelValue.id, ...(modelValue.provider === undefined ? {} : { provider: modelValue.provider }), ...(modelValue.effort === undefined ? {} : { effort: modelValue.effort }) }) as BlueSessionSnapshot['model']
  }
  return Object.freeze({ revision: value.revision, id: value.id, cwd: value.cwd, status: value.status, mode: value.mode, ...(model === undefined ? {} : { model }) }) as BlueSessionSnapshot
}

function sessionAction(input: unknown): BlueResult<BlueSessionAction> {
  try {
    const value = fields(input, ['kind', 'text'])
    if (!['followup', 'steer', 'interrupt'].includes(value.kind as string)) return failure('BLUE_INVALID_CONTRIBUTION', 'session action kind is invalid')
    if (value.kind !== 'interrupt' && typeof value.text !== 'string') return failure('BLUE_INVALID_CONTRIBUTION', 'session text actions require text')
    if (value.kind === 'interrupt' && value.text !== undefined) return failure('BLUE_INVALID_CONTRIBUTION', 'session interrupt does not accept text')
    return success(Object.freeze(value.kind === 'interrupt' ? { kind: 'interrupt' } : { kind: value.kind, text: value.text }) as BlueSessionAction)
  } catch (error) { return invalid(error) }
}

function passiveEditorNode(input: unknown): boolean {
  if (!object(input)) return false
  const kind = own(input, 'kind')
  if (kind === 'stack') {
    const children = own(input, 'children')
    return Array.isArray(children) && children.every(child => object(child) && passiveEditorNode(own(child, 'node')))
  }
  if (kind === 'surface') {
    const child = own(input, 'child')
    const footer = own(input, 'footer')
    return passiveEditorNode(child) && (footer === undefined || passiveEditorNode(footer))
  }
  if (kind === 'sections') {
    const sections = own(input, 'sections')
    return Array.isArray(sections) && sections.every(section => object(section) && passiveEditorNode(own(section, 'body')))
  }
  return ['text', 'rich-text', 'fields', 'code', 'diff', 'progress', 'spacer', 'divider'].includes(kind as string)
}

function meta(input: Record<string, unknown>, bounded = false): BlueResult<{ id: string, priority?: number }> {
  const id = own(input, 'id')
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return failure('BLUE_INVALID_CONTRIBUTION', 'contribution id must be 1-128 lowercase namespace characters')
  if (OWNER_ID_PATTERN.test(id)) return failure('BLUE_ACTION_REJECTED', `contribution id "${id}" uses Blue's owner namespace`)
  const priority = own(input, 'priority')
  if (priority !== undefined && (typeof priority !== 'number' || !Number.isFinite(priority) || !Number.isInteger(priority))) return failure('BLUE_INVALID_CONTRIBUTION', 'contribution priority must be a finite integer')
  if (bounded && priority !== undefined && (priority < 0 || priority > 100)) return failure('BLUE_LIMIT_EXCEEDED', 'contribution priority must be an integer from 0 through 100')
  return success(priority === undefined ? { id } : { id, priority })
}

function command(input: unknown): BlueResult<BlueCommandContribution> {
  const value = fields(input, ['id', 'priority', 'label', 'execute']); const m = meta(value, true); if (!m.ok) return m
  if (!/^[a-z][a-z0-9_-]*$/u.test(m.value.id) || typeof value.label !== 'string' || value.label.trim().length === 0 || typeof value.execute !== 'function') return failure('BLUE_INVALID_CONTRIBUTION', 'command contributions need a lowercase command id, label, and execute function')
  return success(Object.freeze({ ...m.value, label: value.label, execute: value.execute }) as BlueCommandContribution)
}
function status(input: unknown): BlueResult<BlueStatusEntryContribution> {
  const value = fields(input, ['id', 'priority', 'render']); const m = meta(value, true); if (!m.ok) return m
  const render = value.render
  return typeof render === 'function' ? success(Object.freeze({ ...m.value, render }) as BlueStatusEntryContribution) : failure('BLUE_INVALID_CONTRIBUTION', 'status contributions need a render function')
}
function pane(input: unknown): BlueResult<BluePaneContribution> {
  const value = fields(input, ['id', 'priority', 'title', 'placement', 'size', 'narrow', 'render', 'onEvent']); const m = meta(value, true); if (!m.ok) return m
  if (value.title !== undefined && typeof value.title !== 'string') return failure('BLUE_INVALID_CONTRIBUTION', 'pane title must be a string')
  if (!['header', 'left', 'right', 'bottom'].includes(value.placement as string)) return failure('BLUE_INVALID_CONTRIBUTION', 'pane placement is invalid')
  if (value.narrow !== undefined && !['bottom', 'overlay', 'hidden'].includes(value.narrow as string)) return failure('BLUE_INVALID_CONTRIBUTION', 'pane narrow behavior is invalid')
  if (typeof value.render !== 'function') return failure('BLUE_INVALID_CONTRIBUTION', 'pane contributions need a render function')
  if (value.onEvent !== undefined && typeof value.onEvent !== 'function') return failure('BLUE_INVALID_CONTRIBUTION', 'pane onEvent must be a function')
  let size: BluePaneContribution['size']
  if (value.size !== undefined) {
    if (!object(value.size)) return failure('BLUE_INVALID_CONTRIBUTION', 'pane size must be an object')
    const safeSize = fields(value.size, ['min', 'preferred', 'max'])
    const { min, preferred, max } = safeSize
    for (const dimension of [min, preferred === 'auto' ? undefined : preferred, max]) if (dimension !== undefined && (typeof dimension !== 'number' || !Number.isFinite(dimension) || dimension < 0)) return failure('BLUE_INVALID_CONTRIBUTION', 'pane sizes must be finite non-negative numbers or preferred "auto"')
    if (typeof min === 'number' && typeof max === 'number' && min > max) return failure('BLUE_INVALID_CONTRIBUTION', 'pane minimum size cannot exceed maximum size')
    if (typeof preferred === 'number' && ((typeof min === 'number' && preferred < min) || (typeof max === 'number' && preferred > max))) return failure('BLUE_INVALID_CONTRIBUTION', 'pane preferred size must be within its minimum and maximum')
    size = Object.freeze({
      ...(min === undefined ? {} : { min: min as number }),
      ...(preferred === undefined ? {} : { preferred: preferred as number | 'auto' }),
      ...(max === undefined ? {} : { max: max as number }),
    })
  }
  return success(Object.freeze({ ...m.value, ...(value.title === undefined ? {} : { title: value.title }), placement: value.placement, ...(size === undefined ? {} : { size }), ...(value.narrow === undefined ? {} : { narrow: value.narrow }), render: value.render, ...(value.onEvent === undefined ? {} : { onEvent: value.onEvent }) }) as BluePaneContribution)
}

function percentage(value: string): boolean { const match = /^(\d+(?:\.\d+)?)%$/u.exec(value); return match !== null && Number(match[1]) > 0 && Number(match[1]) <= 100 }
function dimension(value: unknown, percent: boolean): boolean { return (typeof value === 'number' && Number.isFinite(value) && value > 0) || (percent && typeof value === 'string' && percentage(value)) }
function overlay(input: unknown): BlueResult<BlueOverlayRequest & { readonly capturing: boolean, readonly dismissible: boolean }> {
  const value = fields(input, ['id', 'title', 'capturing', 'dismissible', 'anchor', 'width', 'minWidth', 'maxHeight', 'render', 'onEvent']); const m = meta(value); if (!m.ok) return m
  if (value.title !== undefined && typeof value.title !== 'string') return failure('BLUE_INVALID_CONTRIBUTION', 'overlay title must be a string')
  if (value.capturing !== undefined && typeof value.capturing !== 'boolean') return failure('BLUE_INVALID_CONTRIBUTION', 'overlay capturing must be a boolean')
  if (value.dismissible !== undefined && typeof value.dismissible !== 'boolean') return failure('BLUE_INVALID_CONTRIBUTION', 'overlay dismissible must be a boolean')
  if (value.anchor !== undefined && !['center', 'top', 'bottom', 'left', 'right'].includes(value.anchor as string)) return failure('BLUE_INVALID_CONTRIBUTION', 'overlay anchor is invalid')
  for (const [label, value_, percent] of [['width', value.width, true], ['minWidth', value.minWidth, false], ['maxHeight', value.maxHeight, true]] as const) if (value_ !== undefined && !dimension(value_, percent)) return failure('BLUE_INVALID_CONTRIBUTION', `overlay ${label} must be a positive number${percent ? ' or percentage' : ''}`)
  if (typeof value.render !== 'function') return failure('BLUE_INVALID_CONTRIBUTION', 'overlay requests need a render function')
  if (value.onEvent !== undefined && typeof value.onEvent !== 'function') return failure('BLUE_INVALID_CONTRIBUTION', 'overlay onEvent must be a function')
  return success(Object.freeze({ id: m.value.id, ...(value.title === undefined ? {} : { title: value.title }), capturing: value.capturing ?? false, dismissible: value.dismissible ?? true, ...(value.anchor === undefined ? {} : { anchor: value.anchor }), ...(value.width === undefined ? {} : { width: value.width }), ...(value.minWidth === undefined ? {} : { minWidth: value.minWidth }), ...(value.maxHeight === undefined ? {} : { maxHeight: value.maxHeight }), render: value.render, ...(value.onEvent === undefined ? {} : { onEvent: value.onEvent }) }) as BlueOverlayRequest & { readonly capturing: boolean, readonly dismissible: boolean })
}

function extension(input: unknown): BlueResult<BlueEditorExtensionContribution> {
  const value = fields(input, ['id', 'priority', 'before', 'after', 'hint', 'diagnostics', 'actions', 'onEvent', 'complete', 'completeV2', 'transformSubmit']); const m = meta(value, true); if (!m.ok) return m
  const before = value.before === undefined ? undefined : cloneData(value.before)
  const after = value.after === undefined ? undefined : cloneData(value.after)
  if (before !== undefined && !passiveEditorNode(before)) return failure('BLUE_INVALID_CONTRIBUTION', 'editor extension before must be a passive UI node')
  if (after !== undefined && !passiveEditorNode(after)) return failure('BLUE_INVALID_CONTRIBUTION', 'editor extension after must be a passive UI node')
  if (value.hint !== undefined && typeof value.hint !== 'string') return failure('BLUE_INVALID_CONTRIBUTION', 'editor extension hint must be a string')
  for (const field of ['diagnostics', 'actions'] as const) if (value[field] !== undefined && !Array.isArray(value[field])) return failure('BLUE_INVALID_CONTRIBUTION', `editor extension ${field} must be an array`)
  for (const field of ['onEvent', 'complete', 'completeV2', 'transformSubmit'] as const) if (value[field] !== undefined && typeof value[field] !== 'function') return failure('BLUE_INVALID_CONTRIBUTION', `editor extension ${field} must be a function`)
  return success(Object.freeze({ ...m.value, ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }), ...(value.hint === undefined ? {} : { hint: value.hint }), ...(value.diagnostics === undefined ? {} : { diagnostics: cloneData(value.diagnostics) }), ...(value.actions === undefined ? {} : { actions: cloneData(value.actions) }), ...(value.onEvent === undefined ? {} : { onEvent: value.onEvent }), ...(value.complete === undefined ? {} : { complete: value.complete }), ...(value.completeV2 === undefined ? {} : { completeV2: value.completeV2 }), ...(value.transformSubmit === undefined ? {} : { transformSubmit: value.transformSubmit }) }) as BlueEditorExtensionContribution)
}
function statusProvider(input: unknown): BlueResult<BlueStatusProvider> {
  const value = fields(input, ['id', 'render']); const m = meta(value); if (!m.ok) return m
  const render = value.render
  return typeof render === 'function' ? success(Object.freeze({ id: m.value.id, render }) as BlueStatusProvider) : failure('BLUE_INVALID_CONTRIBUTION', 'status providers need a render function')
}
function editorProvider(input: unknown): BlueResult<BlueEditorProvider> {
  const value = fields(input, ['id', 'render', 'onEvent']); const m = meta(value); if (!m.ok) return m
  if (typeof value.render !== 'function') return failure('BLUE_INVALID_CONTRIBUTION', 'editor providers need a render function')
  if (value.onEvent !== undefined && typeof value.onEvent !== 'function') return failure('BLUE_INVALID_CONTRIBUTION', 'editor provider onEvent must be a function')
  return success(Object.freeze({ id: m.value.id, render: value.render, ...(value.onEvent === undefined ? {} : { onEvent: value.onEvent }) }) as BlueEditorProvider)
}

class Registration implements BlueRegistration {
  private done = false
  get disposed(): boolean { return this.done }
  constructor(private readonly cleanup: () => void) {}
  dispose(): void { if (!this.done) { this.done = true; this.cleanup() } }
}

class ConsumerLifetime {
  private done = false
  get disposed(): boolean { return this.done }
  dispose(): void { this.done = true }
}

class Aggregate<T extends Prioritized> {
  private readonly entries = new Map<string, { value: T, sequence: number }>()
  private readonly listeners = new Set<() => void>()
  private nextSequence = 0
  private revisionValue = 0
  constructor(private readonly sortById: boolean, private readonly changed: () => void) {}
  get revision(): number { return this.revisionValue }
  add(value: T): BlueResult<BlueRegistration> {
    if (this.entries.has(value.id)) return failure('BLUE_DUPLICATE_ID', `contribution "${value.id}" is already registered`)
    this.entries.set(value.id, { value, sequence: this.nextSequence++ })
    try { this.emit() } catch (error) { this.entries.delete(value.id); this.touch(); return failure('BLUE_DUPLICATE_ID', message(error, `contribution "${value.id}" was rejected`)) }
    return success(new Registration(() => { this.entries.delete(value.id); this.touch() }))
  }
  replace(id: string, value: T): void { this.entries.set(id, { value, sequence: this.entries.get(id)!.sequence }); this.touch() }
  list(): readonly T[] {
    return Object.freeze([...this.entries.values()]
      .sort((a, b) => (a.value.priority ?? 50) - (b.value.priority ?? 50) || (this.sortById ? a.value.id.localeCompare(b.value.id) : a.sequence - b.sequence))
      .map(entry => entry.value))
  }
  subscribe(listener: () => void): BlueRegistration { this.listeners.add(listener); return new Registration(() => { this.listeners.delete(listener) }) }
  touch(): void { this.revisionValue += 1; this.changed(); for (const listener of this.listeners) try { listener() } catch { /* owner refresh errors are contained */ } }
  clear(): void { this.entries.clear(); this.touch(); this.listeners.clear() }
  private emit(): void { this.revisionValue += 1; this.changed(); for (const listener of this.listeners) listener() }
}
class Ordered<T extends { readonly id: string }> {
  private readonly entries = new Map<string, T>()
  private readonly listeners = new Set<() => void>()
  constructor(private readonly changed: () => void) {}
  get size(): number { return this.entries.size }
  add(value: T): BlueResult<BlueRegistration> {
    if (this.entries.has(value.id)) return failure('BLUE_DUPLICATE_ID', `contribution "${value.id}" is already registered`)
    this.entries.set(value.id, value)
    try { this.emit() } catch (error) { this.entries.delete(value.id); this.touch(); return failure('BLUE_DUPLICATE_ID', message(error, `contribution "${value.id}" was rejected`)) }
    return success(new Registration(() => { this.entries.delete(value.id); this.touch() }))
  }
  list(): readonly T[] { return Object.freeze([...this.entries.values()]) }
  replace(id: string, value: T): void { this.entries.set(id, value); this.touch() }
  subscribe(listener: () => void): BlueRegistration { this.listeners.add(listener); return new Registration(() => { this.listeners.delete(listener) }) }
  touch(): void { this.changed(); for (const listener of this.listeners) try { listener() } catch { /* owner refresh errors are contained */ } }
  clear(): void { this.entries.clear(); this.touch(); this.listeners.clear() }
  private emit(): void { this.changed(); for (const listener of this.listeners) listener() }
}

class RefreshGate {
  private readonly times: number[] = []
  private cancel: (() => void) | undefined
  constructor(private readonly capability: Capability, private readonly ready: () => boolean, private readonly disposed: () => boolean, private readonly now: () => number, private readonly notify: () => void) {}
  refresh(): BlueResult {
    if (this.disposed()) return failure('BLUE_ACTION_REJECTED', 'contribution is disposed')
    if (!this.ready()) return absent(this.capability)
    try {
      const current = this.now()
      while (this.times.length > 0 && this.times[0]! <= current - 1_000) this.times.shift()
      if (this.times.length >= 20) return failure('BLUE_LIMIT_EXCEEDED', 'refresh limit is 20 per contribution per second')
      this.times.push(current)
      if (this.cancel === undefined) {
        let active = true
        queueMicrotask(() => { if (active) { this.cancel = undefined; this.notify() } })
        this.cancel = () => { active = false }
      }
      return success(undefined)
    } catch (error) { return invalid(error) }
  }
  dispose(): void { this.cancel?.(); this.cancel = undefined; this.times.length = 0 }
}
class RefreshRegistration implements BlueRefreshRegistration {
  private done = false
  private readonly gate: RefreshGate
  get disposed(): boolean { return this.done }
  constructor(capability: Capability, ready: () => boolean, now: () => number, notify: () => void, private readonly cleanup: () => void) { this.gate = new RefreshGate(capability, ready, () => this.done, now, notify) }
  refresh(): BlueResult { return this.gate.refresh() }
  dispose(): void { if (!this.done) { this.done = true; this.gate.dispose(); this.cleanup() } }
}

class Scoped<T extends Prioritized> implements BlueRegistry<T> {
  private readonly entries = new Map<string, T>()
  private readonly handles = new Set<Registration>()
  constructor(private readonly capability: Capability, private readonly aggregate: Aggregate<T>, private readonly ready: () => boolean, private readonly lifetime: ConsumerLifetime, private readonly normalize: (input: unknown) => BlueResult<T>) {}
  register(input: T): BlueResult<BlueRegistration> {
    if (this.lifetime.disposed) return consumerDisposed()
    if (!this.ready()) return absent(this.capability)
    try {
      const result = this.normalize(input); if (!result.ok) return result
      const value = result.value
      if (this.entries.has(value.id)) return failure('BLUE_DUPLICATE_ID', `contribution "${value.id}" is already registered`)
      const added = this.aggregate.add(value)
      if (this.lifetime.disposed) return rejectDisposedAdmission(added)
      if (!added.ok) return added
      this.entries.set(value.id, value)
      let handle: Registration
      handle = new Registration(() => { this.entries.delete(value.id); this.handles.delete(handle); added.value.dispose() })
      this.handles.add(handle); return success(handle)
    } catch (error) { return invalid(error) }
  }
  list(): readonly T[] { return Object.freeze([...this.entries.values()]) }
  dispose(): void { for (const handle of this.handles) handle.dispose() }
}
class ScopedRefresh<T extends Prioritized> {
  private readonly entries = new Map<string, T>()
  private readonly handles = new Set<RefreshRegistration>()
  constructor(private readonly capability: Capability, private readonly aggregate: Aggregate<T>, private readonly ready: () => boolean, private readonly lifetime: ConsumerLifetime, private readonly now: () => number, private readonly normalize: (input: unknown) => BlueResult<T>) {}
  register(input: T): BlueResult<BlueRefreshRegistration> {
    if (this.lifetime.disposed) return consumerDisposed()
    if (!this.ready()) return absent(this.capability)
    try {
      const result = this.normalize(input); if (!result.ok) return result
      const value = result.value
      if (this.entries.has(value.id)) return failure('BLUE_DUPLICATE_ID', `contribution "${value.id}" is already registered`)
      const added = this.aggregate.add(value)
      if (this.lifetime.disposed) return rejectDisposedAdmission(added)
      if (!added.ok) return added
      this.entries.set(value.id, value)
      let handle: RefreshRegistration
      handle = new RefreshRegistration(this.capability, this.ready, this.now, () => this.aggregate.touch(), () => { this.entries.delete(value.id); this.handles.delete(handle); added.value.dispose() })
      this.handles.add(handle); return success(handle)
    } catch (error) { return invalid(error) }
  }
  list(): readonly T[] { return Object.freeze([...this.entries.values()]) }
  dispose(): void { for (const handle of this.handles) handle.dispose() }
}

interface HostState {
  readonly lifetimes: Set<ConsumerLifetime>; readonly registries: Set<{ dispose(): void }>; readonly notifications: Set<Notifications>; readonly notificationObservers: Set<(notification: BlueNotification) => void>
  readonly commands: Aggregate<BlueCommandContribution>; readonly status: Aggregate<BlueStatusEntryContribution>
  readonly panes: Aggregate<BluePluginHostPaneEntry>; readonly overlays: Ordered<BluePluginHostOverlayEntry>; readonly extensions: Aggregate<BlueEditorExtensionContribution>
  readonly statusProviders: Aggregate<BlueStatusProvider>; readonly editorProviders: Aggregate<BlueEditorProvider>; readonly owners: Map<Capability, number>
  readonly gestureOwners: Map<EffectOwner, number>; readonly gestures: Map<object, EffectOwner>; readonly ownerGestures: Map<EffectOwner, Set<object>>; readonly now: () => number
  readonly overlayOwners: Map<EffectOwner, number>; readonly overlayClosers: Map<string, { entry: BluePluginHostOverlayEntry, close: () => void }>
  readonly paneCounts: Map<object, number>; readonly capturingConsumers: Set<object>
  readonly revision: { value: number }
  readonly sessionListeners: Set<(snapshot: BlueSessionSnapshot | null) => void>
  sessionOwner: SessionOwner | undefined
  sessionSnapshot: BlueSessionSnapshot | null
  nextSessionGeneration: number
  nextOverlayOrder: number
}

interface SessionOwner {
  readonly generation: number
  readonly requester: BlueSessionRequester
  readonly controllers: Set<AbortController>
  subscription: BlueRegistration | undefined
  lastRevision: number
  tail: Promise<void>
}

function emitSession(state: HostState): void {
  for (const listener of state.sessionListeners) try { listener(state.sessionSnapshot) } catch { /* plugin observer failures are contained */ }
}

function publishSession(state: HostState, owner: SessionOwner, input: unknown): void {
  if (state.sessionOwner !== owner) return
  let snapshot: BlueSessionSnapshot | null
  try { snapshot = sessionSnapshot(input) } catch { return }
  if (snapshot !== null && snapshot.revision <= owner.lastRevision) return
  if (snapshot !== null) owner.lastRevision = snapshot.revision
  if (snapshot === null && state.sessionSnapshot === null) return
  const previousSessionId = state.sessionSnapshot?.id
  state.sessionSnapshot = snapshot
  if (previousSessionId !== undefined && previousSessionId !== snapshot?.id) for (const controller of owner.controllers) controller.abort()
  emitSession(state)
}

class SessionReadFacade implements BlueSessionReader {
  private readonly handles = new Set<Registration>()
  constructor(private readonly state: HostState, private readonly lifetime: ConsumerLifetime, private readonly effect: Consumer['effect']) {}
  current(): BlueSessionSnapshot | null { return this.lifetime.disposed ? null : this.state.sessionSnapshot }
  subscribe(listener: (snapshot: BlueSessionSnapshot | null) => void): BlueRegistration {
    if (this.lifetime.disposed) { const handle = new Registration(() => {}); handle.dispose(); return handle }
    this.state.sessionListeners.add(listener)
    let handle: Registration
    handle = new Registration(() => { this.state.sessionListeners.delete(listener); this.handles.delete(handle) })
    this.handles.add(handle)
    try { this.effect(() => () => handle.dispose()); listener(this.state.sessionSnapshot) }
    catch (error) { handle.dispose(); throw error }
    return handle
  }
  dispose(): void { for (const handle of this.handles) handle.dispose() }
}

class SessionActionFacade implements BlueSessionRequester {
  private readonly controllers = new Set<AbortController>()
  constructor(private readonly state: HostState, private readonly lifetime: ConsumerLifetime) {}
  async request(input: BlueSessionAction, options: { readonly signal?: AbortSignal } = {}): Promise<BlueResult> {
    if (this.lifetime.disposed) return consumerDisposed()
    const action = sessionAction(input)
    if (!action.ok) return action
    const owner = this.state.sessionOwner
    if (owner === undefined) return absent('session.act')
    const snapshot = this.state.sessionSnapshot
    if (snapshot === null) return sessionUnavailable()
    if (options.signal?.aborted === true) return aborted()
    const sessionId = snapshot.id
    const controller = new AbortController()
    const forwardAbort = (): void => controller.abort()
    options.signal?.addEventListener('abort', forwardAbort, { once: true })
    this.controllers.add(controller)
    owner.controllers.add(controller)
    const completion = Promise.withResolvers<BlueResult>()
    let completed = false
    let running = false
    const finish = (result: BlueResult): void => { completed = true; completion.resolve(result) }
    const fence = (): BlueResult => {
      if (this.lifetime.disposed) return consumerDisposed()
      if (this.state.sessionOwner?.generation !== owner.generation || this.state.sessionSnapshot?.id !== sessionId) return staleSession()
      return aborted()
    }
    const stop = (): void => { if (!running) finish(fence()) }
    controller.signal.addEventListener('abort', stop, { once: true })
    const execute = async (): Promise<void> => {
      if (completed) return
      running = true
      const stopped = Promise.withResolvers<void>()
      const onAbort = (): void => stopped.resolve()
      controller.signal.addEventListener('abort', onAbort, { once: true })
      const settled = Promise.resolve()
        .then(() => owner.requester.request(action.value, { signal: controller.signal }))
        .then(result => ({ result } as const), error => ({ error } as const))
      const outcome = await Promise.race([settled, stopped.promise])
      controller.signal.removeEventListener('abort', onAbort)
      if (outcome === undefined) { finish(fence()); return }
      finish('result' in outcome ? outcome.result : failure('BLUE_ACTION_REJECTED', message(outcome.error, 'session action failed')))
    }
    owner.tail = owner.tail.then(execute)
    return completion.promise.finally(() => {
      options.signal?.removeEventListener('abort', forwardAbort)
      controller.signal.removeEventListener('abort', stop)
      this.controllers.delete(controller)
      owner.controllers.delete(controller)
    })
  }
  dispose(): void { for (const controller of this.controllers) controller.abort(); this.controllers.clear() }
}

class PaneHandle extends RefreshRegistration implements BluePaneRegistration {
  constructor(ready: () => boolean, now: () => number, notify: () => void, cleanup: () => void, private readonly set: (hidden: boolean) => void, private readonly paneReady: () => boolean) { super('panes', ready, now, notify, cleanup) }
  setHidden(hidden: boolean): BlueResult {
    if (this.disposed) return failure('BLUE_ACTION_REJECTED', 'pane is disposed')
    if (!this.paneReady()) return absent('panes')
    if (typeof hidden !== 'boolean') return failure('BLUE_INVALID_CONTRIBUTION', 'pane hidden state must be a boolean')
    this.set(hidden); return success(undefined)
  }
}
class Panes implements BluePaneRegistry {
  private readonly entries = new Map<string, BluePaneContribution>(); private readonly handles = new Set<PaneHandle>()
  constructor(private readonly state: HostState, private readonly consumer: object, private readonly lifetime: ConsumerLifetime) {}
  register(input: BluePaneContribution): BlueResult<BluePaneRegistration> {
    if (this.lifetime.disposed) return consumerDisposed()
    if (!ready(this.state, 'panes')) return absent('panes')
    if ((this.state.paneCounts.get(this.consumer) ?? 0) >= 8) return failure('BLUE_LIMIT_EXCEEDED', 'a consumer may register at most 8 panes')
    try {
      const result = pane(input); if (!result.ok) return result
      const value = result.value
      if (this.entries.has(value.id)) return failure('BLUE_DUPLICATE_ID', `contribution "${value.id}" is already registered`)
      let revision = 0
      let entry: BluePluginHostPaneEntry = Object.freeze({ id: value.id, ...(value.priority === undefined ? {} : { priority: value.priority }), contribution: value, hidden: false, revision })
      const added = this.state.panes.add(entry)
      if (this.lifetime.disposed) return rejectDisposedAdmission(added)
      if (!added.ok) return added
      this.entries.set(value.id, value)
      this.state.paneCounts.set(this.consumer, (this.state.paneCounts.get(this.consumer) ?? 0) + 1)
      const isReady = () => ready(this.state, 'panes')
      let handle: PaneHandle
      handle = new PaneHandle(isReady, this.state.now, () => {
        entry = Object.freeze({ ...entry, revision: ++revision })
        this.state.panes.replace(value.id, entry)
      }, () => {
        this.entries.delete(value.id); this.handles.delete(handle); added.value.dispose()
        const count = this.state.paneCounts.get(this.consumer)
        /* v8 ignore else -- host disposal drains every registry before clearing pane counts. */
        if (count !== undefined) {
          if (count <= 1) this.state.paneCounts.delete(this.consumer)
          else this.state.paneCounts.set(this.consumer, count - 1)
        }
      }, hidden => { if (entry.hidden !== hidden) { entry = Object.freeze({ ...entry, hidden }); this.state.panes.replace(value.id, entry) } }, isReady)
      this.handles.add(handle); return success(handle)
    } catch (error) { return invalid(error) }
  }
  list(): readonly BluePaneContribution[] { return Object.freeze([...this.entries.values()]) }
  dispose(): void { for (const handle of this.handles) handle.dispose() }
}
class OverlayHandle implements BluePublicOverlayHandle {
  private done = false; private readonly gate: RefreshGate
  get disposed(): boolean { return this.done } get closed(): boolean { return this.done }
  constructor(isReady: () => boolean, now: () => number, notify: () => void, private readonly cleanup: () => void) { this.gate = new RefreshGate('overlays', isReady, () => this.done, now, notify) }
  refresh(): BlueResult { return this.gate.refresh() } close(): void { this.dispose() }
  dispose(): void { if (!this.done) { this.done = true; this.gate.dispose(); this.cleanup() } }
}
class Overlays implements BlueOverlayRegistry {
  private readonly handles = new Set<OverlayHandle>()
  constructor(private readonly state: HostState, private readonly consumer: object, private readonly lifetime: ConsumerLifetime) {}
  open(input: BlueOverlayRequest, options?: BlueOverlayOpenOptions): BlueResult<BluePublicOverlayHandle> {
    if (this.lifetime.disposed) return consumerDisposed()
    if (!ready(this.state, 'overlays')) return absent('overlays')
    try {
      const result = overlay(input); if (!result.ok) return result
      const request = result.value
      if (request.capturing && this.state.overlayOwners.size === 0) return failure('BLUE_ACTION_REJECTED', 'capturing overlays require an active renderer owner')
      if (request.capturing && !consumeGesture(this.state, options?.userGesture)) return failure('BLUE_ACTION_REJECTED', 'capturing overlays require a valid one-shot user gesture')
      if (this.state.overlays.size >= 4) return failure('BLUE_LIMIT_EXCEEDED', 'the global overlay stack is limited to 4 entries')
      if (request.capturing && this.state.capturingConsumers.has(this.consumer)) return failure('BLUE_LIMIT_EXCEEDED', 'a consumer may open only one capturing overlay')
      let handle: OverlayHandle | undefined
      let closeRequested = false
      const close = () => {
        if (handle === undefined) closeRequested = true
        else handle.close()
      }
      let revision = 0
      let entry: BluePluginHostOverlayEntry = Object.freeze({ id: request.id, request, order: this.state.nextOverlayOrder++, revision })
      const closer = { entry, close }
      if (!this.state.overlayClosers.has(request.id)) this.state.overlayClosers.set(request.id, closer)
      const added = this.state.overlays.add(entry)
      if (this.lifetime.disposed) {
        this.state.overlayClosers.delete(request.id)
        return rejectDisposedAdmission(added)
      }
      if (!added.ok) {
        if (this.state.overlayClosers.get(request.id) === closer) this.state.overlayClosers.delete(request.id)
        return added
      }
      if (request.capturing) this.state.capturingConsumers.add(this.consumer)
      handle = new OverlayHandle(() => ready(this.state, 'overlays'), this.state.now, () => {
        entry = Object.freeze({ ...entry, revision: ++revision })
        closer.entry = entry
        this.state.overlays.replace(request.id, entry)
      }, () => {
        this.handles.delete(handle!)
        this.state.overlayClosers.delete(request.id)
        if (request.capturing) this.state.capturingConsumers.delete(this.consumer)
        added.value.dispose()
      })
      const activeHandle = handle
      this.handles.add(activeHandle)
      if (closeRequested) activeHandle.close()
      return success(activeHandle)
    } catch (error) { return invalid(error) }
  }
  dispose(): void { for (const handle of this.handles) handle.dispose() }
}
class Notifications {
  private readonly listeners = new Set<(notification: BlueNotification) => void>(); private readonly handles = new Set<Registration>()
  constructor(private readonly state: HostState, private readonly lifetime: ConsumerLifetime, private readonly effect: Consumer['effect']) {}
  publish(input: BlueNotification): BlueResult {
    if (this.lifetime.disposed) return consumerDisposed()
    if (!ready(this.state, 'notifications')) return absent('notifications')
    try {
      const safe = fields(input, ['id', 'view', 'tone'])
      if (typeof safe.id !== 'string' || !ID_PATTERN.test(safe.id)) return failure('BLUE_INVALID_CONTRIBUTION', 'notification id must be 1-128 lowercase namespace characters')
      if (!object(safe.view)) return failure('BLUE_INVALID_CONTRIBUTION', 'notification view must be an object')
      if (safe.tone !== undefined && !['default', 'muted', 'accent', 'success', 'warning', 'danger'].includes(safe.tone as string)) return failure('BLUE_INVALID_CONTRIBUTION', 'notification tone is invalid')
      const value = Object.freeze({ id: safe.id, view: cloneData(safe.view), ...(safe.tone === undefined ? {} : { tone: safe.tone }) }) as BlueNotification
      for (const target of this.state.notifications) target.emit(value)
      for (const observer of this.state.notificationObservers) observer(value)
      return success(undefined)
    } catch (error) { return failure('BLUE_INVALID_CONTRIBUTION', message(error, 'notification was rejected')) }
  }
  subscribe(listener: (notification: BlueNotification) => void): BlueRegistration {
    if (this.lifetime.disposed) {
      const handle = new Registration(() => {})
      handle.dispose()
      return handle
    }
    this.listeners.add(listener); let handle: Registration
    handle = new Registration(() => { this.listeners.delete(listener); this.handles.delete(handle) })
    this.handles.add(handle)
    try { this.effect(() => () => handle.dispose()) }
    catch (error) { handle.dispose(); throw error }
    return handle
  }
  emit(value: BlueNotification): void { for (const listener of this.listeners) try { listener(value) } catch { /* plugin observer failures are contained */ } }
  dispose(): void { for (const handle of this.handles) handle.dispose(); this.listeners.clear() }
}

const HOST_STATE_KEY = Symbol.for('@dsh-blue/blue-api/plugin-host-states/v1')
const hostGlobals = globalThis as unknown as Record<symbol, unknown>
const existingHostStates = hostGlobals[HOST_STATE_KEY]
/* v8 ignore next -- the first loaded source/build copy necessarily creates the shared map. */
const HOST_STATES = existingHostStates instanceof WeakMap ? existingHostStates as WeakMap<BluePluginHostService, HostState> : new WeakMap<BluePluginHostService, HostState>()
hostGlobals[HOST_STATE_KEY] = HOST_STATES

function stateOf(host: BluePluginHostService): HostState {
  const original = (host as BluePluginHostService & { [symbols.original]?: BluePluginHostService })[symbols.original]
  const state = HOST_STATES.get(original ?? host)
  if (state === undefined) throw new Error('Blue plugin host is not active')
  return state
}
function ownerStateOf(host: BluePluginHostService): HostState {
  const state = HOST_STATES.get(host)
  if (state === undefined) throw new Error('Blue owner seam requires the active host service itself')
  return state
}
function ready(state: HostState, capability: Capability): boolean { return (state.owners.get(capability) ?? 0) > 0 }
function invalidateGestures(state: HostState, owner: EffectOwner): void {
  const tokens = state.ownerGestures.get(owner)
  if (tokens === undefined) return
  for (const token of tokens) state.gestures.delete(token)
  state.ownerGestures.delete(owner)
}
function consumeGesture(state: HostState, gesture: BlueUserGesture | undefined): boolean {
  if (!object(gesture)) return false
  const owner = state.gestures.get(gesture)
  if (owner === undefined) return false
  state.gestures.delete(gesture)
  const tokens = state.ownerGestures.get(owner)
  tokens?.delete(gesture)
  if (tokens?.size === 0) state.ownerGestures.delete(owner)
  return true
}

function revokeGesture(state: HostState, gesture: BlueUserGesture): void {
  const owner = state.gestures.get(gesture)
  if (owner === undefined) return
  state.gestures.delete(gesture)
  const tokens = state.ownerGestures.get(owner)
  tokens?.delete(gesture)
  if (tokens?.size === 0) state.ownerGestures.delete(owner)
}

/** Attach capabilities implemented by one Blue-owned adapter Fiber. */
export function attachBluePluginHostCapabilities(host: BluePluginHostService, owner: EffectOwner, capabilities: readonly HostCapability[]): BlueRegistration {
  const state = ownerStateOf(host)
  const owned = [...new Set(capabilities)]
  for (const capability of owned) if (capability === 'session.read' || capability === 'session.act') throw new Error(`Blue session capability "${capability}" requires attachBluePluginHostSessionOwner`)
  for (const capability of owned) if (!IMPLEMENTED_CAPABILITIES.has(capability as Capability)) throw new Error(`Blue owner adapter cannot attach unsupported capability "${capability}"`)
  for (const capability of owned as Capability[]) state.owners.set(capability, (state.owners.get(capability) ?? 0) + 1)
  const dispatchOwner = owned.some(capability => capability === 'commands' || capability === 'panes' || capability === 'overlays' || capability === 'editor.extensions' || capability === 'editor.provider')
  const overlayOwner = owned.includes('overlays')
  if (dispatchOwner) state.gestureOwners.set(owner, (state.gestureOwners.get(owner) ?? 0) + 1)
  if (overlayOwner) state.overlayOwners.set(owner, (state.overlayOwners.get(owner) ?? 0) + 1)
  const registration = new Registration(() => {
    for (const capability of owned as Capability[]) {
      const count = state.owners.get(capability)
      if (count === undefined) continue
      if (count <= 1) state.owners.delete(capability); else state.owners.set(capability, count - 1)
    }
    if (dispatchOwner) {
      const count = state.gestureOwners.get(owner)
      if (count !== undefined) {
        if (count <= 1) { state.gestureOwners.delete(owner); invalidateGestures(state, owner) } else state.gestureOwners.set(owner, count - 1)
      }
    }
    if (overlayOwner) {
      const count = state.overlayOwners.get(owner)
      if (count !== undefined) {
        if (count <= 1) state.overlayOwners.delete(owner); else state.overlayOwners.set(owner, count - 1)
      }
    }
  })
  try { owner.effect(() => () => registration.dispose()) } catch (error) { registration.dispose(); throw error }
  return registration
}

/** Attach app-owned session projection and action capabilities as one generation. */
export function attachBluePluginHostSessionOwner(host: BluePluginHostService, owner: EffectOwner, reader: BlueSessionReader, requester: BlueSessionRequester): BlueRegistration {
  const state = ownerStateOf(host)
  if (state.sessionOwner !== undefined) throw new Error('Blue plugin host already has an active session owner')
  if (!object(reader) || typeof reader.current !== 'function' || typeof reader.subscribe !== 'function') throw new Error('Blue session owner requires a reader')
  if (!object(requester) || typeof requester.request !== 'function') throw new Error('Blue session owner requires a requester')
  const initial = sessionSnapshot(reader.current())
  const sessionOwner: SessionOwner = {
    generation: state.nextSessionGeneration++, requester, controllers: new Set(), subscription: undefined,
    lastRevision: initial?.revision ?? -1, tail: Promise.resolve(),
  }
  state.sessionOwner = sessionOwner
  state.sessionSnapshot = initial
  state.owners.set('session.read', 1)
  state.owners.set('session.act', 1)
  const registration = new Registration(() => {
    if (state.sessionOwner !== sessionOwner) return
    state.sessionOwner = undefined
    state.owners.delete('session.read')
    state.owners.delete('session.act')
    sessionOwner.subscription?.dispose()
    sessionOwner.subscription = undefined
    for (const controller of sessionOwner.controllers) controller.abort()
    sessionOwner.controllers.clear()
    if (state.sessionSnapshot !== null) { state.sessionSnapshot = null; emitSession(state) }
  })
  try {
    owner.effect(() => () => registration.dispose())
    let replayPublished = false
    sessionOwner.subscription = reader.subscribe(snapshot => {
      const before = state.sessionSnapshot
      publishSession(state, sessionOwner, snapshot)
      if (state.sessionSnapshot !== before) replayPublished = true
    })
    if (!replayPublished) emitSession(state)
  } catch (error) { registration.dispose(); throw error }
  return registration
}

function attachBluePluginSurfaceBuffers(host: BluePluginHostService, owner: EffectOwner): BlueRegistration {
  const state = ownerStateOf(host)
  const capabilities = ['panes', 'overlays'] as const
  for (const capability of capabilities) state.owners.set(capability, (state.owners.get(capability) ?? 0) + 1)
  const registration = new Registration(() => {
    for (const capability of capabilities) {
      const count = state.owners.get(capability)
      /* v8 ignore start -- the buffer lease owns both entries until this cleanup runs. */
      if (count === undefined) continue
      /* v8 ignore stop */
      if (count <= 1) state.owners.delete(capability); else state.owners.set(capability, count - 1)
    }
  })
  try { owner.effect(() => () => registration.dispose()) }
  /* v8 ignore start -- Cordis accepts effects while a plugin apply hook is running. */
  catch (error) { registration.dispose(); throw error }
  /* v8 ignore stop */
  return registration
}

/** Mint an owner-scoped, one-shot gesture proof for a semantic user dispatch. */
export function createBlueUserGesture(host: BluePluginHostService, owner: EffectOwner): BlueResult<BlueUserGesture> {
  try {
    const state = ownerStateOf(host)
    if ((state.gestureOwners.get(owner) ?? 0) === 0) return failure('BLUE_ACTION_REJECTED', 'only an active user-dispatch owner may mint user gestures')
    const token = Object.freeze({}) as BlueUserGesture
    state.gestures.set(token, owner)
    let tokens = state.ownerGestures.get(owner)
    if (tokens === undefined) { tokens = new Set(); state.ownerGestures.set(owner, tokens) }
    tokens.add(token)
    return success(token)
  } catch (error) { return failure('BLUE_ACTION_REJECTED', message(error, 'user gesture could not be minted')) }
}

/**
 * Run one semantic user dispatch with a gesture proof that is revoked when
 * the complete async handler settles. Consumers may not retain the token
 * beyond this owner-controlled scope.
 */
export async function runBlueUserGesture<T>(host: BluePluginHostService, owner: EffectOwner, callback: (gesture: BlueUserGesture) => T | Promise<T>, signal?: AbortSignal): Promise<T> {
  const state = ownerStateOf(host)
  const minted = createBlueUserGesture(host, owner)
  if (!minted.ok) throw new Error(minted.message)
  const revoke = () => revokeGesture(state, minted.value)
  signal?.addEventListener('abort', revoke, { once: true })
  if (signal?.aborted === true) {
    revoke()
    signal.removeEventListener('abort', revoke)
    throw new Error('Blue user dispatch was aborted')
  }
  try {
    return await callback(minted.value)
  } finally {
    signal?.removeEventListener('abort', revoke)
    revoke()
  }
}

/** Close one current overlay entry from its active Blue-owned renderer Fiber. */
export function closeBluePluginHostOverlay(host: BluePluginHostService, owner: EffectOwner, entry: BluePluginHostOverlayEntry): BlueResult {
  try {
    const state = ownerStateOf(host)
    if ((state.overlayOwners.get(owner) ?? 0) === 0) return failure('BLUE_ACTION_REJECTED', 'only an active overlays owner may close overlay entries')
    const closer = state.overlayClosers.get(entry.id)
    if (closer === undefined || closer.entry !== entry) return failure('BLUE_ACTION_REJECTED', 'overlay entry is no longer active')
    closer.close()
    return success(undefined)
  } catch (error) { return failure('BLUE_ACTION_REJECTED', message(error, 'overlay entry could not be closed')) }
}

/** Snapshot all additive contributions for Blue-owned adapters. */
export function snapshotBluePluginHost(host: BluePluginHostService): BluePluginHostSnapshot {
  const state = ownerStateOf(host)
  return Object.freeze({ revision: state.revision.value, statusRevision: state.status.revision, statusProvidersRevision: state.statusProviders.revision, editorExtensionsRevision: state.extensions.revision, editorProvidersRevision: state.editorProviders.revision, commands: state.commands.list(), status: state.status.list(), panes: state.panes.list(), overlays: state.overlays.list(), editorExtensions: state.extensions.list(), statusProviders: state.statusProviders.list(), editorProviders: state.editorProviders.list() })
}

/** Observe aggregate changes from a Blue-owned adapter. */
export function subscribeBluePluginHost(host: BluePluginHostService, listener: (snapshot: BluePluginHostSnapshot) => void): BlueRegistration {
  const state = ownerStateOf(host)
  const notify = () => listener(snapshotBluePluginHost(host))
  const aggregates = [state.commands, state.status, state.panes, state.overlays, state.extensions, state.statusProviders, state.editorProviders]
  const handles = aggregates.map(aggregate => aggregate.subscribe(notify))
  try { notify() } catch (error) { for (const handle of handles) handle.dispose(); throw error }
  return new Registration(() => { for (const handle of handles) handle.dispose() })
}

/** Observe plugin notices from Blue's owner interaction adapter. */
export function subscribeBluePluginNotifications(host: BluePluginHostService, listener: (notification: BlueNotification) => void): BlueRegistration {
  const state = ownerStateOf(host); state.notificationObservers.add(listener)
  return new Registration(() => { state.notificationObservers.delete(listener) })
}

function disposeHost(host: BluePluginHostService): void {
  const state = HOST_STATES.get(host)
  /* v8 ignore next -- Cordis invokes an effect cleanup at most once. */
  if (state === undefined) return
  for (const lifetime of state.lifetimes) lifetime.dispose()
  for (const registry of state.registries) registry.dispose()
  state.sessionOwner?.subscription?.dispose()
  for (const controller of state.sessionOwner?.controllers ?? []) controller.abort()
  for (const notifications of state.notifications) notifications.dispose()
  for (const aggregate of [state.commands, state.status, state.panes, state.overlays, state.extensions, state.statusProviders, state.editorProviders]) aggregate.clear()
  state.lifetimes.clear(); state.notificationObservers.clear(); state.owners.clear(); state.gestureOwners.clear(); state.gestures.clear(); state.ownerGestures.clear(); state.overlayOwners.clear(); state.overlayClosers.clear(); state.paneCounts.clear(); state.capturingConsumers.clear(); state.sessionListeners.clear(); state.sessionOwner = undefined; state.sessionSnapshot = null; HOST_STATES.delete(host)
}

/** Cordis service implementing the stable Blue plugin host. */
export class BluePluginHostService extends Service implements BluePluginHost {
  readonly version = '1.0.0'
  constructor(ctx: Context, options: BluePluginHostOptions = {}) {
    super(ctx, 'bluePluginHost')
    const revision = { value: 0 }
    const changed = () => { revision.value += 1 }
    HOST_STATES.set(this, {
      lifetimes: new Set(), registries: new Set(), notifications: new Set(), notificationObservers: new Set(), commands: new Aggregate(false, changed), status: new Aggregate(true, changed), panes: new Aggregate(true, changed), overlays: new Ordered(changed), extensions: new Aggregate(true, changed), statusProviders: new Aggregate(true, changed), editorProviders: new Aggregate(true, changed), owners: new Map(), gestureOwners: new Map(), gestures: new Map(), ownerGestures: new Map(), overlayOwners: new Map(), overlayClosers: new Map(), paneCounts: new Map(), capturingConsumers: new Set(), revision, now: options.now ?? Date.now, sessionListeners: new Set(), sessionOwner: undefined, sessionSnapshot: null, nextSessionGeneration: 0, nextOverlayOrder: 0,
    })
    ctx.effect(() => () => disposeHost(this))
  }

  open(consumer: Consumer, manifest: BluePluginManifest): BlueResult<BluePluginApi> {
    try {
      const state = stateOf(this)
      if (!object(consumer) || typeof consumer.effect !== 'function') return failure('BLUE_INVALID_CONTRIBUTION', 'consumer must expose a Cordis effect function')
      if (!object(manifest)) return failure('BLUE_INVALID_CONTRIBUTION', 'manifest must be an object')
      const rawManifest = fields(manifest, ['id', 'api', 'capabilities', 'schemaVersion', 'entry', 'blue', 'harness', 'node', 'integrity'])
      const hostManifest = Object.freeze({
        id: rawManifest.id,
        api: rawManifest.api,
        capabilities: cloneData(rawManifest.capabilities),
        ...(rawManifest.schemaVersion === undefined ? {} : { schemaVersion: rawManifest.schemaVersion }),
        ...(rawManifest.entry === undefined ? {} : { entry: rawManifest.entry }),
        ...(rawManifest.blue === undefined ? {} : { blue: rawManifest.blue }),
        ...(rawManifest.harness === undefined ? {} : { harness: rawManifest.harness }),
        ...(rawManifest.node === undefined ? {} : { node: rawManifest.node }),
        ...(rawManifest.integrity === undefined ? {} : { integrity: rawManifest.integrity }),
      }) as BluePluginManifest
      const valid = validateBlueManifest(hostManifest)
      if (!valid.ok) return failure(valid.code === 'BLUE_INVALID_MANIFEST' ? 'BLUE_INVALID_CONTRIBUTION' : 'BLUE_API_INCOMPATIBLE', valid.message)
      if (!API_MAJOR.test(hostManifest.api)) return failure('BLUE_API_INCOMPATIBLE', `unsupported Blue API range "${hostManifest.api}"`)
      const capabilities = [...hostManifest.capabilities]
      const missing = capabilities.find(capability => !ready(state, capability as Capability))
      if (missing !== undefined) return absent(missing as Capability)

      const lifetime = new ConsumerLifetime()
      state.lifetimes.add(lifetime)
      const isReady = (capability: Capability) => () => ready(state, capability)
      const commands = new Scoped('commands', state.commands, isReady('commands'), lifetime, command)
      const statuses = new ScopedRefresh('status', state.status, isReady('status'), lifetime, state.now, status)
      const panes = new Panes(state, consumer, lifetime); const overlays = new Overlays(state, consumer, lifetime)
      const extensions = new ScopedRefresh('editor.extensions', state.extensions, isReady('editor.extensions'), lifetime, state.now, extension)
      const statusProviders = new ScopedRefresh('status.provider', state.statusProviders, isReady('status.provider'), lifetime, state.now, statusProvider)
      const editorProviders = new ScopedRefresh('editor.provider', state.editorProviders, isReady('editor.provider'), lifetime, state.now, editorProvider)
      const notifications = new Notifications(state, lifetime, callback => consumer.effect(callback))
      const session = new SessionReadFacade(state, lifetime, callback => consumer.effect(callback))
      const sessionActions = new SessionActionFacade(state, lifetime)
      const registries = [commands, statuses, panes, overlays, extensions, statusProviders, editorProviders, session, sessionActions]
      for (const registry of registries) state.registries.add(registry)
      state.notifications.add(notifications)

      const frozenManifest = Object.freeze({ id: hostManifest.id, api: hostManifest.api, capabilities: Object.freeze(capabilities), ...(hostManifest.schemaVersion === undefined ? {} : { schemaVersion: hostManifest.schemaVersion }), ...(hostManifest.entry === undefined ? {} : { entry: hostManifest.entry }), ...(hostManifest.blue === undefined ? {} : { blue: hostManifest.blue }), ...(hostManifest.harness === undefined ? {} : { harness: hostManifest.harness }), ...(hostManifest.node === undefined ? {} : { node: hostManifest.node }), ...(hostManifest.integrity === undefined ? {} : { integrity: hostManifest.integrity }) }) as BluePluginManifest
      const api: BluePluginApi = {
        manifest: frozenManifest,
        ...(capabilities.includes('commands') ? { commands } : {}), ...(capabilities.includes('status') ? { status: statuses } : {}), ...(capabilities.includes('notifications') ? { notifications } : {}), ...(capabilities.includes('panes') ? { panes } : {}), ...(capabilities.includes('overlays') ? { overlays } : {}), ...(capabilities.includes('editor.extensions') ? { editorExtensions: extensions } : {}), ...(capabilities.includes('session.read') ? { session } : {}), ...(capabilities.includes('session.act') ? { sessionActions } : {}), ...(capabilities.includes('status.provider') ? { statusProviders } : {}), ...(capabilities.includes('editor.provider') ? { editorProviders } : {}),
      }
      const cleanup = () => { lifetime.dispose(); state.lifetimes.delete(lifetime); for (const registry of registries) { registry.dispose(); state.registries.delete(registry) }; notifications.dispose(); state.notifications.delete(notifications) }
      try { consumer.effect(() => cleanup) } catch (error) { cleanup(); throw error }
      return success(Object.freeze(api))
    } catch (error) { return invalid(error) }
  }
}

export const name = 'blue-api-host'
export function apply(ctx: Context): void {
  const host = new BluePluginHostService(ctx)
  // Panes and overlays are durable host buffers: renderer owners may mount
  // later or reload, then replay the contributions admitted in that gap.
  attachBluePluginSurfaceBuffers(host, ctx)
}
