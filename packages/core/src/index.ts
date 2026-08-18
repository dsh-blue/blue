/**
 * @deepseek-ai/dsh-blue-core — Blue terminal UI core: the tree's only
 * `@earendil-works/pi-tui` adapter. Loading the plugin starts the terminal
 * (main-screen renderer over `ProcessTerminal`) and registers the
 * `blueScreen`, `blueTheme`, and `blueKeymap` services; unloading stops the
 * terminal and restores its state.
 *
 * @module @deepseek-ai/dsh-blue-core
 */

import type { Context } from '@deepseek-ai/cordis'
import { BlueKeymapService } from './keymap.ts'
import { BlueScreenService } from './screen.ts'
import { BlueThemeService } from './theme.ts'
import { startBlueTerminal } from './terminal.ts'

export { BlueKeymapError, BlueKeymapService } from './keymap.ts'
export { BlueScreenService } from './screen.ts'
export { BlueThemeService } from './theme.ts'
export { createTerminalRelease } from './terminal.ts'
export type {
  BlueColorFn,
  BlueComponent,
  BlueFocusable,
  BlueKeyAction,
  BlueKeymap,
  BlueOverlayAnchor,
  BlueOverlayHandle,
  BlueOverlayOptions,
  BlueOverlaySize,
  BlueOverlayUnfocusOptions,
  BlueScreen,
  BlueSemanticColors,
  BlueTheme,
} from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-core'

/**
 * Start the terminal and mount the three L1 services. Each service is a
 * class plugin on its own fiber, so unloading this plugin unregisters all
 * three; the effect stops the terminal last.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const runtime = startBlueTerminal()
  ctx.plugin(BlueKeymapService)
  ctx.plugin(BlueThemeService)
  ctx.plugin(BlueScreenService, runtime)
  ctx.effect(() => () => runtime.stop())
}
