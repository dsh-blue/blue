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

/** Typed validation failure mapped to a public `BlueResult` by the host. */
export class BlueSessionDataError extends Error {
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
  }
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

function cloneJson(input: unknown, seen = new Set<object>()): BlueJson {
  if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'projection numbers must be finite')
    return input
  }
  if (!object(input) || seen.has(input)) {
    throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'projection values must be finite, acyclic JSON data')
  }
  seen.add(input)
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (Array.isArray(input)) {
    const length = descriptors.length
    /* v8 ignore next -- every JavaScript Array has this non-configurable descriptor. */
    if (length === undefined || !('value' in length) || typeof length.value !== 'number') {
      throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'projection array length must be an own data property')
    }
    const copy: BlueJson[] = []
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = descriptors[String(index)]
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'projection arrays must not be sparse or accessor-backed')
      }
      copy.push(cloneJson(descriptor.value, seen))
    }
    seen.delete(input)
    return Object.freeze(copy)
  }
  const copy: Record<string, BlueJson> = {}
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable) continue
    if (!('value' in descriptor)) throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', `projection field ${JSON.stringify(key)} must be a data property`)
    Object.defineProperty(copy, key, { enumerable: true, value: cloneJson(descriptor.value, seen) })
  }
  seen.delete(input)
  return Object.freeze(copy)
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
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
  const id = own(input, 'id')
  const cwd = own(input, 'cwd')
  const status = own(input, 'status')
  const mode = own(input, 'mode')
  if (typeof id !== 'string' || id.length === 0) throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'session id must be a non-empty string')
  if (typeof cwd !== 'string') throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'session cwd must be a string')
  if (!['idle', 'running', 'waiting', 'failed'].includes(status as string)) throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'session status is invalid')
  if (!['normal', 'plan', 'yolo'].includes(mode as string)) throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'session mode is invalid')
  const rawModel = own(input, 'model')
  let model: BlueSessionSnapshot['model']
  if (rawModel !== undefined) {
    if (!object(rawModel)) throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'session model must be an object')
    const modelId = own(rawModel, 'id')
    const provider = own(rawModel, 'provider')
    const effort = own(rawModel, 'effort')
    if (typeof modelId !== 'string' || modelId.length === 0) throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'session model id must be a non-empty string')
    if (provider !== undefined && typeof provider !== 'string') throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'session model provider must be a string')
    if (effort !== undefined && typeof effort !== 'string') throw new BlueSessionDataError('BLUE_INTERNAL_FAILURE', 'session model effort must be a string')
    model = Object.freeze({ id: modelId, ...(provider === undefined ? {} : { provider }), ...(effort === undefined ? {} : { effort }) })
  }
  return Object.freeze({ revision, sessionEpoch, id, cwd, status, mode, ...(model === undefined ? {} : { model }) }) as BlueSessionSnapshot
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
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(inputValues, key)
    if (descriptor === undefined || !('value' in descriptor) || descriptor.value === undefined) {
      throw new BlueSessionDataError('BLUE_CAPABILITY_ABSENT', `session projection key ${JSON.stringify(key)} is unavailable`)
    }
    const value = cloneJson(descriptor.value)
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
