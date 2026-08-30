/**
 * Publish the installed Blue plugin author command as trusted shell facts.
 *
 * @module @dsh-blue/blue-interaction/author-command-environment
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Load the official Context declaration merge for ctx.shellEnv.
import type {} from '@deepseek-ai/dsh-shell-env'

const require = createRequire(import.meta.url)

/** Absolute Node.js executable used to launch the author command. */
export const BLUE_PLUGIN_NODE_ENV = 'DSH_BLUE_PLUGIN_NODE'

/** Absolute installed JavaScript entry for the author command. */
export const BLUE_PLUGIN_BIN_ENV = 'DSH_BLUE_PLUGIN_BIN'

/** Stable Cordis plugin name. */
export const name = 'blue-plugin-author-environment'

/** The Harness-owned trusted shell environment registry is required. */
export const inject = ['shellEnv']

/**
 * Register the installed author command for every model-facing shell call.
 * @param ctx - interaction child Fiber context.
 */
export function apply(ctx: Context): void {
  const pluginKitRoot = dirname(require.resolve('@dsh-blue/blue-plugin-kit/package.json'))
  const node = process.execPath
  const bin = join(pluginKitRoot, 'lib', 'bin.js')
  ctx.shellEnv.register({
    name: 'blue-plugin-author-command',
    variables: {
      [BLUE_PLUGIN_NODE_ENV]: { description: 'Absolute Node.js executable for the installed Blue plugin author command.' },
      [BLUE_PLUGIN_BIN_ENV]: { description: 'Absolute JavaScript entry for the installed Blue plugin author command.' },
    },
    resolve: () => ({
      [BLUE_PLUGIN_NODE_ENV]: node,
      [BLUE_PLUGIN_BIN_ENV]: bin,
    }),
  })
}
