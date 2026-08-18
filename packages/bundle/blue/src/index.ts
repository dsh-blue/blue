/**
 * @deepseek-ai/dsh-blue — the Blue terminal UI bundle. `cordis.patch.yml`
 * rides over dsh-base and inserts the Blue rows: core (terminal + L1
 * services), transcript, interaction, the startup command-line provider, and
 * the app driver. The bundle module itself mounts nothing; composition lives
 * entirely in the patch.
 *
 * @module @deepseek-ai/dsh-blue
 */

import type { Context } from '@deepseek-ai/cordis'

/** Stable Cordis plugin name. */
export const name = 'blue-bundle'

/**
 * Mount the Blue bundle's own plugins. Every Blue row is inserted by
 * `cordis.patch.yml`, so the bundle module registers nothing.
 * @param _ctx - plugin context.
 */
export function apply(_ctx: Context): void {}
