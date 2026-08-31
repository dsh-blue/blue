/**
 * Public process boundary for Blue plugin authoring runtimes.
 *
 * @module @dsh-blue/blue-plugin-kit
 */

import { fileURLToPath } from 'node:url'
import type { AuthorRuntime } from './cli.ts'

/** Exact Harness line exercised by this release's default conformance run. */
export const BLUE_PLUGIN_HARNESS_LINE = '0.1.2-alpha.2'

/** Exact Harness lines supported by this Blue release. RC lines are excluded. */
export const BLUE_PLUGIN_SUPPORTED_HARNESS_LINES = [BLUE_PLUGIN_HARNESS_LINE] as const

/**
 * Resolve a shipped author runtime without assuming a global executable PATH.
 * @param name - validator or packed conformance runtime.
 * @returns absolute JavaScript entry path in this installed package.
 */
export function bluePluginRuntimePath(name: AuthorRuntime): string {
  return fileURLToPath(new URL(`../runtime/${name}.mjs`, import.meta.url))
}
