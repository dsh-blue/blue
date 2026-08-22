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
export { BluePluginHostService, apply, apply as applyHost, name, name as hostName } from './host.ts'
export type { BluePluginHost } from './contracts.ts'
export type {
  BlueCommandContribution,
  BlueContributionMeta,
  BlueDockContribution,
  BlueErrorCode,
  BlueField,
  BlueInlineSpan,
  BlueNotification,
  BluePluginApi,
  BlueRegistry,
  BlueJson,
  BlueRegistration,
  BlueRequestLifecycle,
  BlueRequestRef,
  BlueRequestState,
  BlueResult,
  BlueSection,
  BlueSessionAction,
  BlueSessionReader,
  BlueSessionSnapshot,
  BlueTone,
  BlueView,
} from './contracts.ts'

/** Blue's public API major version. */
export const BLUE_API_VERSION = '1.0.0'

/** Blue's release version, kept here as the public version owner. */
export const BLUE_VERSION = '0.1.0-rc.3'
