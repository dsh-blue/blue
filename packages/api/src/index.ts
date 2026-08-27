/**
 * Stable, renderer-independent public contracts for Blue Cordis plugins.
 *
 * @module @dsh-blue/blue-api
 */

export {
  validateBlueManifest,
  type BlueCapability,
  type BlueManifestErrorCode,
  type BlueManifestResult,
  type BluePluginDefinition,
  type BluePluginManifest,
} from './manifest.ts'
export {
  BluePluginHostService,
  attachBluePluginHostCapabilities,
  apply,
  apply as applyHost,
  name,
  name as hostName,
  snapshotBluePluginHost,
  subscribeBluePluginHost,
  subscribeBluePluginNotifications,
  type BluePluginHostSnapshot,
} from './host.ts'
export type * from './contracts.ts'

/** Blue's public API major version. */
export const BLUE_API_VERSION = '1.0.0'

/** Blue's release version, kept here as the public version owner. */
export const BLUE_VERSION = '0.1.0-rc.10'
