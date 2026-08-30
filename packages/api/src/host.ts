/** Cordis-owned, renderer-independent host for Beta Blue plugin contributions. */
import { Service, symbols, type Context } from '@deepseek-ai/cordis'
import { intersects } from 'semver'
import type {
  BlueCommandContribution, BlueEditorExtensionContribution,
  BlueEditorProvider, BlueErrorCode, BlueNotification, BlueOverlayOpenOptions,
  BlueOverlayRequest, BlueOverlayRegistry, BluePaneContribution, BluePaneRegistration,
  BluePaneRegistry, BluePluginApi, BluePluginHost, BluePluginOpen, BluePublicOverlayHandle,
  BlueRefreshRegistration, BlueRegistration, BlueRegistry, BlueResult,
  BlueSessionReader, BlueSessionSnapshot,
  BlueStatusEntryContribution, BlueStatusProvider, BlueUserGesture,
  BlueCapabilityGrant,
  BlueCapabilityUnavailable,
  BluePluginManifestInput,
} from './contracts.ts'
import { validateBlueManifest, type BlueCapability, type BluePluginManifest } from './manifest.ts'
import {
  getBlueCapabilityDefinition,
  negotiateBlueCapabilities,
} from './capabilities-v1.ts'
import {
  validateBluePluginManifestV1,
  type BluePluginManifestV1,
} from './protocol-v1.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    bluePluginHost: BluePluginHostService
    /** Composition-private authority; the bundle isolates it from siblings. */
    bluePluginControl: BluePluginControl
  }
}

type Capability = 'commands' | 'status' | 'notifications.publish' | 'panes' | 'overlays' | 'editor.extensions' | 'session.read' | 'status.provider' | 'editor.provider'
type V1Capability = 'commands' | 'status' | 'notifications.publish' | 'panes' | 'overlays' | 'session.read' | 'session.projections.read'
type ActiveCapability = Capability | 'session.projections.read'
type HostCapability = BlueCapability
type AttachedCapability = Exclude<ActiveCapability, 'session.read' | 'session.projections.read'>
type GestureCapability = 'commands' | 'panes' | 'overlays' | 'editor.extensions' | 'editor.provider'
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
  /** Owner generation that admitted this transient action. */
  readonly ownerGeneration?: number
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

/** Composition-private authority installed beside the public host service. */
interface BluePluginOwnerLease extends BlueRegistration {
  /** Whether this lease still owns the current generation of one capability. */
  current(capability: HostCapability): boolean
  /** Snapshot access is valid only while every capability on the lease is current. */
  snapshot(): BlueResult<BluePluginHostSnapshot>
  subscribe(listener: (snapshot: BluePluginHostSnapshot) => void): BlueRegistration
  observeNotifications(listener: (notification: BlueNotification) => void): BlueRegistration
  runUserGesture<T>(capability: GestureCapability, callback: (gesture: BlueUserGesture) => T | Promise<T>, signal?: AbortSignal): Promise<T>
  closeOverlay(entry: BluePluginHostOverlayEntry): BlueResult
}

/** Composition-private authority installed beside the public host service. */
export interface BluePluginControl {
  attachCapabilities(owner: EffectOwner, capabilities: readonly HostCapability[]): BluePluginOwnerLease
  attachSessionReader(owner: EffectOwner, reader: BlueSessionReader): BlueRegistration
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,127}$/u
const OWNER_ID_PATTERN = /^(?:blue[.:-]|@dsh-blue\/)/u
const IMPLEMENTED_CAPABILITIES = new Set<Capability>(['commands', 'status', 'notifications.publish', 'panes', 'overlays', 'editor.extensions', 'session.read', 'status.provider', 'editor.provider'])

/** Runtime enforcement reads the same immutable values returned in grants. */
const COMMAND_DEFINITION = getBlueCapabilityDefinition('commands')!
const STATUS_DEFINITION = getBlueCapabilityDefinition('status')!
const PANES_DEFINITION = getBlueCapabilityDefinition('panes')!
const OVERLAYS_DEFINITION = getBlueCapabilityDefinition('overlays')!
const NOTIFICATIONS_DEFINITION = getBlueCapabilityDefinition('notifications.publish')!
const MAX_COMMAND_CONTRIBUTIONS = COMMAND_DEFINITION.limits.maxNames!
const MAX_STATUS_CONTRIBUTIONS = STATUS_DEFINITION.limits.maxEntries!
const MAX_PANES_PER_CONSUMER = PANES_DEFINITION.quotas.maxPerConsumer!
const MAX_OVERLAY_STACK = OVERLAYS_DEFINITION.limits.maxStack!
const MAX_CAPTURING_OVERLAYS_PER_CONSUMER = OVERLAYS_DEFINITION.quotas.maxCapturingPerConsumer!
const STATUS_REFRESH_PER_SECOND = STATUS_DEFINITION.quotas.refreshPerSecond!
const PANE_REFRESH_PER_SECOND = PANES_DEFINITION.quotas.refreshPerSecond!
const OVERLAY_REFRESH_PER_SECOND = OVERLAYS_DEFINITION.quotas.refreshPerSecond!
const MAX_NOTIFICATION_VIEW_BYTES = NOTIFICATIONS_DEFINITION.limits.maxViewBytes!
const MAX_NOTIFICATION_VIEW_DEPTH = NOTIFICATIONS_DEFINITION.limits.maxDepth!
const MAX_NOTIFICATION_VIEW_NODES = NOTIFICATIONS_DEFINITION.limits.maxNodes!
const MAX_NOTIFICATION_VIEW_PROPERTIES = NOTIFICATIONS_DEFINITION.limits.maxProperties!
const MAX_NOTIFICATION_PRIMITIVE_BYTES = NOTIFICATIONS_DEFINITION.limits.maxPrimitiveBytes!
const MAX_NOTIFICATION_PER_SECOND = NOTIFICATIONS_DEFINITION.quotas.maxPerSecond!
/** Experimental facets have no v1 grant catalog yet. */
const EXPERIMENTAL_REFRESH_PER_SECOND = 20
const NOTIFICATION_CLONE_LIMIT = Symbol('notification-clone-limit')

function success<T>(value: T): BlueResult<T> { return { ok: true, value } }
function failure(code: BlueErrorCode, message: string): BlueResult<never> { return { ok: false, code, message } }
function message(error: unknown, fallback: string): string {
  try {
    if (typeof error !== 'object' || error === null) return fallback
    const descriptor = Object.getOwnPropertyDescriptor(error, 'message')
    return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : fallback
  } catch { return fallback }
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
function absent(capability: Capability): BlueResult<never> { return failure('BLUE_CAPABILITY_ABSENT', `capability "${capability}" has no active Blue owner adapter`) }
function consumerDisposed(): BlueResult<never> { return failure('BLUE_ACTION_REJECTED', 'plugin consumer is disposed') }
function rejectDisposedAdmission(added: BlueResult<BlueRegistration>): BlueResult<never> { if (added.ok) added.value.dispose(); return consumerDisposed() }
function invalid(error: unknown): BlueResult<never> { return failure('BLUE_INVALID_CONTRIBUTION', message(error, 'plugin input could not be inspected')) }

function openProjection(
  manifest: BluePluginManifestInput,
  facets: Omit<BluePluginApi, 'manifest'>,
  grants: readonly BlueCapabilityGrant[] = [],
  unavailableOptional: readonly BlueCapabilityUnavailable[] = [],
): BluePluginOpen {
  const api = Object.freeze({ manifest, ...facets }) as BluePluginApi
  return Object.freeze({ manifest, ...facets, api, grants: Object.freeze([...grants]), unavailableOptional: Object.freeze([...unavailableOptional]) })
}

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
interface DataCloneBudget {
  readonly maxDepth: number
  readonly maxNodes: number
  readonly maxProperties: number
  readonly maxPrimitiveBytes: number
  nodes: number
  properties: number
  primitiveBytes: number
}

function consumeStringBudget(input: string, budget: DataCloneBudget): void {
  const remainingPrimitiveBytes = budget.maxPrimitiveBytes - budget.primitiveBytes
  if (input.length > remainingPrimitiveBytes) throw NOTIFICATION_CLONE_LIMIT
  budget.primitiveBytes += Buffer.byteLength(input, 'utf8')
  if (budget.primitiveBytes > budget.maxPrimitiveBytes) throw NOTIFICATION_CLONE_LIMIT
}

function cloneData(input: unknown, seen = new Set<object>(), budget?: DataCloneBudget, depth = 0): unknown {
  if (input === null || typeof input === 'string' || typeof input === 'boolean') {
    if (budget !== undefined) {
      if (typeof input === 'string') consumeStringBudget(input, budget)
      else {
        budget.primitiveBytes += input === null || input ? 4 : 5
        if (budget.primitiveBytes > budget.maxPrimitiveBytes) throw NOTIFICATION_CLONE_LIMIT
      }
    }
    return input
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('nested contribution numbers must be finite')
    if (budget !== undefined) {
      budget.primitiveBytes += String(input).length
      if (budget.primitiveBytes > budget.maxPrimitiveBytes) throw NOTIFICATION_CLONE_LIMIT
    }
    return input
  }
  if (!object(input) || seen.has(input)) throw new Error('nested contribution data must be finite, acyclic JSON-shaped data')
  if (budget !== undefined) {
    if (depth > budget.maxDepth) throw NOTIFICATION_CLONE_LIMIT
    budget.nodes += 1
    if (budget.nodes > budget.maxNodes) throw NOTIFICATION_CLONE_LIMIT
  }
  seen.add(input)
  if (Array.isArray(input)) {
    const length = Object.getOwnPropertyDescriptor(input, 'length')
    /* v8 ignore next -- Array length is a non-configurable own data descriptor. */
    if (length === undefined || !('value' in length) || typeof length.value !== 'number') throw new Error('array length must be an own data property')
    if (budget !== undefined) {
      budget.properties += length.value
      if (budget.properties > budget.maxProperties) throw NOTIFICATION_CLONE_LIMIT
    }
    const copy: unknown[] = []
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index))
      if (descriptor === undefined || !('value' in descriptor)) throw new Error('array entries must be own data properties')
      copy.push(cloneData(descriptor.value, seen, budget, depth + 1))
    }
    seen.delete(input)
    return Object.freeze(copy)
  }
  const copy: Record<string, unknown> = {}
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string') continue
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    if (descriptor === undefined) continue
    if (!descriptor.enumerable) continue
    if (!('value' in descriptor)) throw new Error(`${key} must be an own data property`)
    if (budget !== undefined) {
      budget.properties += 1
      if (budget.properties > budget.maxProperties) throw NOTIFICATION_CLONE_LIMIT
      consumeStringBudget(key, budget)
    }
    Object.defineProperty(copy, key, { value: cloneData(descriptor.value, seen, budget, depth + 1), enumerable: true })
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

function command(input: unknown, lifetime: ConsumerLifetime): BlueResult<BlueCommandContribution> {
  const value = fields(input, ['id', 'priority', 'label', 'execute']); const m = meta(value, true); if (!m.ok) return m
  if (!/^[a-z][a-z0-9_-]*$/u.test(m.value.id) || typeof value.label !== 'string' || value.label.trim().length === 0 || typeof value.execute !== 'function') return failure('BLUE_INVALID_CONTRIBUTION', 'command contributions need a lowercase command id, label, and execute function')
  const execute = value.execute as BlueCommandContribution['execute']
  const fencedExecute: BlueCommandContribution['execute'] = async (args, options) => {
    const aborted = () => options?.signal?.aborted === true
    if (lifetime.disposed) return failure('BLUE_STALE', 'plugin command owner is no longer active')
    if (aborted()) return failure('BLUE_ABORTED', 'plugin command was aborted')
    try {
      const result = await execute(args, options)
      if (aborted()) return failure('BLUE_ABORTED', 'plugin command was aborted')
      if (lifetime.disposed) return failure('BLUE_STALE', 'plugin command owner is no longer active')
      return result
    } catch (error) {
      if (aborted()) return failure('BLUE_ABORTED', 'plugin command was aborted')
      if (lifetime.disposed) return failure('BLUE_STALE', 'plugin command owner is no longer active')
      throw error
    }
  }
  return success(Object.freeze({ ...m.value, label: value.label, execute: fencedExecute }) as BlueCommandContribution)
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
  touch(): void { this.revisionValue += 1; this.changed(); for (const listener of [...this.listeners]) try { listener() } catch { /* owner refresh errors are contained */ } }
  clear(): void { this.entries.clear(); this.touch(); this.listeners.clear() }
  private emit(): void { this.revisionValue += 1; this.changed(); for (const listener of [...this.listeners]) listener() }
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
  touch(): void { this.changed(); for (const listener of [...this.listeners]) try { listener() } catch { /* owner refresh errors are contained */ } }
  clear(): void { this.entries.clear(); this.touch(); this.listeners.clear() }
  private emit(): void { this.changed(); for (const listener of [...this.listeners]) listener() }
}

class RefreshGate {
  private readonly times: number[] = []
  private cancel: (() => void) | undefined
  constructor(private readonly capability: Capability, private readonly limit: number, private readonly ready: () => boolean, private readonly disposed: () => boolean, private readonly now: () => number, private readonly notify: () => void) {}
  refresh(): BlueResult {
    if (this.disposed()) return failure('BLUE_ACTION_REJECTED', 'contribution is disposed')
    if (!this.ready()) return absent(this.capability)
    try {
      const current = this.now()
      while (this.times.length > 0 && this.times[0]! <= current - 1_000) this.times.shift()
      if (this.times.length >= this.limit) return failure('BLUE_LIMIT_EXCEEDED', `refresh limit is ${String(this.limit)} per contribution per second`)
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
  constructor(capability: Capability, refreshPerSecond: number, ready: () => boolean, now: () => number, notify: () => void, private readonly cleanup: () => void) { this.gate = new RefreshGate(capability, refreshPerSecond, ready, () => this.done, now, notify) }
  refresh(): BlueResult { return this.gate.refresh() }
  dispose(): void { if (!this.done) { this.done = true; this.gate.dispose(); this.cleanup() } }
}

interface EntryQuota {
  readonly limit: number
  reserve(): boolean
  release(): void
}

const UNLIMITED_ENTRY_QUOTA: EntryQuota = Object.freeze({
  limit: Number.POSITIVE_INFINITY,
  reserve: () => true,
  release: () => {},
})

class ConsumerEntryQuota implements EntryQuota {
  constructor(private readonly counts: Map<object, number>, private readonly consumer: object, readonly limit: number) {}
  reserve(): boolean {
    const count = this.counts.get(this.consumer) ?? 0
    if (count >= this.limit) return false
    this.counts.set(this.consumer, count + 1)
    return true
  }
  release(): void {
    const count = this.counts.get(this.consumer)!
    if (count === 1) this.counts.delete(this.consumer)
    else this.counts.set(this.consumer, count - 1)
  }
}

class Scoped<T extends Prioritized> implements BlueRegistry<T> {
  private readonly entries = new Map<string, T>()
  private readonly handles = new Set<Registration>()
  constructor(private readonly capability: Capability, private readonly aggregate: Aggregate<T>, private readonly ready: () => boolean, private readonly lifetime: ConsumerLifetime, private readonly normalize: (input: unknown) => BlueResult<T>, private readonly allowedIds?: ReadonlySet<string>, private readonly quota: EntryQuota = UNLIMITED_ENTRY_QUOTA) {}
  register(input: T): BlueResult<BlueRegistration> {
    if (this.lifetime.disposed) return consumerDisposed()
    if (!this.ready()) return absent(this.capability)
    try {
      const result = this.normalize(input); if (!result.ok) return result
      const value = result.value
      if (this.allowedIds !== undefined && !this.allowedIds.has(value.id)) return failure('BLUE_RESOURCE_DENIED', `contribution "${value.id}" is outside the granted ${this.capability} resources`)
      if (this.entries.has(value.id)) return failure('BLUE_DUPLICATE_ID', `contribution "${value.id}" is already registered`)
      if (!this.quota.reserve()) return failure('BLUE_LIMIT_EXCEEDED', `${this.capability} contributions are limited to ${String(this.quota.limit)} per consumer`)
      const added = this.aggregate.add(value)
      if (this.lifetime.disposed) { this.quota.release(); return rejectDisposedAdmission(added) }
      if (!added.ok) { this.quota.release(); return added }
      this.entries.set(value.id, value)
      let handle: Registration
      handle = new Registration(() => { this.entries.delete(value.id); this.handles.delete(handle); this.quota.release(); added.value.dispose() })
      this.handles.add(handle); return success(handle)
    } catch (error) { return invalid(error) }
  }
  list(): readonly T[] { return Object.freeze([...this.entries.values()]) }
  dispose(): void { for (const handle of this.handles) handle.dispose() }
}
class ScopedRefresh<T extends Prioritized> {
  private readonly entries = new Map<string, T>()
  private readonly handles = new Set<RefreshRegistration>()
  constructor(private readonly capability: Capability, private readonly aggregate: Aggregate<T>, private readonly ready: () => boolean, private readonly lifetime: ConsumerLifetime, private readonly now: () => number, private readonly normalize: (input: unknown) => BlueResult<T>, private readonly refreshPerSecond: number, private readonly quota: EntryQuota = UNLIMITED_ENTRY_QUOTA) {}
  register(input: T): BlueResult<BlueRefreshRegistration> {
    if (this.lifetime.disposed) return consumerDisposed()
    if (!this.ready()) return absent(this.capability)
    try {
      const result = this.normalize(input); if (!result.ok) return result
      const value = result.value
      if (this.entries.has(value.id)) return failure('BLUE_DUPLICATE_ID', `contribution "${value.id}" is already registered`)
      if (!this.quota.reserve()) return failure('BLUE_LIMIT_EXCEEDED', `${this.capability} contributions are limited to ${String(this.quota.limit)} per consumer`)
      const added = this.aggregate.add(value)
      if (this.lifetime.disposed) { this.quota.release(); return rejectDisposedAdmission(added) }
      if (!added.ok) { this.quota.release(); return added }
      this.entries.set(value.id, value)
      let handle: RefreshRegistration
      handle = new RefreshRegistration(this.capability, this.refreshPerSecond, this.ready, this.now, () => this.aggregate.touch(), () => { this.entries.delete(value.id); this.handles.delete(handle); this.quota.release(); added.value.dispose() })
      this.handles.add(handle); return success(handle)
    } catch (error) { return invalid(error) }
  }
  list(): readonly T[] { return Object.freeze([...this.entries.values()]) }
  dispose(): void { for (const handle of this.handles) handle.dispose() }
}

interface HostState {
  readonly lifetimes: Set<ConsumerLifetime>; readonly registries: Set<{ dispose(): void }>; readonly notificationObservers: Set<(notification: BlueNotification) => void>
  readonly commands: Aggregate<BlueCommandContribution>; readonly status: Aggregate<BlueStatusEntryContribution>
  readonly panes: Aggregate<BluePluginHostPaneEntry>; readonly overlays: Ordered<BluePluginHostOverlayEntry>; readonly extensions: Aggregate<BlueEditorExtensionContribution>
  readonly statusProviders: Aggregate<BlueStatusProvider>; readonly editorProviders: Aggregate<BlueEditorProvider>; readonly owners: Map<Capability, number>
  /** Canonical capability definitions installed by the composition. */
  readonly supportedCapabilities: Set<V1Capability>
  /** Active owner fibers, kept separate from durable registration leases. */
  readonly activeOwners: Map<ActiveCapability, Map<EffectOwner, number>>
  /** Monotonic owner generation; every attach/detach advances the fence. */
  readonly ownerGenerations: Map<ActiveCapability, number>
  /** Exactly one attached owner lease is current for each UI capability. */
  readonly currentOwners: Map<AttachedCapability, OwnerGenerationLease>
  readonly ownerLeases: Map<EffectOwner, Set<OwnerGenerationLease>>
  ownerHandoff: boolean
  /** Consumers admitted through canonical or legacy open(). */
  readonly consumerIds: Map<string, ConsumerLifetime>
  readonly commandCounts: Map<object, number>; readonly statusCounts: Map<object, number>
  readonly notificationQuotas: Map<object, NotificationQuota>
  readonly gestures: Map<object, GestureRecord>; readonly ownerGestures: Map<OwnerGenerationLease, Set<object>>; readonly now: () => number
  readonly overlayClosers: Map<string, { entry: BluePluginHostOverlayEntry, close: () => void }>
  readonly paneCounts: Map<object, number>; readonly capturingConsumers: Map<object, number>
  readonly revision: { value: number }
  readonly sessionListeners: Set<(snapshot: BlueSessionSnapshot | null) => void>
  sessionOwner: SessionOwner | undefined
  sessionSnapshot: BlueSessionSnapshot | null
  nextOverlayOrder: number
}

interface NotificationQuota {
  refs: number
  readonly times: number[]
}

interface GestureRecord {
  readonly lease: OwnerGenerationLease
  readonly capability: GestureCapability
  readonly generation: number
}

interface SessionOwner {
  subscription: BlueRegistration | undefined
  lastRevision: number
}

function emitSession(state: HostState): void {
  for (const listener of [...state.sessionListeners]) try { listener(state.sessionSnapshot) } catch { /* plugin observer failures are contained */ }
}

function publishSession(state: HostState, owner: SessionOwner, input: unknown): void {
  if (state.sessionOwner !== owner) return
  let snapshot: BlueSessionSnapshot | null
  try { snapshot = sessionSnapshot(input) } catch { return }
  if (snapshot !== null && snapshot.revision <= owner.lastRevision) return
  if (snapshot !== null) owner.lastRevision = snapshot.revision
  if (snapshot === null && state.sessionSnapshot === null) return
  state.sessionSnapshot = snapshot
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

class PaneHandle extends RefreshRegistration implements BluePaneRegistration {
  constructor(ready: () => boolean, now: () => number, notify: () => void, cleanup: () => void, private readonly set: (hidden: boolean) => void, private readonly paneReady: () => boolean) { super('panes', PANE_REFRESH_PER_SECOND, ready, now, notify, cleanup) }
  setHidden(hidden: boolean): BlueResult {
    if (this.disposed) return failure('BLUE_ACTION_REJECTED', 'pane is disposed')
    if (!this.paneReady()) return absent('panes')
    if (typeof hidden !== 'boolean') return failure('BLUE_INVALID_CONTRIBUTION', 'pane hidden state must be a boolean')
    this.set(hidden); return success(undefined)
  }
}
class Panes implements BluePaneRegistry {
  private readonly entries = new Map<string, BluePaneContribution>(); private readonly handles = new Set<PaneHandle>()
  private readonly quota: ConsumerEntryQuota
  constructor(private readonly state: HostState, consumer: object, private readonly lifetime: ConsumerLifetime, private readonly allowedPlacements?: ReadonlySet<string>) {
    this.quota = new ConsumerEntryQuota(state.paneCounts, consumer, MAX_PANES_PER_CONSUMER)
  }
  register(input: BluePaneContribution): BlueResult<BluePaneRegistration> {
    if (this.lifetime.disposed) return consumerDisposed()
    if (!ready(this.state, 'panes')) return absent('panes')
    try {
      const result = pane(input); if (!result.ok) return result
      const value = result.value
      if (this.allowedPlacements !== undefined && !this.allowedPlacements.has(value.placement)) return failure('BLUE_RESOURCE_DENIED', `pane placement "${value.placement}" is outside the granted panes resources`)
      if (this.entries.has(value.id)) return failure('BLUE_DUPLICATE_ID', `contribution "${value.id}" is already registered`)
      if (!this.quota.reserve()) return failure('BLUE_LIMIT_EXCEEDED', `a consumer may register at most ${String(MAX_PANES_PER_CONSUMER)} panes`)
      let revision = 0
      let entry: BluePluginHostPaneEntry = Object.freeze({ id: value.id, ...(value.priority === undefined ? {} : { priority: value.priority }), contribution: value, hidden: false, revision })
      const added = this.state.panes.add(entry)
      if (this.lifetime.disposed) { this.quota.release(); return rejectDisposedAdmission(added) }
      if (!added.ok) { this.quota.release(); return added }
      this.entries.set(value.id, value)
      const isReady = () => ready(this.state, 'panes')
      let handle: PaneHandle
      handle = new PaneHandle(isReady, this.state.now, () => {
        entry = Object.freeze({ ...entry, revision: ++revision })
        this.state.panes.replace(value.id, entry)
      }, () => {
        this.entries.delete(value.id); this.handles.delete(handle); added.value.dispose()
        this.quota.release()
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
  constructor(isReady: () => boolean, now: () => number, notify: () => void, private readonly cleanup: () => void) { this.gate = new RefreshGate('overlays', OVERLAY_REFRESH_PER_SECOND, isReady, () => this.done, now, notify) }
  refresh(): BlueResult { return this.gate.refresh() } close(): void { this.dispose() }
  dispose(): void { if (!this.done) { this.done = true; this.gate.dispose(); this.cleanup() } }
}
class Overlays implements BlueOverlayRegistry {
  private readonly handles = new Set<OverlayHandle>()
  private readonly capturingQuota: ConsumerEntryQuota
  constructor(private readonly state: HostState, consumer: object, private readonly lifetime: ConsumerLifetime) {
    this.capturingQuota = new ConsumerEntryQuota(state.capturingConsumers, consumer, MAX_CAPTURING_OVERLAYS_PER_CONSUMER)
  }
  open(input: BlueOverlayRequest, options?: BlueOverlayOpenOptions): BlueResult<BluePublicOverlayHandle> {
    if (this.lifetime.disposed) return consumerDisposed()
    const ownerGeneration = currentOwnerGeneration(this.state, 'overlays')
    if (ownerGeneration === undefined) return absent('overlays')
    try {
      const result = overlay(input); if (!result.ok) return result
      const request = result.value
      if (request.capturing && !consumeGesture(this.state, options?.userGesture)) return failure('BLUE_ACTION_REJECTED', 'capturing overlays require a valid one-shot user gesture')
      if (this.state.overlays.size >= MAX_OVERLAY_STACK) return failure('BLUE_LIMIT_EXCEEDED', `the global overlay stack is limited to ${String(MAX_OVERLAY_STACK)} entries`)
      if (request.capturing && !this.capturingQuota.reserve()) return failure('BLUE_LIMIT_EXCEEDED', `a consumer may open at most ${String(MAX_CAPTURING_OVERLAYS_PER_CONSUMER)} capturing overlay`)
      let handle: OverlayHandle | undefined
      let closeRequested = false
      const close = () => {
        if (handle === undefined) closeRequested = true
        else handle.close()
      }
      let revision = 0
      let entry: BluePluginHostOverlayEntry = Object.freeze({ id: request.id, request, order: this.state.nextOverlayOrder++, ownerGeneration, revision })
      const closer = { entry, close }
      if (!this.state.overlayClosers.has(request.id)) this.state.overlayClosers.set(request.id, closer)
      const added = this.state.overlays.add(entry)
      if (this.lifetime.disposed) {
        if (request.capturing) this.capturingQuota.release()
        this.state.overlayClosers.delete(request.id)
        return rejectDisposedAdmission(added)
      }
      if (!added.ok) {
        if (request.capturing) this.capturingQuota.release()
        if (this.state.overlayClosers.get(request.id) === closer) this.state.overlayClosers.delete(request.id)
        return added
      }
      handle = new OverlayHandle(() => currentOwnerGeneration(this.state, 'overlays') === ownerGeneration, this.state.now, () => {
        entry = Object.freeze({ ...entry, revision: ++revision })
        closer.entry = entry
        this.state.overlays.replace(request.id, entry)
      }, () => {
        this.handles.delete(handle!)
        this.state.overlayClosers.delete(request.id)
        if (request.capturing) this.capturingQuota.release()
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
  private readonly quota: NotificationQuota
  private done = false
  constructor(
    private readonly state: HostState,
    private readonly lifetime: ConsumerLifetime,
    private readonly consumer: object,
    /** Notification publication has no durable buffer; require its live sink. */
    private readonly available: () => boolean,
  ) {
    let quota = state.notificationQuotas.get(consumer)
    if (quota === undefined) {
      quota = { refs: 0, times: [] }
      state.notificationQuotas.set(consumer, quota)
    }
    quota.refs += 1
    this.quota = quota
  }
  publish(input: BlueNotification): BlueResult {
    if (this.lifetime.disposed) return consumerDisposed()
    if (!this.available()) return absent('notifications.publish')
    try {
      const safe = fields(input, ['id', 'view', 'tone'])
      if (typeof safe.id !== 'string' || !ID_PATTERN.test(safe.id)) return failure('BLUE_INVALID_CONTRIBUTION', 'notification id must be 1-128 lowercase namespace characters')
      if (!object(safe.view)) return failure('BLUE_INVALID_CONTRIBUTION', 'notification view must be an object')
      if (safe.tone !== undefined && !['default', 'muted', 'accent', 'success', 'warning', 'danger'].includes(safe.tone as string)) return failure('BLUE_INVALID_CONTRIBUTION', 'notification tone is invalid')
      let clonedView: unknown
      try {
        clonedView = cloneData(safe.view, new Set(), {
          maxDepth: MAX_NOTIFICATION_VIEW_DEPTH,
          maxNodes: MAX_NOTIFICATION_VIEW_NODES,
          maxProperties: MAX_NOTIFICATION_VIEW_PROPERTIES,
          maxPrimitiveBytes: MAX_NOTIFICATION_PRIMITIVE_BYTES,
          nodes: 0,
          properties: 0,
          primitiveBytes: 0,
        })
      } catch (error) {
        if (error === NOTIFICATION_CLONE_LIMIT) {
          return failure('BLUE_LIMIT_EXCEEDED', `notification view exceeds structural limits (depth ${String(MAX_NOTIFICATION_VIEW_DEPTH)}, nodes ${String(MAX_NOTIFICATION_VIEW_NODES)}, properties ${String(MAX_NOTIFICATION_VIEW_PROPERTIES)}, primitive bytes ${String(MAX_NOTIFICATION_PRIMITIVE_BYTES)})`)
        }
        throw error
      }
      const value = Object.freeze({ id: safe.id, view: clonedView, ...(safe.tone === undefined ? {} : { tone: safe.tone }) }) as BlueNotification
      const serialized = JSON.stringify(value.view)
      if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_NOTIFICATION_VIEW_BYTES) return failure('BLUE_LIMIT_EXCEEDED', `notification view exceeds ${String(MAX_NOTIFICATION_VIEW_BYTES)} bytes`)
      // A notification is best-effort UI output. If the host clock is
      // unavailable, preserve publication rather than turning a transient
      // notice into a plugin failure; quota accounting resumes on the next
      // successful clock read.
      let current: number | undefined
      try { current = this.state.now() } catch { current = undefined }
      if (current !== undefined) {
        while (this.quota.times.length > 0 && this.quota.times[0]! <= current - 1_000) this.quota.times.shift()
        if (this.quota.times.length >= MAX_NOTIFICATION_PER_SECOND) return failure('BLUE_LIMIT_EXCEEDED', `notification publish limit is ${String(MAX_NOTIFICATION_PER_SECOND)} per second`)
        this.quota.times.push(current)
      }
      for (const observer of [...this.state.notificationObservers]) {
        try { observer(value) } catch { /* owner notification failures are contained per observer */ }
      }
      return success(undefined)
    } catch (error) { return failure('BLUE_INVALID_CONTRIBUTION', message(error, 'notification was rejected')) }
  }
  dispose(): void {
    if (this.done) return
    this.done = true
    this.quota.refs -= 1
    if (this.quota.refs === 0) {
      this.quota.times.length = 0
      this.state.notificationQuotas.delete(this.consumer)
    }
  }
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
function activeReady(state: HostState, capability: V1Capability): boolean {
  if (capability !== 'session.read' && capability !== 'session.projections.read') {
    const lease = state.currentOwners.get(capability)
    return lease?.current(capability) === true
  }
  return (state.activeOwners.get(capability)?.size ?? 0) > 0
}
function declareSupported(state: HostState, capabilities: readonly V1Capability[]): void {
  for (const capability of capabilities) state.supportedCapabilities.add(capability)
}
function bumpOwnerGeneration(state: HostState, capability: ActiveCapability): number {
  const generation = (state.ownerGenerations.get(capability) ?? 0) + 1
  state.ownerGenerations.set(capability, generation)
  return generation
}

function currentOwnerGeneration(state: HostState, capability: AttachedCapability): number | undefined {
  const lease = state.currentOwners.get(capability)
  return lease?.accepting(capability) === true ? lease.generation(capability) : undefined
}

function decrementOwner(state: HostState, capability: AttachedCapability): void {
  const count = state.owners.get(capability)
  /* v8 ignore next -- every active lease increments the matching count. */
  if (count === undefined) return
  if (count <= 1) state.owners.delete(capability)
  else state.owners.set(capability, count - 1)
}

function closeOverlayGeneration(state: HostState, generation: number): void {
  const closers = [...state.overlayClosers.values()].filter(closer => closer.entry.ownerGeneration === generation)
  for (const closer of closers.reverse()) closer.close()
}

function invalidateLeaseGestures(state: HostState, lease: OwnerGenerationLease, capability?: GestureCapability): void {
  const tokens = state.ownerGestures.get(lease)
  if (tokens === undefined) return
  for (const token of tokens) {
    const record = state.gestures.get(token)
    if (record === undefined || (capability !== undefined && record.capability !== capability)) continue
    state.gestures.delete(token)
    tokens.delete(token)
  }
  if (tokens.size === 0) state.ownerGestures.delete(lease)
}

class OwnerGenerationLease implements BluePluginOwnerLease {
  private done = false
  private disposing = false
  private readonly active = new Set<AttachedCapability>()
  private readonly retiring = new Set<AttachedCapability>()
  private readonly generations = new Map<AttachedCapability, number>()
  private readonly handles = new Set<BlueRegistration>()

  constructor(private readonly state: HostState, readonly owner: EffectOwner, private readonly capabilities: readonly AttachedCapability[]) {}

  get disposed(): boolean { return this.done }

  activate(capability: AttachedCapability, generation: number): void {
    this.active.add(capability)
    this.generations.set(capability, generation)
  }

  generation(capability: AttachedCapability): number | undefined { return this.generations.get(capability) }

  accepting(capability: AttachedCapability): boolean {
    return !this.retiring.has(capability) && this.current(capability)
  }

  current(capability: HostCapability): boolean {
    if (this.done || !this.active.has(capability as AttachedCapability)) return false
    const generation = this.generations.get(capability as AttachedCapability)
    return generation !== undefined
      && this.state.ownerGenerations.get(capability as AttachedCapability) === generation
      && this.state.currentOwners.get(capability as AttachedCapability) === this
  }

  private currentAll(): boolean { return this.capabilities.every(capability => this.current(capability)) }

  private inert(): BlueRegistration {
    const handle = new Registration(() => {})
    handle.dispose()
    return handle
  }

  private track(handle: BlueRegistration): BlueRegistration {
    if (!this.currentAll()) { handle.dispose(); return this.inert() }
    let tracked: Registration
    tracked = new Registration(() => { this.handles.delete(tracked); handle.dispose() })
    this.handles.add(tracked)
    return tracked
  }

  snapshot(): BlueResult<BluePluginHostSnapshot> {
    return this.currentAll()
      ? success(snapshotBluePluginHostState(this.state))
      : failure('BLUE_STALE', 'Blue owner lease is no longer current')
  }

  subscribe(listener: (snapshot: BluePluginHostSnapshot) => void): BlueRegistration {
    if (!this.currentAll()) return this.inert()
    const handle = subscribeBluePluginHostState(this.state, snapshot => { if (this.currentAll()) listener(snapshot) })
    return this.track(handle)
  }

  observeNotifications(listener: (notification: BlueNotification) => void): BlueRegistration {
    if (!this.current('notifications.publish')) return this.inert()
    const handle = subscribeBluePluginNotificationsState(this.state, notification => {
      if (this.current('notifications.publish')) listener(notification)
    })
    let tracked: Registration
    tracked = new Registration(() => { this.handles.delete(tracked); handle.dispose() })
    this.handles.add(tracked)
    return tracked
  }

  runUserGesture<T>(capability: GestureCapability, callback: (gesture: BlueUserGesture) => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    return runBlueUserGestureLease(this.state, this, capability, callback, signal)
  }

  closeOverlay(entry: BluePluginHostOverlayEntry): BlueResult {
    if (!this.current('overlays') || entry.ownerGeneration !== this.generation('overlays')) return failure('BLUE_STALE', 'overlays owner lease is no longer current')
    return closeBluePluginHostOverlayState(this.state, entry)
  }

  revoke(capability: AttachedCapability): void {
    if (!this.active.has(capability)) return
    this.active.delete(capability)
    this.state.currentOwners.delete(capability)
    bumpOwnerGeneration(this.state, capability)
    if (isGestureCapability(capability)) invalidateLeaseGestures(this.state, this, capability)
    decrementOwner(this.state, capability)
  }

  dispose(): void {
    if (this.done || this.disposing) return
    this.disposing = true
    try {
      const overlayGeneration = this.generations.get('overlays')
      if (this.active.has('overlays') && stateCurrent(this.state, 'overlays', this, overlayGeneration) && overlayGeneration !== undefined) {
        // The aggregate subscriber requires every capability on this atomic
        // lease to remain current for the final transient-removal snapshot,
        // while the retirement fence prevents that callback from admitting a
        // new transient into the generation already being drained.
        this.retiring.add('overlays')
        closeOverlayGeneration(this.state, overlayGeneration)
      }
      for (const capability of this.capabilities) this.revoke(capability)
    } finally {
      this.done = true
      invalidateLeaseGestures(this.state, this)
      for (const handle of this.handles) handle.dispose()
      this.handles.clear()
      const leases = this.state.ownerLeases.get(this.owner)
      leases?.delete(this)
      if (leases?.size === 0) this.state.ownerLeases.delete(this.owner)
      this.retiring.clear()
      this.disposing = false
    }
  }
}

function stateCurrent(state: HostState, capability: AttachedCapability, lease: OwnerGenerationLease, generation: number | undefined): boolean {
  return generation !== undefined
    && state.currentOwners.get(capability) === lease
    && state.ownerGenerations.get(capability) === generation
}

function isGestureCapability(capability: AttachedCapability): capability is GestureCapability {
  return capability === 'commands' || capability === 'panes' || capability === 'overlays' || capability === 'editor.extensions' || capability === 'editor.provider'
}

function canonicalCapability(value: string): value is V1Capability {
  return ['commands', 'status', 'notifications.publish', 'panes', 'overlays', 'session.read', 'session.projections.read'].includes(value)
}

function grantFor(grants: readonly BlueCapabilityGrant[], name: V1Capability): BlueCapabilityGrant | undefined {
  return grants.find(grant => grant.name === name)
}

/** Open a canonical v1 manifest after negotiation has produced exact grants. */
function openCanonical(state: HostState, consumer: Consumer, manifest: BluePluginManifestV1): BlueResult<BluePluginOpen> {
  if (state.consumerIds.has(manifest.id)) return failure('BLUE_DUPLICATE_ID', `plugin identity "${manifest.id}" is already open`)
  const admission = negotiateBlueCapabilities(manifest, {
    apiVersion: '1.0.0-beta.1',
    // `supported` describes the definitions installed by this composition;
    // `ownerReady` is the live renderer/app Fiber. Keeping them separate lets
    // a canonical consumer open during a legitimate owner gap and receive an
    // unavailable grant instead of an incorrect unsupported denial.
    supported: capability => state.supportedCapabilities.has(capability),
    ownerReady: capability => activeReady(state, capability),
    /* v8 ignore next -- a supported capability always initializes its fence. */
    generation: capability => state.ownerGenerations.get(capability) ?? 0,
  })
  if (!admission.ok) return failure(admission.code, admission.message)
  const capabilities = admission.grants.map(grant => grant.name).filter(canonicalCapability) as V1Capability[]
  const lifetime = new ConsumerLifetime()
  state.lifetimes.add(lifetime)
  state.consumerIds.set(manifest.id, lifetime)
  const isReady = (capability: Capability) => () => ready(state, capability)
  const commandResources = grantFor(admission.grants, 'commands')?.resources
  const allowedCommands = commandResources !== undefined && 'names' in commandResources ? new Set(commandResources.names) : undefined
  const paneResources = grantFor(admission.grants, 'panes')?.resources
  const allowedPlacements = paneResources !== undefined && 'placements' in paneResources ? new Set(paneResources.placements) : undefined
  const commands = new Scoped('commands', state.commands, isReady('commands'), lifetime, input => command(input, lifetime), allowedCommands, new ConsumerEntryQuota(state.commandCounts, consumer, MAX_COMMAND_CONTRIBUTIONS))
  const statuses = new ScopedRefresh('status', state.status, isReady('status'), lifetime, state.now, status, STATUS_REFRESH_PER_SECOND, new ConsumerEntryQuota(state.statusCounts, consumer, MAX_STATUS_CONTRIBUTIONS))
  const panes = new Panes(state, consumer, lifetime, allowedPlacements)
  const overlays = new Overlays(state, consumer, lifetime)
  const notificationPublisher = new Notifications(state, lifetime, consumer, () => activeReady(state, 'notifications.publish'))
  const notifications = Object.freeze({ publish: (notification: BlueNotification) => notificationPublisher.publish(notification) })
  const session = new SessionReadFacade(state, lifetime, callback => consumer.effect(callback))
  const registries = [commands, statuses, panes, overlays, session, notificationPublisher]
  for (const registry of registries) state.registries.add(registry)
  const facets: Omit<BluePluginApi, 'manifest'> = {
    ...(capabilities.includes('commands') ? { commands } : {}),
    ...(capabilities.includes('status') ? { status: statuses } : {}),
    ...(capabilities.includes('notifications.publish') ? { notifications } : {}),
    ...(capabilities.includes('panes') ? { panes } : {}),
    ...(capabilities.includes('overlays') ? { overlays } : {}),
    ...(capabilities.includes('session.read') ? { session } : {}),
  }
  const cleanup = () => {
    lifetime.dispose()
    state.lifetimes.delete(lifetime)
    /* v8 ignore next -- identity is reserved for this live lifetime. */
    if (state.consumerIds.get(manifest.id) === lifetime) state.consumerIds.delete(manifest.id)
    for (const registry of registries) { registry.dispose(); state.registries.delete(registry) }
  }
  try { consumer.effect(() => cleanup) } catch (error) { cleanup(); throw error }
  return success(openProjection(manifest, facets, admission.grants, admission.unavailableOptional))
}
function consumeGesture(state: HostState, gesture: BlueUserGesture | undefined): boolean {
  if (!object(gesture)) return false
  const record = state.gestures.get(gesture)
  if (record === undefined) return false
  state.gestures.delete(gesture)
  const tokens = state.ownerGestures.get(record.lease)
  tokens?.delete(gesture)
  if (tokens?.size === 0) state.ownerGestures.delete(record.lease)
  return record.lease.current(record.capability) && record.lease.generation(record.capability) === record.generation
}

function revokeGesture(state: HostState, gesture: BlueUserGesture): void {
  const record = state.gestures.get(gesture)
  if (record === undefined) return
  state.gestures.delete(gesture)
  const tokens = state.ownerGestures.get(record.lease)
  tokens?.delete(gesture)
  if (tokens?.size === 0) state.ownerGestures.delete(record.lease)
}

/** Attach capabilities implemented by one Blue-owned adapter Fiber. */
export function attachBluePluginHostCapabilities(host: BluePluginHostService, owner: EffectOwner, capabilities: readonly HostCapability[]): BluePluginOwnerLease {
  const state = ownerStateOf(host)
  if (state.ownerHandoff) throw new Error('Blue owner capability attachment cannot be reentrant')
  const unique = [...new Set(capabilities)]
  if (unique.length === 0) throw new Error('Blue owner capability attachment requires at least one capability')
  for (const capability of unique) if (capability === 'session.read') throw new Error(`Blue session capability "${capability}" requires attachBluePluginHostSessionReader`)
  for (const capability of unique) if (!IMPLEMENTED_CAPABILITIES.has(capability as Capability)) throw new Error(`Blue owner adapter cannot attach unsupported capability "${capability}"`)
  const owned = unique as AttachedCapability[]
  const lease = new OwnerGenerationLease(state, owner, owned)
  state.ownerHandoff = true
  try {
    try { owner.effect(() => () => lease.dispose()) } catch (error) { lease.dispose(); throw error }
    // A Cordis Fiber that is already retiring may run the cleanup synchronously.
    // Such an inert lease must not displace the still-healthy owner generation.
    if (lease.disposed) return lease
    let leases = state.ownerLeases.get(owner)
    if (leases === undefined) { leases = new Set(); state.ownerLeases.set(owner, leases) }
    leases.add(lease)
    // A lease is one atomic ownership unit. Any overlap retires every
    // capability on the displaced lease so current() and aggregate
    // snapshot/subscription authority cannot diverge.
    const displaced = new Set<OwnerGenerationLease>()
    for (const capability of owned) {
      const current = state.currentOwners.get(capability)
      if (current !== undefined) displaced.add(current)
    }
    for (const current of displaced) current.dispose()
    if (lease.disposed) return lease
    for (const capability of owned) {
      if (canonicalCapability(capability)) declareSupported(state, [capability])
      const generation = bumpOwnerGeneration(state, capability)
      lease.activate(capability, generation)
      state.currentOwners.set(capability, lease)
      state.owners.set(capability, (state.owners.get(capability) ?? 0) + 1)
    }
  } finally {
    state.ownerHandoff = false
  }
  return lease
}

/** Attach the app-owned readonly session projection for one owner lifetime. */
export function attachBluePluginHostSessionReader(host: BluePluginHostService, owner: EffectOwner, reader: BlueSessionReader): BlueRegistration {
  const state = ownerStateOf(host)
  if (state.sessionOwner !== undefined) throw new Error('Blue plugin host already has an active session owner')
  if (!object(reader) || typeof reader.current !== 'function' || typeof reader.subscribe !== 'function') throw new Error('Blue session owner requires a reader')
  const initial = sessionSnapshot(reader.current())
  declareSupported(state, ['session.read'])
  const sessionOwner: SessionOwner = {
    subscription: undefined,
    lastRevision: initial?.revision ?? -1,
  }
  state.sessionOwner = sessionOwner
  state.sessionSnapshot = initial
  state.owners.set('session.read', 1)
  let activeOwners = state.activeOwners.get('session.read')
  if (activeOwners === undefined) { activeOwners = new Map(); state.activeOwners.set('session.read', activeOwners) }
  activeOwners.set(owner, (activeOwners.get(owner) ?? 0) + 1)
  bumpOwnerGeneration(state, 'session.read')
  const registration = new Registration(() => {
    if (state.sessionOwner !== sessionOwner) return
    state.sessionOwner = undefined
    state.owners.delete('session.read')
    const owners = state.activeOwners.get('session.read')
    owners?.delete(owner)
    if (owners?.size === 0) state.activeOwners.delete('session.read')
    bumpOwnerGeneration(state, 'session.read')
    sessionOwner.subscription?.dispose()
    sessionOwner.subscription = undefined
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

function attachBluePluginRegistrationBuffers(host: BluePluginHostService, owner: EffectOwner): BlueRegistration {
  const state = ownerStateOf(host)
  const capabilities = ['commands', 'status', 'panes', 'overlays', 'editor.extensions', 'status.provider', 'editor.provider'] as const
  // These four registries are durable host buffers and therefore installed
  // before their renderer owners boot. Transient notifications and session
  // reads become supported only after their own owner has attached once.
  declareSupported(state, ['commands', 'status', 'panes', 'overlays'])
  for (const capability of capabilities) {
    state.owners.set(capability, (state.owners.get(capability) ?? 0) + 1)
    if ((['commands', 'status', 'panes', 'overlays'] as readonly string[]).includes(capability) && !state.ownerGenerations.has(capability as V1Capability)) state.ownerGenerations.set(capability as V1Capability, 0)
  }
  const registration = new Registration(() => {
    for (const capability of capabilities) {
      const count = state.owners.get(capability)
      /* v8 ignore start -- the buffer lease owns all entries until this cleanup runs. */
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

const GESTURE_CAPABILITY_ORDER: readonly GestureCapability[] = ['overlays', 'commands', 'panes', 'editor.extensions', 'editor.provider']

function currentLeaseForOwner(state: HostState, owner: EffectOwner, capability?: GestureCapability): { lease: OwnerGenerationLease, capability: GestureCapability } | undefined {
  const leases = state.ownerLeases.get(owner)
  if (leases === undefined) return undefined
  const capabilities = capability === undefined ? GESTURE_CAPABILITY_ORDER : [capability]
  for (const candidate of capabilities) {
    for (const lease of leases) if (lease.current(candidate)) return { lease, capability: candidate }
  }
  return undefined
}

function createBlueUserGestureLease(state: HostState, lease: OwnerGenerationLease, capability: GestureCapability): BlueResult<BlueUserGesture> {
  if (!lease.current(capability)) return failure('BLUE_ACTION_REJECTED', 'only the current user-dispatch owner generation may mint user gestures')
  const generation = lease.generation(capability)
  /* v8 ignore next -- current() requires the captured generation. */
  if (generation === undefined) return failure('BLUE_ACTION_REJECTED', 'user-dispatch owner generation is unavailable')
  const token = Object.freeze({}) as BlueUserGesture
  state.gestures.set(token, { lease, capability, generation })
  let tokens = state.ownerGestures.get(lease)
  if (tokens === undefined) { tokens = new Set(); state.ownerGestures.set(lease, tokens) }
  tokens.add(token)
  return success(token)
}

/** Mint an owner-scoped, one-shot gesture proof for a semantic user dispatch. */
export function createBlueUserGesture(host: BluePluginHostService, owner: EffectOwner, capability?: GestureCapability): BlueResult<BlueUserGesture> {
  try {
    const state = ownerStateOf(host)
    const current = currentLeaseForOwner(state, owner, capability)
    if (current === undefined) return failure('BLUE_ACTION_REJECTED', 'only an active user-dispatch owner may mint user gestures')
    return createBlueUserGestureLease(state, current.lease, current.capability)
  } catch (error) { return failure('BLUE_ACTION_REJECTED', message(error, 'user gesture could not be minted')) }
}

/**
 * Run one semantic user dispatch with a gesture proof that is revoked when
 * the complete async handler settles. Consumers may not retain the token
 * beyond this owner-controlled scope.
 */
async function runBlueUserGestureLease<T>(state: HostState, lease: OwnerGenerationLease, capability: GestureCapability, callback: (gesture: BlueUserGesture) => T | Promise<T>, signal?: AbortSignal): Promise<T> {
  const minted = createBlueUserGestureLease(state, lease, capability)
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

export async function runBlueUserGesture<T>(host: BluePluginHostService, owner: EffectOwner, callback: (gesture: BlueUserGesture) => T | Promise<T>, signal?: AbortSignal, capability?: GestureCapability): Promise<T> {
  const state = ownerStateOf(host)
  const current = currentLeaseForOwner(state, owner, capability)
  if (current === undefined) throw new Error('only an active user-dispatch owner may mint user gestures')
  return runBlueUserGestureLease(state, current.lease, current.capability, callback, signal)
}

function closeBluePluginHostOverlayState(state: HostState, entry: BluePluginHostOverlayEntry): BlueResult {
  const closer = state.overlayClosers.get(entry.id)
  if (closer === undefined || closer.entry !== entry) return failure('BLUE_ACTION_REJECTED', 'overlay entry is no longer active')
  closer.close()
  return success(undefined)
}

/** Close one current overlay entry from its active Blue-owned renderer Fiber. */
export function closeBluePluginHostOverlay(host: BluePluginHostService, owner: EffectOwner, entry: BluePluginHostOverlayEntry): BlueResult {
  try {
    const state = ownerStateOf(host)
    const leases = state.ownerLeases.get(owner)
    const lease = leases === undefined ? undefined : [...leases].find(candidate => candidate.current('overlays'))
    if (lease === undefined) return failure('BLUE_ACTION_REJECTED', 'only the current overlays owner generation may close overlay entries')
    return lease.closeOverlay(entry)
  } catch (error) { return failure('BLUE_ACTION_REJECTED', message(error, 'overlay entry could not be closed')) }
}

function snapshotBluePluginHostState(state: HostState): BluePluginHostSnapshot {
  return Object.freeze({ revision: state.revision.value, statusRevision: state.status.revision, statusProvidersRevision: state.statusProviders.revision, editorExtensionsRevision: state.extensions.revision, editorProvidersRevision: state.editorProviders.revision, commands: state.commands.list(), status: state.status.list(), panes: state.panes.list(), overlays: state.overlays.list(), editorExtensions: state.extensions.list(), statusProviders: state.statusProviders.list(), editorProviders: state.editorProviders.list() })
}

/** Snapshot all additive contributions for host-internal contract tests. */
export function snapshotBluePluginHost(host: BluePluginHostService): BluePluginHostSnapshot { return snapshotBluePluginHostState(ownerStateOf(host)) }

function subscribeBluePluginHostState(state: HostState, listener: (snapshot: BluePluginHostSnapshot) => void): BlueRegistration {
  const notify = () => listener(snapshotBluePluginHostState(state))
  const aggregates = [state.commands, state.status, state.panes, state.overlays, state.extensions, state.statusProviders, state.editorProviders]
  const handles = aggregates.map(aggregate => aggregate.subscribe(notify))
  try { notify() } catch (error) { for (const handle of handles) handle.dispose(); throw error }
  return new Registration(() => { for (const handle of handles) handle.dispose() })
}

/** Observe aggregate changes in host-internal contract tests. */
export function subscribeBluePluginHost(host: BluePluginHostService, listener: (snapshot: BluePluginHostSnapshot) => void): BlueRegistration { return subscribeBluePluginHostState(ownerStateOf(host), listener) }

function subscribeBluePluginNotificationsState(state: HostState, listener: (notification: BlueNotification) => void): BlueRegistration {
  state.notificationObservers.add(listener)
  return new Registration(() => { state.notificationObservers.delete(listener) })
}

/** Observe plugin notices in host-internal contract tests. */
export function subscribeBluePluginNotifications(host: BluePluginHostService, listener: (notification: BlueNotification) => void): BlueRegistration { return subscribeBluePluginNotificationsState(ownerStateOf(host), listener) }

function disposeHost(host: BluePluginHostService): void {
  const state = HOST_STATES.get(host)
  /* v8 ignore next -- Cordis invokes an effect cleanup at most once. */
  if (state === undefined) return
  for (const leases of state.ownerLeases.values()) for (const lease of leases) lease.dispose()
  for (const lifetime of state.lifetimes) lifetime.dispose()
  for (const registry of state.registries) registry.dispose()
  state.sessionOwner?.subscription?.dispose()
  for (const aggregate of [state.commands, state.status, state.panes, state.overlays, state.extensions, state.statusProviders, state.editorProviders]) aggregate.clear()
  state.lifetimes.clear(); state.notificationObservers.clear(); state.owners.clear(); state.activeOwners.clear(); state.supportedCapabilities.clear(); state.ownerGenerations.clear(); state.currentOwners.clear(); state.ownerLeases.clear(); state.ownerHandoff = false; state.consumerIds.clear(); state.commandCounts.clear(); state.statusCounts.clear(); state.notificationQuotas.clear(); state.gestures.clear(); state.ownerGestures.clear(); state.overlayClosers.clear(); state.paneCounts.clear(); state.capturingConsumers.clear(); state.sessionListeners.clear(); state.sessionOwner = undefined; state.sessionSnapshot = null; HOST_STATES.delete(host)
}

/** Create closure-bound owner authority for one host instance. */
export function createBluePluginControl(host: BluePluginHostService): BluePluginControl {
  const control: BluePluginControl = {
    attachCapabilities: (owner: EffectOwner, capabilities: readonly HostCapability[]) => attachBluePluginHostCapabilities(host, owner, capabilities),
    attachSessionReader: (owner: EffectOwner, reader: BlueSessionReader) => attachBluePluginHostSessionReader(host, owner, reader),
  }
  return Object.freeze(control)
}

/** Cordis service implementing the Beta Blue plugin host. */
export class BluePluginHostService extends Service implements BluePluginHost {
  readonly version = '1.0.0-beta.1'
  constructor(ctx: Context, options: BluePluginHostOptions = {}) {
    super(ctx, 'bluePluginHost')
    const revision = { value: 0 }
    const changed = () => { revision.value += 1 }
    HOST_STATES.set(this, {
      lifetimes: new Set(), registries: new Set(), notificationObservers: new Set(), commands: new Aggregate(false, changed), status: new Aggregate(true, changed), panes: new Aggregate(true, changed), overlays: new Ordered(changed), extensions: new Aggregate(true, changed), statusProviders: new Aggregate(true, changed), editorProviders: new Aggregate(true, changed), owners: new Map(), supportedCapabilities: new Set(), activeOwners: new Map(), ownerGenerations: new Map(), currentOwners: new Map(), ownerLeases: new Map(), ownerHandoff: false, consumerIds: new Map(), commandCounts: new Map(), statusCounts: new Map(), notificationQuotas: new Map(), gestures: new Map(), ownerGestures: new Map(), overlayClosers: new Map(), paneCounts: new Map(), capturingConsumers: new Map(), revision, now: options.now ?? Date.now, sessionListeners: new Set(), sessionOwner: undefined, sessionSnapshot: null, nextOverlayOrder: 0,
    })
    ctx.provide('bluePluginControl', createBluePluginControl(this))
    ctx.effect(() => () => disposeHost(this))
  }

  open(consumer: Consumer, manifest: BluePluginManifest): BlueResult<BluePluginApi>
  open(consumer: Consumer, manifest: BluePluginManifestV1): BlueResult<BluePluginOpen>
  open(consumer: Consumer, manifest: BluePluginManifestInput): BlueResult<BluePluginApi | BluePluginOpen> {
    try {
      const state = stateOf(this)
      if (!object(consumer) || typeof consumer.effect !== 'function') return failure('BLUE_INVALID_CONTRIBUTION', 'consumer must expose a Cordis effect function')
      if (!object(manifest)) return failure('BLUE_INVALID_CONTRIBUTION', 'manifest must be an object')
      // A manifest carrying the canonical schema marker is never interpreted
      // as the legacy flat capability list, even when v1 admission fails.
      if (own(manifest, '$schema') !== undefined) {
        const parsed = validateBluePluginManifestV1(manifest)
        if (!parsed.ok) return failure('BLUE_API_INCOMPATIBLE', parsed.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '))
        return openCanonical(state, consumer, parsed.value)
      }
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
      try {
        if (!intersects(hostManifest.api, this.version, { includePrerelease: true })) return failure('BLUE_API_INCOMPATIBLE', `unsupported Blue API range "${hostManifest.api}"`)
      } catch {
        return failure('BLUE_API_INCOMPATIBLE', `unsupported Blue API range "${hostManifest.api}"`)
      }
      if (state.consumerIds.has(hostManifest.id)) return failure('BLUE_DUPLICATE_ID', `plugin identity "${hostManifest.id}" is already open`)
      const capabilities = [...hostManifest.capabilities]
      const missing = capabilities.find(capability => !ready(state, capability as Capability))
      if (missing !== undefined) return absent(missing as Capability)

      const lifetime = new ConsumerLifetime()
      state.lifetimes.add(lifetime)
      state.consumerIds.set(hostManifest.id, lifetime)
      const isReady = (capability: Capability) => () => ready(state, capability)
      const commands = new Scoped('commands', state.commands, isReady('commands'), lifetime, input => command(input, lifetime), undefined, new ConsumerEntryQuota(state.commandCounts, consumer, MAX_COMMAND_CONTRIBUTIONS))
      const statuses = new ScopedRefresh('status', state.status, isReady('status'), lifetime, state.now, status, STATUS_REFRESH_PER_SECOND, new ConsumerEntryQuota(state.statusCounts, consumer, MAX_STATUS_CONTRIBUTIONS))
      const panes = new Panes(state, consumer, lifetime); const overlays = new Overlays(state, consumer, lifetime)
      const extensions = new ScopedRefresh('editor.extensions', state.extensions, isReady('editor.extensions'), lifetime, state.now, extension, EXPERIMENTAL_REFRESH_PER_SECOND)
      const statusProviders = new ScopedRefresh('status.provider', state.statusProviders, isReady('status.provider'), lifetime, state.now, statusProvider, EXPERIMENTAL_REFRESH_PER_SECOND)
      const editorProviders = new ScopedRefresh('editor.provider', state.editorProviders, isReady('editor.provider'), lifetime, state.now, editorProvider, EXPERIMENTAL_REFRESH_PER_SECOND)
      const notificationPublisher = new Notifications(state, lifetime, consumer, () => activeReady(state, 'notifications.publish'))
      const notifications = Object.freeze({ publish: (notification: BlueNotification) => notificationPublisher.publish(notification) })
      const session = new SessionReadFacade(state, lifetime, callback => consumer.effect(callback))
      const registries = [commands, statuses, panes, overlays, extensions, statusProviders, editorProviders, session, notificationPublisher]
      for (const registry of registries) state.registries.add(registry)

      const frozenManifest = Object.freeze({ id: hostManifest.id, api: hostManifest.api, capabilities: Object.freeze(capabilities), ...(hostManifest.schemaVersion === undefined ? {} : { schemaVersion: hostManifest.schemaVersion }), ...(hostManifest.entry === undefined ? {} : { entry: hostManifest.entry }), ...(hostManifest.blue === undefined ? {} : { blue: hostManifest.blue }), ...(hostManifest.harness === undefined ? {} : { harness: hostManifest.harness }), ...(hostManifest.node === undefined ? {} : { node: hostManifest.node }), ...(hostManifest.integrity === undefined ? {} : { integrity: hostManifest.integrity }) }) as BluePluginManifest
      const facets: Omit<BluePluginApi, 'manifest'> = {
        ...(capabilities.includes('commands') ? { commands } : {}), ...(capabilities.includes('status') ? { status: statuses } : {}), ...(capabilities.includes('notifications.publish') ? { notifications } : {}), ...(capabilities.includes('panes') ? { panes } : {}), ...(capabilities.includes('overlays') ? { overlays } : {}), ...(capabilities.includes('editor.extensions') ? { editorExtensions: extensions } : {}), ...(capabilities.includes('session.read') ? { session } : {}), ...(capabilities.includes('status.provider') ? { statusProviders } : {}), ...(capabilities.includes('editor.provider') ? { editorProviders } : {}),
      }
      const cleanup = () => {
        lifetime.dispose(); state.lifetimes.delete(lifetime)
        /* v8 ignore next -- identity is reserved for this live lifetime. */
        if (state.consumerIds.get(hostManifest.id) === lifetime) state.consumerIds.delete(hostManifest.id)
        for (const registry of registries) { registry.dispose(); state.registries.delete(registry) }
      }
      try { consumer.effect(() => cleanup) } catch (error) { cleanup(); throw error }
      // Legacy inline manifests retain their original surface shape. The
      // additional v1 negotiation fields are only present on canonical opens.
      return success(Object.freeze({ manifest: frozenManifest, ...facets }) as BluePluginOpen)
    } catch (error) { return invalid(error) }
  }
}

export const name = 'blue-api-host'
export function apply(ctx: Context): void {
  const host = new BluePluginHostService(ctx)
  // Registration capabilities are durable host buffers: consumer owners may
  // mount later or reload, then replay contributions admitted in that gap.
  attachBluePluginRegistrationBuffers(host, ctx)
}
