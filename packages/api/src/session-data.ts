/**
 * Validation, detachment, and resource scoping for canonical session data.
 * This module is renderer-neutral and never retains an owner-provided value.
 *
 * @module @dsh-blue/blue-api/session-data
 */

import type {
  BlueErrorCode,
  BlueJson,
  BluePluginSessionSnapshot,
  BlueSessionProjectionCut,
  BlueSessionReadField,
  BlueSessionSnapshot,
} from './contracts.ts'

/** Maximum encoded size of one granted projection value. */
export const BLUE_PROJECTION_VALUE_MAX_BYTES = 262_144

/** Maximum encoded size of one multi-key projection cut. */
export const BLUE_PROJECTION_CUT_MAX_BYTES = 1_048_576

/** Maximum UTF-8 size of one string in an app-owned session snapshot. */
export const BLUE_SESSION_STRING_MAX_BYTES = 16_384

/** Maximum encoded size of one app-owned session snapshot. */
export const BLUE_SESSION_SNAPSHOT_MAX_BYTES = 65_536

/** Maximum nesting depth admitted for one projection value. */
export const BLUE_PROJECTION_MAX_DEPTH = 64

/** Maximum JSON values visited across one projection cut. */
export const BLUE_PROJECTION_MAX_NODES = 16_384

/** Maximum own properties inspected across one projection cut. */
export const BLUE_PROJECTION_MAX_PROPERTIES = 16_384

/** Maximum encoded size of one projection primitive. */
export const BLUE_PROJECTION_PRIMITIVE_MAX_BYTES = BLUE_PROJECTION_VALUE_MAX_BYTES

/** Maximum UTF-8 size of one nested projection object key. */
export const BLUE_PROJECTION_JSON_KEY_MAX_BYTES = 1_024

/** Maximum ASCII length of a canonical projection resource key. */
export const BLUE_PROJECTION_KEY_MAX_LENGTH = 128

/** Maximum distinct key fingerprints retained at one epoch/sequence fence. */
export const BLUE_PROJECTION_FINGERPRINT_MAX_KEYS = 256

/** Maximum UTF-8 bytes retained by fingerprints at one epoch/sequence fence. */
export const BLUE_PROJECTION_FINGERPRINT_MAX_BYTES = 4_194_304

interface BlueSessionDataFailure {
  readonly code: BlueErrorCode
  readonly message: string
}

const SESSION_DATA_FAILURES = new WeakMap<object, BlueSessionDataFailure>()

/** Typed validation failure mapped to a public `BlueResult` by the host. */
class BlueSessionDataError extends Error {
  /** Stable public error classification. */
  readonly code: BlueErrorCode

  /**
   * Create a session-data failure.
   * @param code - stable public error classification.
   * @param message - actionable failure detail.
   */
  constructor(code: BlueErrorCode, message: string) {
    super(message)
    this.code = code
    SESSION_DATA_FAILURES.set(this, Object.freeze({ code, message }))
  }
}

/**
 * Inspect only errors minted by this module without reflecting over an
 * untrusted thrown value.
 * @param error - caught validation failure or hostile thrown value.
 * @returns controlled public details for a branded validation failure.
 */
export function inspectBlueSessionDataError(error: unknown): BlueSessionDataFailure | undefined {
  return SESSION_DATA_FAILURES.get(error as object)
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function own(input: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key)
  if (descriptor === undefined) return undefined
  if (!('value' in descriptor)) throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', `${key} must be an own data property`)
  return descriptor.value
}

function integer(value: unknown, label: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', `${label} must be a safe integer greater than or equal to ${String(minimum)}`)
  }
  return value
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function boundedString(value: unknown, label: string, allowEmpty = true): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', `${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`)
  }
  if (utf8Bytes(value) > BLUE_SESSION_STRING_MAX_BYTES) {
    throw new BlueSessionDataError('BLUE_LIMIT_EXCEEDED', `${label} exceeds ${String(BLUE_SESSION_STRING_MAX_BYTES)} bytes`)
  }
  return value
}

interface ProjectionBudget {
  nodes: number
  properties: number
}

function consumeProjectionNode(budget: ProjectionBudget): void {
  if (budget.nodes <= 0) {
    throw new BlueSessionDataError('BLUE_LIMIT_EXCEEDED', `projection cut exceeds ${String(BLUE_PROJECTION_MAX_NODES)} JSON values`)
  }
  budget.nodes -= 1
}

function reserveProjectionProperties(budget: ProjectionBudget, count: number): void {
  if (count > budget.properties) {
    throw new BlueSessionDataError('BLUE_LIMIT_EXCEEDED', `projection cut exceeds ${String(BLUE_PROJECTION_MAX_PROPERTIES)} inspected properties`)
  }
  budget.properties -= count
}

function projectionOwnKeys(input: object, budget: ProjectionBudget): readonly PropertyKey[] {
  const keys = Reflect.ownKeys(input)
  reserveProjectionProperties(budget, keys.length)
  for (const key of keys) {
    if (typeof key === 'string' && utf8Bytes(key) > BLUE_PROJECTION_JSON_KEY_MAX_BYTES) {
      throw new BlueSessionDataError('BLUE_LIMIT_EXCEEDED', `projection object keys are limited to ${String(BLUE_PROJECTION_JSON_KEY_MAX_BYTES)} bytes`)
    }
  }
  return keys
}

function cloneJson(
  input: unknown,
  budget: ProjectionBudget,
  seen = new Set<object>(),
  depth = 0,
): BlueJson {
  if (depth > BLUE_PROJECTION_MAX_DEPTH) {
    throw new BlueSessionDataError('BLUE_LIMIT_EXCEEDED', `projection values are limited to ${String(BLUE_PROJECTION_MAX_DEPTH)} levels`)
  }
  consumeProjectionNode(budget)
  if (input === null || typeof input === 'string' || typeof input === 'boolean') {
    if (encodedBytes(input) > BLUE_PROJECTION_PRIMITIVE_MAX_BYTES) {
      throw new BlueSessionDataError('BLUE_LIMIT_EXCEEDED', `projection primitives are limited to ${String(BLUE_PROJECTION_PRIMITIVE_MAX_BYTES)} bytes`)
    }
    return input
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'projection numbers must be finite')
    return input
  }
  if (!object(input) || seen.has(input)) {
    throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'projection values must be finite, acyclic JSON data')
  }
  seen.add(input)
  const keys = projectionOwnKeys(input, budget)
  if (Array.isArray(input)) {
    const length = Object.getOwnPropertyDescriptor(input, 'length')
    /* v8 ignore next -- every JavaScript Array has this non-configurable descriptor. */
    if (length === undefined || !('value' in length) || typeof length.value !== 'number') {
      throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'projection array length must be an own data property')
    }
    if (length.value > budget.nodes) {
      throw new BlueSessionDataError('BLUE_LIMIT_EXCEEDED', `projection cut exceeds ${String(BLUE_PROJECTION_MAX_NODES)} JSON values`)
    }
    const copy: BlueJson[] = []
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index))
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'projection arrays must not be sparse or accessor-backed')
      }
      copy.push(cloneJson(descriptor.value, budget, seen, depth + 1))
    }
    seen.delete(input)
    return Object.freeze(copy)
  }
  const copy: Record<string, BlueJson> = {}
  for (const key of keys) {
    if (typeof key !== 'string') continue
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    /* v8 ignore next -- Reflect.ownKeys returned this key from the same object. */
    if (descriptor === undefined) continue
    if (!descriptor.enumerable) continue
    if (!('value' in descriptor)) throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', `projection field ${JSON.stringify(key)} must be a data property`)
    Object.defineProperty(copy, key, { enumerable: true, value: cloneJson(descriptor.value, budget, seen, depth + 1) })
  }
  seen.delete(input)
  return Object.freeze(copy)
}

/**
 * Validate and detach one full app-owned session snapshot.
 * @param input - untrusted owner value.
 * @returns an immutable full snapshot, or `null` for no active session.
 */
export function validateBlueSessionSnapshot(input: unknown): BlueSessionSnapshot | null {
  if (input === null) return null
  if (!object(input)) throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'session snapshot must be an object or null')
  const revision = integer(own(input, 'revision'), 'session revision', 0)
  const sessionEpoch = integer(own(input, 'sessionEpoch'), 'session epoch', 0)
  const id = boundedString(own(input, 'id'), 'session id', false)
  const cwd = boundedString(own(input, 'cwd'), 'session cwd')
  const status = own(input, 'status')
  const mode = own(input, 'mode')
  if (!['idle', 'running', 'waiting', 'failed'].includes(status as string)) throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'session status is invalid')
  if (!['normal', 'plan', 'yolo'].includes(mode as string)) throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'session mode is invalid')
  const rawModel = own(input, 'model')
  let model: BlueSessionSnapshot['model']
  if (rawModel !== undefined) {
    if (!object(rawModel)) throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'session model must be an object')
    const modelId = boundedString(own(rawModel, 'id'), 'session model id', false)
    const rawProvider = own(rawModel, 'provider')
    const rawEffort = own(rawModel, 'effort')
    const provider = rawProvider === undefined ? undefined : boundedString(rawProvider, 'session model provider')
    const effort = rawEffort === undefined ? undefined : boundedString(rawEffort, 'session model effort')
    model = Object.freeze({ id: modelId, ...(provider === undefined ? {} : { provider }), ...(effort === undefined ? {} : { effort }) })
  }
  const snapshot = Object.freeze({ revision, sessionEpoch, id, cwd, status, mode, ...(model === undefined ? {} : { model }) }) as BlueSessionSnapshot
  if (encodedBytes(snapshot) > BLUE_SESSION_SNAPSHOT_MAX_BYTES) {
    throw new BlueSessionDataError('BLUE_LIMIT_EXCEEDED', `session snapshot exceeds ${String(BLUE_SESSION_SNAPSHOT_MAX_BYTES)} bytes`)
  }
  return snapshot
}

/**
 * Project a full owner snapshot through an exact canonical field grant.
 * @param snapshot - validated owner snapshot.
 * @param fields - exact granted fields.
 * @returns immutable public snapshot containing no ungranted user fields.
 */
export function scopeBlueSessionSnapshot(
  snapshot: BlueSessionSnapshot,
  fields: ReadonlySet<BlueSessionReadField>,
): BluePluginSessionSnapshot {
  return Object.freeze({
    revision: snapshot.revision,
    sessionEpoch: snapshot.sessionEpoch,
    ...(fields.has('identity') ? { id: snapshot.id } : {}),
    ...(fields.has('cwd') ? { cwd: snapshot.cwd } : {}),
    ...(fields.has('status') ? { status: snapshot.status } : {}),
    ...(fields.has('mode') ? { mode: snapshot.mode } : {}),
    ...(fields.has('model') && snapshot.model !== undefined ? { model: snapshot.model } : {}),
  })
}

/**
 * Validate, detach, size-bound, and key-scope one owner projection cut.
 * `null` is the only representation of an active owner with no session.
 * @param input - owner cut, `null`, or `undefined` when backing data is absent.
 * @param keys - exact granted keys requested by the consumer.
 * @param maxValueBytes - per-value encoded limit from the grant.
 * @param maxCutBytes - aggregate encoded limit from the grant.
 * @returns immutable public cut or `null`.
 */
export function scopeBlueProjectionCut(
  input: unknown,
  keys: readonly string[],
  maxValueBytes = BLUE_PROJECTION_VALUE_MAX_BYTES,
  maxCutBytes = BLUE_PROJECTION_CUT_MAX_BYTES,
): BlueSessionProjectionCut | null {
  if (input === null) return null
  if (input === undefined) throw new BlueSessionDataError('BLUE_CAPABILITY_ABSENT', 'session projection backing data is unavailable')
  if (!object(input)) throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'session projection cut must be an object or null')
  const sessionEpoch = integer(own(input, 'sessionEpoch'), 'projection session epoch', 0)
  const asOfSeq = integer(own(input, 'asOfSeq'), 'projection sequence', -1)
  const inputValues = own(input, 'values')
  if (!object(inputValues) || Array.isArray(inputValues)) throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'session projection values must be an object')
  const values: Record<string, BlueJson> = {}
  const budget: ProjectionBudget = { nodes: BLUE_PROJECTION_MAX_NODES, properties: BLUE_PROJECTION_MAX_PROPERTIES }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(inputValues, key)
    if (descriptor === undefined || !('value' in descriptor) || descriptor.value === undefined) {
      throw new BlueSessionDataError('BLUE_CAPABILITY_ABSENT', `session projection key ${JSON.stringify(key)} is unavailable`)
    }
    const value = cloneJson(descriptor.value, budget)
    if (encodedBytes(value) > maxValueBytes) {
      throw new BlueSessionDataError('BLUE_LIMIT_EXCEEDED', `session projection key ${JSON.stringify(key)} exceeds ${String(maxValueBytes)} bytes`)
    }
    Object.defineProperty(values, key, { enumerable: true, value })
  }
  const frozenValues = Object.freeze(values)
  const cut = Object.freeze({ sessionEpoch, asOfSeq, values: frozenValues })
  if (encodedBytes(cut) > maxCutBytes) {
    throw new BlueSessionDataError('BLUE_LIMIT_EXCEEDED', `session projection cut exceeds ${String(maxCutBytes)} bytes`)
  }
  return cut
}
