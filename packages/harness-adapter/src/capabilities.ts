import type { AdapterCapability, AdapterAbsent } from './types.ts'

export interface CapabilitySource { readonly capabilities?: readonly string[]; hasCapability?(capability: string): boolean }
export interface CapabilityProbe { readonly present: readonly AdapterCapability[]; readonly absent: readonly AdapterAbsent[]; has(capability: AdapterCapability): boolean; require(capability: AdapterCapability): AdapterAbsent | undefined }

export function probeCapabilities(source: CapabilitySource, requested: readonly AdapterCapability[]): CapabilityProbe {
  const declared = new Set(source.capabilities ?? [])
  const present = requested.filter(capability => source.hasCapability?.(capability) ?? declared.has(capability))
  const absent = requested.filter(capability => !present.includes(capability)).map(capability => ({ kind: 'absent' as const, capability, reason: `Harness capability "${capability}" is unavailable` }))
  return { present: Object.freeze(present), absent: Object.freeze(absent), has: capability => present.includes(capability), require: capability => absent.find(item => item.capability === capability) }
}
