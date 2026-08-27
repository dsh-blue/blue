/** Cordis-owned, renderer-independent host for stable Blue plugin contributions. */
import { Service, symbols, type Context } from '@deepseek-ai/cordis'
import type {
  BlueCommandContribution, BlueDockContribution, BlueEditorExtensionContribution,
  BlueEditorProvider, BlueErrorCode, BlueNotification, BlueOverlayOpenOptions,
  BlueOverlayRequest, BlueOverlayRegistry, BluePaneContribution, BluePaneRegistration,
  BluePaneRegistry, BluePluginApi, BluePluginHost, BluePublicOverlayHandle,
  BlueRefreshRegistration, BlueRegistration, BlueRegistry, BlueResult,
  BlueStatusContribution, BlueStatusEntryContribution, BlueStatusProvider, BlueUserGesture,
} from './contracts.ts'
import { validateBlueHostManifest, type BlueCapability, type BlueHostManifest, type BluePluginManifest } from './manifest.ts'

declare module '@deepseek-ai/cordis' { interface Context { bluePluginHost: BluePluginHostService } }

type Capability = 'commands' | 'status' | 'dock' | 'notifications' | 'panes' | 'overlays' | 'editor.extensions' | 'status.provider' | 'editor.provider'
type HostCapability = BlueCapability | 'dock'
type EffectOwner = { effect(callback: () => () => void): unknown }
type Consumer = { effect(callback: () => void | (() => void)): unknown }
type Prioritized = { readonly id: string, readonly priority?: number }

export interface BluePluginHostPaneEntry extends Prioritized {
  readonly contribution: BluePaneContribution
  readonly hidden: boolean
}
export interface BluePluginHostOverlayEntry {
  readonly id: string
  readonly request: BlueOverlayRequest & { readonly capturing: boolean, readonly dismissible: boolean }
  readonly order: number
}
export interface BluePluginHostSnapshot {
  readonly commands: readonly BlueCommandContribution[]
  readonly status: readonly BlueStatusEntryContribution[] & readonly BlueStatusContribution[]
  readonly dock: readonly BlueDockContribution[]
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
const IMPLEMENTED_CAPABILITIES = new Set<Capability>(['commands', 'status', 'dock', 'notifications', 'panes', 'overlays', 'editor.extensions', 'status.provider', 'editor.provider'])

function success<T>(value: T): BlueResult<T> { return { ok: true, value } }
function failure(code: BlueErrorCode, message: string): BlueResult<never> { return { ok: false, code, message } }
function message(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback }
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
function absent(capability: Capability): BlueResult<never> { return failure('BLUE_CAPABILITY_ABSENT', `capability "${capability}" has no active Blue owner adapter`) }
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
function dock(input: unknown): BlueResult<BlueDockContribution> {
  const value = fields(input, ['id', 'priority', 'view', 'preferredRows', 'minRows', 'collapsible']); const m = meta(value); if (!m.ok) return m
  if (!object(value.view) && typeof value.view !== 'function') return failure('BLUE_INVALID_CONTRIBUTION', 'dock contributions need a view or view function')
  for (const [label, rows] of [['preferredRows', value.preferredRows], ['minRows', value.minRows]] as const) {
    if (rows !== undefined && (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 0 || rows > 20)) return failure('BLUE_LIMIT_EXCEEDED', `${label} must be an integer from 0 through 20`)
  }
  if (value.collapsible !== undefined && typeof value.collapsible !== 'boolean') return failure('BLUE_INVALID_CONTRIBUTION', 'dock collapsible must be a boolean')
  return success(Object.freeze({ ...m.value, view: typeof value.view === 'function' ? value.view : cloneData(value.view), ...(value.preferredRows === undefined ? {} : { preferredRows: value.preferredRows }), ...(value.minRows === undefined ? {} : { minRows: value.minRows }), ...(value.collapsible === undefined ? {} : { collapsible: value.collapsible }) }) as BlueDockContribution)
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
  const value = fields(input, ['id', 'priority', 'before', 'after', 'hint', 'diagnostics', 'actions', 'complete', 'transformSubmit']); const m = meta(value, true); if (!m.ok) return m
  for (const field of ['before', 'after'] as const) if (value[field] !== undefined && !object(value[field])) return failure('BLUE_INVALID_CONTRIBUTION', `editor extension ${field} must be a UI node`)
  if (value.hint !== undefined && typeof value.hint !== 'string') return failure('BLUE_INVALID_CONTRIBUTION', 'editor extension hint must be a string')
  for (const field of ['diagnostics', 'actions'] as const) if (value[field] !== undefined && !Array.isArray(value[field])) return failure('BLUE_INVALID_CONTRIBUTION', `editor extension ${field} must be an array`)
  for (const field of ['complete', 'transformSubmit'] as const) if (value[field] !== undefined && typeof value[field] !== 'function') return failure('BLUE_INVALID_CONTRIBUTION', `editor extension ${field} must be a function`)
  return success(Object.freeze({ ...m.value, ...(value.before === undefined ? {} : { before: cloneData(value.before) }), ...(value.after === undefined ? {} : { after: cloneData(value.after) }), ...(value.hint === undefined ? {} : { hint: value.hint }), ...(value.diagnostics === undefined ? {} : { diagnostics: cloneData(value.diagnostics) }), ...(value.actions === undefined ? {} : { actions: cloneData(value.actions) }), ...(value.complete === undefined ? {} : { complete: value.complete }), ...(value.transformSubmit === undefined ? {} : { transformSubmit: value.transformSubmit }) }) as BlueEditorExtensionContribution)
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

class Aggregate<T extends Prioritized> {
  private readonly entries = new Map<string, { value: T, sequence: number }>()
  private readonly listeners = new Set<() => void>()
  private nextSequence = 0
  constructor(private readonly sortById = true) {}
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
  touch(): void { for (const listener of this.listeners) try { listener() } catch { /* owner refresh errors are contained */ } }
  clear(): void { this.entries.clear(); this.touch(); this.listeners.clear() }
  private emit(): void { for (const listener of this.listeners) listener() }
}
class Ordered<T extends { readonly id: string }> {
  private readonly entries = new Map<string, T>()
  private readonly listeners = new Set<() => void>()
  get size(): number { return this.entries.size }
  add(value: T): BlueResult<BlueRegistration> {
    if (this.entries.has(value.id)) return failure('BLUE_DUPLICATE_ID', `contribution "${value.id}" is already registered`)
    this.entries.set(value.id, value)
    try { this.emit() } catch (error) { this.entries.delete(value.id); this.touch(); return failure('BLUE_DUPLICATE_ID', message(error, `contribution "${value.id}" was rejected`)) }
    return success(new Registration(() => { this.entries.delete(value.id); this.touch() }))
  }
  list(): readonly T[] { return Object.freeze([...this.entries.values()]) }
  subscribe(listener: () => void): BlueRegistration { this.listeners.add(listener); return new Registration(() => { this.listeners.delete(listener) }) }
  touch(): void { for (const listener of this.listeners) try { listener() } catch { /* owner refresh errors are contained */ } }
  clear(): void { this.entries.clear(); this.touch(); this.listeners.clear() }
  private emit(): void { for (const listener of this.listeners) listener() }
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
  constructor(private readonly capability: Capability, private readonly aggregate: Aggregate<T>, private readonly ready: () => boolean, private readonly normalize: (input: unknown) => BlueResult<T>) {}
  register(input: T): BlueResult<BlueRegistration> {
    if (!this.ready()) return absent(this.capability)
    try {
      const result = this.normalize(input); if (!result.ok) return result
      const value = result.value
      if (this.entries.has(value.id)) return failure('BLUE_DUPLICATE_ID', `contribution "${value.id}" is already registered`)
      const added = this.aggregate.add(value); if (!added.ok) return added
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
  constructor(private readonly capability: Capability, private readonly aggregate: Aggregate<T>, private readonly ready: () => boolean, private readonly now: () => number, private readonly normalize: (input: unknown) => BlueResult<T>) {}
  register(input: T): BlueResult<BlueRefreshRegistration> {
    if (!this.ready()) return absent(this.capability)
    try {
      const result = this.normalize(input); if (!result.ok) return result
      const value = result.value
      if (this.entries.has(value.id)) return failure('BLUE_DUPLICATE_ID', `contribution "${value.id}" is already registered`)
      const added = this.aggregate.add(value); if (!added.ok) return added
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
  readonly registries: Set<{ dispose(): void }>; readonly notifications: Set<Notifications>; readonly notificationObservers: Set<(notification: BlueNotification) => void>
  readonly commands: Aggregate<BlueCommandContribution>; readonly status: Aggregate<BlueStatusEntryContribution>; readonly dock: Aggregate<BlueDockContribution>
  readonly panes: Aggregate<BluePluginHostPaneEntry>; readonly overlays: Ordered<BluePluginHostOverlayEntry>; readonly extensions: Aggregate<BlueEditorExtensionContribution>
  readonly statusProviders: Aggregate<BlueStatusProvider>; readonly editorProviders: Aggregate<BlueEditorProvider>; readonly owners: Map<Capability, number>
  readonly gestureOwners: Map<EffectOwner, number>; readonly gestures: Map<object, EffectOwner>; readonly ownerGestures: Map<EffectOwner, Set<object>>; readonly now: () => number
  readonly paneCounts: Map<object, number>; readonly capturingConsumers: Set<object>
  nextOverlayOrder: number
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
  constructor(private readonly state: HostState, private readonly consumer: object) {}
  register(input: BluePaneContribution): BlueResult<BluePaneRegistration> {
    if (!ready(this.state, 'panes')) return absent('panes')
    if ((this.state.paneCounts.get(this.consumer) ?? 0) >= 8) return failure('BLUE_LIMIT_EXCEEDED', 'a consumer may register at most 8 panes')
    try {
      const result = pane(input); if (!result.ok) return result
      const value = result.value
      if (this.entries.has(value.id)) return failure('BLUE_DUPLICATE_ID', `contribution "${value.id}" is already registered`)
      let entry: BluePluginHostPaneEntry = Object.freeze({ id: value.id, ...(value.priority === undefined ? {} : { priority: value.priority }), contribution: value, hidden: false })
      const added = this.state.panes.add(entry); if (!added.ok) return added
      this.entries.set(value.id, value)
      this.state.paneCounts.set(this.consumer, (this.state.paneCounts.get(this.consumer) ?? 0) + 1)
      const isReady = () => ready(this.state, 'panes')
      let handle: PaneHandle
      handle = new PaneHandle(isReady, this.state.now, () => this.state.panes.touch(), () => {
        this.entries.delete(value.id); this.handles.delete(handle); added.value.dispose()
        const remaining = this.state.paneCounts.get(this.consumer)! - 1
        if (remaining === 0) this.state.paneCounts.delete(this.consumer); else this.state.paneCounts.set(this.consumer, remaining)
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
  constructor(private readonly state: HostState, private readonly consumer: object) {}
  open(input: BlueOverlayRequest, options?: BlueOverlayOpenOptions): BlueResult<BluePublicOverlayHandle> {
    if (!ready(this.state, 'overlays')) return absent('overlays')
    try {
      const result = overlay(input); if (!result.ok) return result
      const request = result.value
      if (request.capturing && !consumeGesture(this.state, options?.userGesture)) return failure('BLUE_ACTION_REJECTED', 'capturing overlays require a valid one-shot user gesture')
      if (this.state.overlays.size >= 4) return failure('BLUE_LIMIT_EXCEEDED', 'the global overlay stack is limited to 4 entries')
      if (request.capturing && this.state.capturingConsumers.has(this.consumer)) return failure('BLUE_LIMIT_EXCEEDED', 'a consumer may open only one capturing overlay')
      const entry = Object.freeze({ id: request.id, request, order: this.state.nextOverlayOrder++ })
      const added = this.state.overlays.add(entry); if (!added.ok) return added
      if (request.capturing) this.state.capturingConsumers.add(this.consumer)
      let handle: OverlayHandle
      handle = new OverlayHandle(() => ready(this.state, 'overlays'), this.state.now, () => this.state.overlays.touch(), () => { this.handles.delete(handle); if (request.capturing) this.state.capturingConsumers.delete(this.consumer); added.value.dispose() })
      this.handles.add(handle); return success(handle)
    } catch (error) { return invalid(error) }
  }
  dispose(): void { for (const handle of this.handles) handle.dispose() }
}
class Notifications {
  private readonly listeners = new Set<(notification: BlueNotification) => void>(); private readonly handles = new Set<Registration>()
  constructor(private readonly state: HostState, private readonly effect: Consumer['effect']) {}
  publish(input: BlueNotification): BlueResult {
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
    this.listeners.add(listener); let handle: Registration
    handle = new Registration(() => { this.listeners.delete(listener); this.handles.delete(handle) }); this.handles.add(handle); this.effect(() => () => handle.dispose()); return handle
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

/** Attach capabilities implemented by one Blue-owned adapter Fiber. */
export function attachBluePluginHostCapabilities(host: BluePluginHostService, owner: EffectOwner, capabilities: readonly HostCapability[]): BlueRegistration {
  const state = ownerStateOf(host)
  const owned = [...new Set(capabilities)]
  for (const capability of owned) if (!IMPLEMENTED_CAPABILITIES.has(capability as Capability)) throw new Error(`Blue owner adapter cannot attach unsupported capability "${capability}"`)
  for (const capability of owned as Capability[]) state.owners.set(capability, (state.owners.get(capability) ?? 0) + 1)
  if (owned.includes('overlays')) state.gestureOwners.set(owner, (state.gestureOwners.get(owner) ?? 0) + 1)
  const registration = new Registration(() => {
    for (const capability of owned as Capability[]) {
      const remaining = (state.owners.get(capability) ?? 1) - 1
      if (remaining === 0) state.owners.delete(capability); else state.owners.set(capability, remaining)
    }
    if (owned.includes('overlays')) {
      const remaining = state.gestureOwners.get(owner)! - 1
      if (remaining === 0) { state.gestureOwners.delete(owner); invalidateGestures(state, owner) } else state.gestureOwners.set(owner, remaining)
    }
  })
  try { owner.effect(() => () => registration.dispose()) } catch (error) { registration.dispose(); throw error }
  return registration
}

/** Mint an owner-scoped, one-shot gesture proof for a semantic user dispatch. */
export function createBlueUserGesture(host: BluePluginHostService, owner: EffectOwner): BlueResult<BlueUserGesture> {
  try {
    const state = ownerStateOf(host)
    if ((state.gestureOwners.get(owner) ?? 0) === 0) return failure('BLUE_ACTION_REJECTED', 'only an active overlay owner may mint user gestures')
    const token = Object.freeze({}) as BlueUserGesture
    state.gestures.set(token, owner)
    let tokens = state.ownerGestures.get(owner)
    if (tokens === undefined) { tokens = new Set(); state.ownerGestures.set(owner, tokens) }
    tokens.add(token)
    return success(token)
  } catch (error) { return failure('BLUE_ACTION_REJECTED', message(error, 'user gesture could not be minted')) }
}

/** Snapshot all additive contributions for Blue-owned adapters. */
export function snapshotBluePluginHost(host: BluePluginHostService): BluePluginHostSnapshot {
  const state = stateOf(host)
  // W2-C owner compatibility only: the aggregate remains the final narrowed
  // status type. W3-C removes this cast when transcript uses the status compiler.
  return Object.freeze({ commands: state.commands.list(), status: state.status.list() as readonly BlueStatusEntryContribution[] & readonly BlueStatusContribution[], dock: state.dock.list(), panes: state.panes.list(), overlays: state.overlays.list(), editorExtensions: state.extensions.list(), statusProviders: state.statusProviders.list(), editorProviders: state.editorProviders.list() })
}

/** Observe aggregate changes from a Blue-owned adapter. */
export function subscribeBluePluginHost(host: BluePluginHostService, listener: (snapshot: BluePluginHostSnapshot) => void): BlueRegistration {
  const state = stateOf(host)
  const notify = () => listener(snapshotBluePluginHost(host))
  notify()
  const aggregates = [state.commands, state.status, state.dock, state.panes, state.overlays, state.extensions, state.statusProviders, state.editorProviders]
  const handles = aggregates.map(aggregate => aggregate.subscribe(notify))
  return new Registration(() => { for (const handle of handles) handle.dispose() })
}

/** Observe plugin notices from Blue's owner interaction adapter. */
export function subscribeBluePluginNotifications(host: BluePluginHostService, listener: (notification: BlueNotification) => void): BlueRegistration {
  const state = stateOf(host); state.notificationObservers.add(listener)
  return new Registration(() => { state.notificationObservers.delete(listener) })
}

function disposeHost(host: BluePluginHostService): void {
  const state = HOST_STATES.get(host)
  /* v8 ignore next -- Cordis invokes an effect cleanup at most once. */
  if (state === undefined) return
  for (const registry of state.registries) registry.dispose()
  for (const notifications of state.notifications) notifications.dispose()
  for (const aggregate of [state.commands, state.status, state.dock, state.panes, state.overlays, state.extensions, state.statusProviders, state.editorProviders]) aggregate.clear()
  state.notificationObservers.clear(); state.owners.clear(); state.gestureOwners.clear(); state.gestures.clear(); state.ownerGestures.clear(); state.paneCounts.clear(); state.capturingConsumers.clear(); HOST_STATES.delete(host)
}

/** Cordis service implementing the stable Blue plugin host. */
export class BluePluginHostService extends Service implements BluePluginHost {
  readonly version = '1.0.0'
  constructor(ctx: Context, options: BluePluginHostOptions = {}) {
    super(ctx, 'bluePluginHost')
    HOST_STATES.set(this, {
      registries: new Set(), notifications: new Set(), notificationObservers: new Set(), commands: new Aggregate(false), status: new Aggregate(), dock: new Aggregate(false), panes: new Aggregate(), overlays: new Ordered(), extensions: new Aggregate(), statusProviders: new Aggregate(), editorProviders: new Aggregate(), owners: new Map(), gestureOwners: new Map(), gestures: new Map(), ownerGestures: new Map(), paneCounts: new Map(), capturingConsumers: new Set(), now: options.now ?? Date.now, nextOverlayOrder: 0,
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
      }) as BlueHostManifest
      const valid = validateBlueHostManifest(hostManifest)
      if (!valid.ok) return failure(valid.code === 'BLUE_INVALID_MANIFEST' ? 'BLUE_INVALID_CONTRIBUTION' : 'BLUE_API_INCOMPATIBLE', valid.message)
      if (!API_MAJOR.test(hostManifest.api)) return failure('BLUE_API_INCOMPATIBLE', `unsupported Blue API range "${hostManifest.api}"`)
      const capabilities = [...hostManifest.capabilities]
      const publicCapabilities = capabilities.filter((capability): capability is BlueCapability => capability !== 'dock')
      const unavailable = capabilities.find(capability => !IMPLEMENTED_CAPABILITIES.has(capability as Capability))
      if (unavailable !== undefined) return failure('BLUE_CAPABILITY_DENIED', `capability "${unavailable}" has no implemented Blue owner/API seam`)
      const missing = capabilities.find(capability => !ready(state, capability as Capability))
      if (missing !== undefined) return absent(missing as Capability)

      const isReady = (capability: Capability) => () => ready(state, capability)
      const commands = new Scoped('commands', state.commands, isReady('commands'), command)
      const statuses = new ScopedRefresh('status', state.status, isReady('status'), state.now, status)
      const docks = new Scoped('dock', state.dock, isReady('dock'), dock)
      const panes = new Panes(state, consumer); const overlays = new Overlays(state, consumer)
      const extensions = new ScopedRefresh('editor.extensions', state.extensions, isReady('editor.extensions'), state.now, extension)
      const statusProviders = new ScopedRefresh('status.provider', state.statusProviders, isReady('status.provider'), state.now, statusProvider)
      const editorProviders = new ScopedRefresh('editor.provider', state.editorProviders, isReady('editor.provider'), state.now, editorProvider)
      const notifications = new Notifications(state, callback => consumer.effect(callback))
      const registries = [commands, statuses, docks, panes, overlays, extensions, statusProviders, editorProviders]
      for (const registry of registries) state.registries.add(registry)
      state.notifications.add(notifications)

      const frozenManifest = Object.freeze({ id: hostManifest.id, api: hostManifest.api, capabilities: Object.freeze(publicCapabilities), ...(hostManifest.schemaVersion === undefined ? {} : { schemaVersion: hostManifest.schemaVersion }), ...(hostManifest.entry === undefined ? {} : { entry: hostManifest.entry }), ...(hostManifest.blue === undefined ? {} : { blue: hostManifest.blue }), ...(hostManifest.harness === undefined ? {} : { harness: hostManifest.harness }), ...(hostManifest.node === undefined ? {} : { node: hostManifest.node }), ...(hostManifest.integrity === undefined ? {} : { integrity: hostManifest.integrity }) }) as BluePluginManifest
      const api: BluePluginApi = {
        manifest: frozenManifest,
        ...(capabilities.includes('commands') ? { commands } : {}), ...(capabilities.includes('status') ? { status: statuses } : {}), ...(capabilities.includes('dock') ? { dock: docks } : {}), ...(capabilities.includes('notifications') ? { notifications } : {}), ...(capabilities.includes('panes') ? { panes } : {}), ...(capabilities.includes('overlays') ? { overlays } : {}), ...(capabilities.includes('editor.extensions') ? { editorExtensions: extensions } : {}), ...(capabilities.includes('status.provider') ? { statusProviders } : {}), ...(capabilities.includes('editor.provider') ? { editorProviders } : {}),
      }
      const cleanup = () => { for (const registry of registries) { registry.dispose(); state.registries.delete(registry) }; notifications.dispose(); state.notifications.delete(notifications) }
      try { consumer.effect(() => cleanup) } catch (error) { cleanup(); throw error }
      return success(Object.freeze(api))
    } catch (error) { return invalid(error) }
  }
}

export const name = 'blue-api-host'
export function apply(ctx: Context): void { new BluePluginHostService(ctx) }
