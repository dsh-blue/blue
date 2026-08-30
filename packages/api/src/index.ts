/**
 * Beta, renderer-independent public contracts for Blue Cordis plugins.
 *
 * @module @dsh-blue/blue-api
 */

export {
  validateBlueManifest,
  type BlueCapability,
  type BlueBetaCapability,
  type BlueExperimentalCapability,
  type BlueManifestErrorCode,
  type BlueManifestResult,
  type BluePluginDefinition,
  type BluePluginManifest,
} from './manifest.ts'
export {
  BluePluginHostService,
  apply,
  apply as applyHost,
  name,
  name as hostName,
  type BluePluginHostSnapshot,
  type BluePluginHostOptions,
  type BluePluginHostOverlayEntry,
  type BluePluginHostPaneEntry,
  type BlueSessionProjectionOwner,
} from './host.ts'
export {
  BLUE_CAPABILITY_CATALOG_V1,
  getBlueCapabilityDefinition,
  negotiateBlueCapabilities,
  type BlueCapabilityAdmission,
  type BlueCapabilityAdmissionFailure,
  type BlueCapabilityAdmissionSuccess,
  type BlueCapabilityDefinition,
  type BlueCapabilityNegotiationOptions,
  type BlueCapabilityResourceKind,
} from './capabilities-v1.ts'
export type * from './contracts.ts'

/** Blue's public API Beta version. */
export const BLUE_API_VERSION = '1.0.0-beta.1'

/** Blue's release version, kept here as the public version owner. */
export const BLUE_VERSION = '0.1.1-rc.2'
