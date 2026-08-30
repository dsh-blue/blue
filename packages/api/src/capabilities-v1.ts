/**
 * Canonical v1 capability catalog and deterministic resource negotiation.
 *
 * @module @dsh-blue/blue-api/capabilities-v1
 */

import { intersects } from 'semver'
import type {
  BlueCapabilityGrant,
  BlueCapabilityGrantResources,
  BlueCapabilityLimits,
  BlueCapabilityQuotas,
  BlueCapabilityUnavailable,
  BlueCapabilityUnavailableReason,
  BlueErrorCode,
} from './contracts.ts'
import {
  BLUE_PLUGIN_CAPABILITIES_V1,
  BLUE_PLUGIN_PROTOCOL_VERSION,
  type BluePluginCapabilityRequestV1,
  type BluePluginManifestV1,
  type BluePluginCapabilityNameV1,
} from './manifest-v1.generated.ts'
import {
  BLUE_PROJECTION_CUT_MAX_BYTES,
  BLUE_PROJECTION_FINGERPRINT_MAX_BYTES,
  BLUE_PROJECTION_FINGERPRINT_MAX_KEYS,
  BLUE_PROJECTION_JSON_KEY_MAX_BYTES,
  BLUE_PROJECTION_KEY_MAX_LENGTH,
  BLUE_PROJECTION_MAX_DEPTH,
  BLUE_PROJECTION_MAX_NODES,
  BLUE_PROJECTION_MAX_PROPERTIES,
  BLUE_PROJECTION_PRIMITIVE_MAX_BYTES,
  BLUE_PROJECTION_VALUE_MAX_BYTES,
} from './session-data.ts'

/** Resource domains understood by the v1 catalog. */
export type BlueCapabilityResourceKind = 'names' | 'placements' | 'fields' | 'keys'

/** One immutable catalog definition owned by the host. */
export interface BlueCapabilityDefinition {
  readonly name: BluePluginCapabilityNameV1
  /** Concrete version selected when a request range intersects this definition. */
  readonly version: string
  /** False means the shape exists in the protocol but this composition has no owner. */
  readonly supported: boolean
  readonly resourceKind?: BlueCapabilityResourceKind
  readonly resources?: readonly string[]
  readonly limits: BlueCapabilityLimits
  readonly quotas: BlueCapabilityQuotas
}

/** Host state consulted while negotiating a canonical manifest. */
export interface BlueCapabilityNegotiationOptions {
  readonly apiVersion?: string
  readonly ownerReady?: (name: BluePluginCapabilityNameV1) => boolean
  /** Whether the current composition has installed a capability definition/buffer. */
  readonly supported?: (name: BluePluginCapabilityNameV1) => boolean
  /** Owner generation captured in every exact grant (zero when unspecified). */
  readonly generation?: (name: BluePluginCapabilityNameV1) => number
  readonly policy?: (name: BluePluginCapabilityNameV1, request: BluePluginCapabilityRequestV1) => boolean
  readonly catalog?: readonly BlueCapabilityDefinition[]
}

/** Structured failure from required capability admission. */
export interface BlueCapabilityAdmissionFailure {
  readonly ok: false
  readonly code: BlueErrorCode
  readonly message: string
  readonly capability?: BluePluginCapabilityNameV1
}

/** Successful canonical admission details. */
export interface BlueCapabilityAdmissionSuccess {
  readonly ok: true
  readonly grants: readonly BlueCapabilityGrant[]
  readonly unavailableOptional: readonly BlueCapabilityUnavailable[]
}

/** Result of required/optional capability negotiation. */
export type BlueCapabilityAdmission = BlueCapabilityAdmissionSuccess | BlueCapabilityAdmissionFailure

const RESOURCE_LIMITS = Object.freeze({
  commands: 64,
  panes: 4,
  fields: 5,
  keys: 64,
})

const RESOURCE_QUOTAS = Object.freeze({
  refreshPerSecond: 20,
  panesPerConsumer: 8,
  overlaysGlobal: 4,
})

const DEFINITIONS: readonly BlueCapabilityDefinition[] = [
  {
    name: 'commands',
    version: '1.0.0',
    supported: true,
    resourceKind: 'names',
    // Command ids are plugin-defined. An omitted resource list means the
    // host grants every schema-valid name, subject only to maxNames.
    limits: Object.freeze({ maxNames: RESOURCE_LIMITS.commands }),
    quotas: Object.freeze({}),
  },
  {
    name: 'status',
    version: '1.0.0',
    supported: true,
    limits: Object.freeze({ maxEntries: 64 }),
    quotas: Object.freeze({ refreshPerSecond: RESOURCE_QUOTAS.refreshPerSecond }),
  },
  {
    name: 'panes',
    version: '1.0.0',
    supported: true,
    resourceKind: 'placements',
    resources: Object.freeze(['header', 'left', 'right', 'bottom']),
    limits: Object.freeze({ maxPlacements: RESOURCE_LIMITS.panes }),
    quotas: Object.freeze({ maxPerConsumer: RESOURCE_QUOTAS.panesPerConsumer, refreshPerSecond: RESOURCE_QUOTAS.refreshPerSecond }),
  },
  {
    name: 'overlays',
    version: '1.0.0',
    supported: true,
    limits: Object.freeze({ maxStack: RESOURCE_QUOTAS.overlaysGlobal }),
    quotas: Object.freeze({ maxCapturingPerConsumer: 1, refreshPerSecond: RESOURCE_QUOTAS.refreshPerSecond }),
  },
  {
    name: 'notifications.publish',
    version: '1.0.0',
    supported: true,
    limits: Object.freeze({
      maxViewBytes: 32_768,
      maxDepth: 64,
      maxNodes: 4_096,
      maxProperties: 8_192,
      maxPrimitiveBytes: 32_768,
    }),
    quotas: Object.freeze({ maxPerSecond: 20 }),
  },
  {
    name: 'session.read',
    version: '1.0.0',
    supported: true,
    resourceKind: 'fields',
    resources: Object.freeze(['identity', 'cwd', 'status', 'mode', 'model']),
    limits: Object.freeze({ maxFields: RESOURCE_LIMITS.fields }),
    quotas: Object.freeze({}),
  },
  {
    name: 'session.projections.read',
    version: '1.0.0',
    supported: true,
    resourceKind: 'keys',
    // Projection keys are domain-defined. Admission grants the exact declared
    // names; runtime reads still require each key to exist in the live Host
    // projection registry.
    limits: Object.freeze({
      maxKeys: RESOURCE_LIMITS.keys,
      maxKeyLength: BLUE_PROJECTION_KEY_MAX_LENGTH,
      maxValueBytes: BLUE_PROJECTION_VALUE_MAX_BYTES,
      maxCutBytes: BLUE_PROJECTION_CUT_MAX_BYTES,
      maxDepth: BLUE_PROJECTION_MAX_DEPTH,
      maxNodes: BLUE_PROJECTION_MAX_NODES,
      maxProperties: BLUE_PROJECTION_MAX_PROPERTIES,
      maxPrimitiveBytes: BLUE_PROJECTION_PRIMITIVE_MAX_BYTES,
      maxObjectKeyBytes: BLUE_PROJECTION_JSON_KEY_MAX_BYTES,
      maxTrackedFingerprints: BLUE_PROJECTION_FINGERPRINT_MAX_KEYS,
      maxFingerprintBytes: BLUE_PROJECTION_FINGERPRINT_MAX_BYTES,
    }),
    quotas: Object.freeze({}),
  },
]

function freezeDefinition(definition: BlueCapabilityDefinition): BlueCapabilityDefinition {
  return Object.freeze({
    ...definition,
    ...(definition.resources === undefined ? {} : { resources: Object.freeze([...definition.resources]) }),
    limits: Object.freeze({ ...definition.limits }),
    quotas: Object.freeze({ ...definition.quotas }),
  })
}

/** Immutable host catalog for the seven canonical v1 capability names. */
export const BLUE_CAPABILITY_CATALOG_V1: readonly BlueCapabilityDefinition[] = Object.freeze(DEFINITIONS.map(freezeDefinition))

const definitionByName = new Map<BluePluginCapabilityNameV1, BlueCapabilityDefinition>(BLUE_CAPABILITY_CATALOG_V1.map(definition => [definition.name, definition]))

function failure(code: BlueErrorCode, message: string, capability?: BluePluginCapabilityNameV1): BlueCapabilityAdmissionFailure {
  return Object.freeze({ ok: false, code, message, ...(capability === undefined ? {} : { capability }) })
}

function unavailable(name: BluePluginCapabilityNameV1, reason: BlueCapabilityUnavailableReason, message: string): BlueCapabilityUnavailable {
  return Object.freeze({ name, reason, message })
}

function copyResources(resources: BlueCapabilityGrantResources | undefined): BlueCapabilityGrantResources | undefined {
  if (resources === undefined) return undefined
  if ('names' in resources) return Object.freeze({ names: Object.freeze([...resources.names]) })
  if ('placements' in resources) return Object.freeze({ placements: Object.freeze([...resources.placements]) })
  if ('fields' in resources) return Object.freeze({ fields: Object.freeze([...resources.fields]) })
  return Object.freeze({ keys: Object.freeze([...resources.keys]) })
}

function requestResources(request: BluePluginCapabilityRequestV1): { kind: BlueCapabilityResourceKind, values: readonly string[] } | undefined {
  if (request.name === 'commands') return { kind: 'names', values: request.resources.names }
  if (request.name === 'panes') return { kind: 'placements', values: request.resources.placements }
  if (request.name === 'session.read') return { kind: 'fields', values: request.resources.fields }
  if (request.name === 'session.projections.read') return { kind: 'keys', values: request.resources.keys }
  return undefined
}

function grantResources(
  definition: BlueCapabilityDefinition,
  request: BluePluginCapabilityRequestV1,
): { readonly resources?: BlueCapabilityGrantResources, readonly partial: boolean } | BlueCapabilityAdmissionFailure {
  const requested = requestResources(request)
  if (requested === undefined || definition.resourceKind === undefined) return { partial: false }
  if (requested.kind !== definition.resourceKind) return failure('BLUE_RESOURCE_DENIED', `resource kind for capability "${request.name}" is not supported`, request.name)
  const allowed = definition.resources
  const values = allowed === undefined
    ? [...requested.values]
    : requested.values.filter(value => new Set(allowed).has(value))
  const partial = values.length !== requested.values.length
  const max = definition.limits[`max${requested.kind === 'names' ? 'Names' : requested.kind === 'placements' ? 'Placements' : requested.kind === 'fields' ? 'Fields' : 'Keys'}`]
  if (typeof max === 'number' && values.length > max) {
    return failure('BLUE_RESOURCE_DENIED', `capability "${request.name}" exceeds the host resource limit`, request.name)
  }
  if (values.length === 0) return failure('BLUE_RESOURCE_DENIED', `capability "${request.name}" has no grantable resources`, request.name)
  const resources = requested.kind === 'names'
    ? { names: Object.freeze(values) }
    : requested.kind === 'placements'
      ? { placements: Object.freeze(values as ('header' | 'left' | 'right' | 'bottom')[]) }
      : requested.kind === 'fields'
        ? { fields: Object.freeze(values as ('identity' | 'cwd' | 'status' | 'mode' | 'model')[]) }
        : { keys: Object.freeze(values) }
  return { resources: Object.freeze(resources), partial }
}

function grant(definition: BlueCapabilityDefinition, resources: BlueCapabilityGrantResources | undefined, available: boolean, generation: number): BlueCapabilityGrant {
  const copiedResources = copyResources(resources)
  return Object.freeze({
    name: definition.name,
    version: definition.version,
    generation,
    ...(copiedResources === undefined ? {} : { resources: copiedResources }),
    limits: Object.freeze({ ...definition.limits }),
    quotas: Object.freeze({ ...definition.quotas }),
    availability: available ? 'ready' : 'unavailable',
  })
}

function intersectsRange(requested: string, actual: string): boolean {
  try {
    return intersects(requested, actual, { includePrerelease: true })
  } catch {
    return false
  }
}

/**
 * Negotiate a canonical manifest against the host catalog.
 *
 * Required requests fail atomically; optional requests become exact grants or
 * structured unavailable records. No mutable input is retained.
 */
export function negotiateBlueCapabilities(manifest: BluePluginManifestV1, options: BlueCapabilityNegotiationOptions = {}): BlueCapabilityAdmission {
  const catalog = options.catalog ?? BLUE_CAPABILITY_CATALOG_V1
  const definitions = new Map(catalog.map(definition => [definition.name, definition]))
  const ownerReady = options.ownerReady ?? (() => true)
  const supported = options.supported ?? (() => true)
  const generation = options.generation ?? (() => 0)
  const apiVersion = options.apiVersion ?? BLUE_PLUGIN_PROTOCOL_VERSION
  if (!intersectsRange(manifest.api, apiVersion)) return failure('BLUE_API_INCOMPATIBLE', `plugin API range "${manifest.api}" does not include ${apiVersion}`)

  const grants: BlueCapabilityGrant[] = []
  const unavailableOptional: BlueCapabilityUnavailable[] = []
  const required = manifest.capabilities.required
  const optional = manifest.capabilities.optional
  const admit = (request: BluePluginCapabilityRequestV1, requiredRequest: boolean): BlueCapabilityAdmissionFailure | undefined => {
    const definition = definitions.get(request.name)
    if (definition === undefined || !BLUE_PLUGIN_CAPABILITIES_V1.includes(request.name) || !supported(request.name)) {
      const issue = unavailable(request.name, 'unsupported', `capability "${request.name}" is not supported by this host`)
      if (requiredRequest) return failure('BLUE_CAPABILITY_UNSUPPORTED', issue.message, request.name)
      unavailableOptional.push(issue)
      return undefined
    }
    if (!definition.supported) {
      const issue = unavailable(request.name, 'unsupported', `capability "${request.name}" has no active owner in this composition`)
      if (requiredRequest) return failure('BLUE_CAPABILITY_UNSUPPORTED', issue.message, request.name)
      unavailableOptional.push(issue)
      return undefined
    }
    if (!intersectsRange(request.version, definition.version)) {
      const issue = unavailable(request.name, 'version', `capability "${request.name}" does not support version range "${request.version}"`)
      if (requiredRequest) return failure('BLUE_CAPABILITY_VERSION_UNSUPPORTED', issue.message, request.name)
      unavailableOptional.push(issue)
      return undefined
    }
    if (options.policy !== undefined && !options.policy(request.name, request)) {
      const issue = unavailable(request.name, 'policy', `host policy denied capability "${request.name}"`)
      if (requiredRequest) return failure('BLUE_POLICY_DENIED', issue.message, request.name)
      unavailableOptional.push(issue)
      return undefined
    }
    const resourceResult = grantResources(definition, request)
    if (!('partial' in resourceResult)) {
      if (requiredRequest) return resourceResult
      unavailableOptional.push(unavailable(request.name, 'resource', resourceResult.message))
      return undefined
    }
    if (resourceResult.partial && requiredRequest) return failure('BLUE_RESOURCE_DENIED', `capability "${request.name}" requested resources outside the host grant`, request.name)
    const ready = ownerReady(request.name)
    if (!ready && !requiredRequest) unavailableOptional.push(unavailable(request.name, 'owner-gap', `capability "${request.name}" owner is not ready`))
    grants.push(grant(definition, resourceResult.resources, ready, generation(request.name)))
    if (resourceResult.partial) unavailableOptional.push(unavailable(request.name, 'resource', `capability "${request.name}" was granted a resource subset`))
    return undefined
  }
  for (const request of required) {
    const issue = admit(request, true)
    if (issue !== undefined) return issue
  }
  for (const request of optional) admit(request, false)
  return Object.freeze({ ok: true, grants: Object.freeze(grants), unavailableOptional: Object.freeze(unavailableOptional) })
}

/** Look up one catalog definition by canonical capability name. */
export function getBlueCapabilityDefinition(name: BluePluginCapabilityNameV1): BlueCapabilityDefinition | undefined {
  return definitionByName.get(name)
}
