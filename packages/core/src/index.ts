/**
 * @dsh-blue/blue-core — Blue terminal UI core: the tree's only
 * `@earendil-works/pi-tui` adapter. Loading the plugin probes the terminal
 * background (OSC 11, before raw mode), starts the alternate-screen renderer
 * over `ProcessTerminal`, and registers the `blueScreen`, `blueKeymap`,
 * `blueTerminalInfo`, and `blueComponents` services; `blueTheme` is
 * provided separately by the `blue-theme-dark` subpath plugin. A global key
 * dispatcher mounted as a TUI input listener consumes handler-carrying key
 * actions before focus routing. Unloading stops the terminal and restores
 * its state.
 *
 * @module @dsh-blue/blue-core
 */

import type { Context } from '@deepseek-ai/cordis'
import { BlueComponentsService } from './components.ts'
import { BlueKeymapService } from './keymap.ts'
import { BlueScreenService } from './screen.ts'
import { BlueTerminalInfoService } from './terminal-info.ts'
import { startBlueTerminal } from './terminal.ts'
import { mountPluginSurfaceBridge } from './plugin-surface-bridge.ts'
import { NotificationModelService, ThemeModelService } from '@dsh-blue/blue-frontend'

export { BlueComponentsService, type BlueComponentsDeps } from './components.ts'
export { mountDockChild } from './dock.ts'
export { GutterComponent } from './gutter.ts'
export { BlueKeymapError, BlueKeymapService } from './keymap.ts'
export { BlueScreenService } from './screen.ts'
export {
  PLUGIN_VIEW_MAX_CHARS,
  PLUGIN_VIEW_MAX_DEPTH,
  paintPluginTone,
  sanitizePluginText,
  summarizePluginView,
} from './plugin-view.ts'
export {
  BlueTerminalInfoService,
  PROBE_TIMEOUT_MS,
  backgroundFromRgb,
  probeTerminalBackground,
  type BlueProbeProcess,
} from './terminal-info.ts'
export { createTerminalRelease } from './terminal.ts'
export { alignDiffLines, diffChangeCounts, paintDiffRows, DIFF_ALIGN_MAX_ROWS, CTX_EDGE_ROWS, type DiffOp, type DiffPaintColors } from './diff-align.ts'
export { visibleWidth } from './width.ts'
export {
  compileBlueEditorShellNode,
  compileBlueStatusNode,
  compileBlueUiNode,
  type BlueCompiledEditorShell,
  type BlueEditorShellComponent,
  type BlueCompiledStatus,
  type BlueEditorShellRenderOptions,
  type BlueEditorShellRenderResult,
  type BlueCompiledUi,
  type BlueEditorShellCompileResult,
  type BlueEditorShellCompilerOptions,
  type BlueStatusCompileFailure,
  type BlueStatusCompileResult,
  type BlueStatusCompilerOptions,
  type BlueStatusComponent,
  type BlueStatusRenderResult,
  type BlueUiCompileFailure,
  type BlueUiCompileResult,
  type BlueUiCompilerOptions,
  type BlueUiViewport,
} from './ui-compiler.ts'
export {
  BLUE_UI_MAX_COLLECTION,
  BLUE_UI_MAX_DEPTH,
  BLUE_UI_MAX_NODES,
  BLUE_UI_MAX_TEXT,
  validateBlueEditorShellNode,
  validateBlueStatusNode,
  validateBlueUiNode,
} from './ui-validator.ts'
export {
  TITLE_MAX_CHARS,
  buildClipboardOsc52,
  buildTitleOsc0,
  emitClipboardOsc52,
  sanitizeTitleText,
  type BlueEscapeProcess,
} from './terminal-escape.ts'
export type {
  BlueAutocompleteItem,
  BlueAutocompleteProvider,
  BlueAutocompleteSuggestions,
  BlueColorFn,
  BlueComponent,
  BlueComponents,
  BlueDockOptions,
  BlueEditor,
  BlueEditorOptions,
  BlueEditorSubmitAttempt,
  BlueFocusable,
  BlueImage,
  BlueImageOptions,
  BlueKeyAction,
  BlueKeymap,
  BlueMarkdown,
  BlueMarkdownOptions,
  BlueOverlayAnchor,
  BlueOverlayHandle,
  BlueOverlayOptions,
  BlueOverlaySize,
  BlueOverlayUnfocusOptions,
  BlueRgbColor,
  BlueScreen,
  BlueSelectItem,
  BlueSelectList,
  BlueSelectListOptions,
  BlueSemanticColors,
  BlueSettingItem,
  BlueSettingsList,
  BlueSettingsListOptions,
  BlueTerminalInfo,
  BlueTheme,
  BlueTopRuleOptions,
} from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-core'

/**
 * Probe the terminal, start it, and mount the L1 services. `blueKeymap`
 * instantiates directly (see below); the remaining services are class
 * plugins on their own fibers, so unloading this plugin unregisters all of
 * them; the effect stops the terminal last. `blueComponents` mounts as a
 * sub-plugin injecting `blueTheme`: while no theme provider is loaded the
 * sub-plugin waits, and a provider swap rebuilds the factory through
 * Cordis reload semantics.
 * @param ctx - plugin context.
 */
export async function apply(ctx: Context): Promise<void> {
  ctx.plugin(ThemeModelService)
  ctx.plugin(NotificationModelService)
  const runtime = await startBlueTerminal(undefined, undefined, (scheme) => {
    ctx.emit('blue/terminal-theme-changed', scheme)
  }, undefined, 'alternate', { stdout: process.stdout, stderr: process.stderr })
  // The keymap instantiates directly instead of as a class plugin so the
  // dispatcher below can close over the instance: the runtime predates the
  // service, and the Context proxy rejects service access without an inject
  // declaration — which a self-provided service cannot carry. Registration
  // is still effect-bound, so unloading reverts it.
  const keymap = new BlueKeymapService(ctx)
  // The global key dispatcher consumes handler-carrying actions before
  // focus routing; wiring it here because the runtime predates the keymap.
  ctx.effect(() =>
    runtime.tui.addInputListener(data => (keymap.dispatch(data) ? { consume: true } : undefined)),
  )
  ctx.plugin(BlueTerminalInfoService, { background: runtime.background, kittyKeyboard: runtime.kittyKeyboard })
  ctx.plugin(BlueScreenService, runtime)
  ctx.plugin({
    name: 'blue-components',
    inject: ['blueTheme'],
    apply(subCtx: Context) {
      subCtx.plugin(BlueComponentsService, { theme: subCtx.blueTheme, tui: runtime.tui })
    },
  })
  ctx.plugin({
    name: 'blue-plugin-surface-bridge',
    inject: ['bluePluginHost', 'blueComponents', 'blueTheme', 'blueKeymap'],
    apply(subCtx: Context) {
      mountPluginSurfaceBridge(subCtx as Parameters<typeof mountPluginSurfaceBridge>[0], runtime)
    },
  })
  ctx.effect(() => () => runtime.stop())
}
