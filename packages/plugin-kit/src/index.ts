/**
 * Public process boundary for Blue plugin authoring runtimes.
 *
 * @module @dsh-blue/blue-plugin-kit
 */

import { fileURLToPath } from 'node:url'
import type { AuthorRuntime } from './cli.ts'

/** Exact Harness line exercised by this release's default conformance run. */
export const BLUE_PLUGIN_HARNESS_LINE = '0.1.1-rc.2'

/** Previous Harness line exercised by the P5 compatibility gate. */
export const BLUE_PLUGIN_PREVIOUS_HARNESS_LINE = '0.1.1-rc.1'

/**
 * Resolve a shipped author runtime without assuming a global executable PATH.
 * @param name - validator or packed conformance runtime.
 * @returns absolute JavaScript entry path in this installed package.
 */
export function bluePluginRuntimePath(name: AuthorRuntime): string {
  return fileURLToPath(new URL(`../runtime/${name}.mjs`, import.meta.url))
}
