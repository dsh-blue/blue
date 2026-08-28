/**
 * @dsh-blue/blue-interaction — Blue terminal UI interaction layer
 * over `dsh-blue-core`: the bottom input editor with slash-command dispatch
 * (`blue-input`, pi-tui Editor behind `ctx.blueComponents`), the built-in
 * `/quit`, `/resume`, `/new`, `/fork`, `/sessions`, `/help`, and `/theme`
 * commands (`blue-commands`), the `ctx.userQuestions`
 * overlay provider (`blue-questions`, one tabbed questionnaire overlay per
 * request), and the interactive four-choice `approval/request` answerer
 * (`blue-approval`). The optional bash-mode and autocomplete enhancement
 * layer ships as the `./editor-plus` subpath plugin (`blue-editor-plus`),
 * and the queued-message pane with app-owned live refresh as the
 * `./pane-queue` subpath plugin (`blue-pane-queue`). The session-title
 * terminal mirror (`blue-terminal-title`, the OSC 0 window title over the
 * upstream session-title fold), the consolidated `blue` settings namespace
 * (`blue-settings`), and the
 * boot-time update check (`blue-update-check`). All
 * registrations are effect-bound, so unloading the fiber reverts every
 * contribution.
 *
 * @module @dsh-blue/blue-interaction
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as approvalPlugin from './approval-plugin.ts'
import * as commandsPlugin from './commands-plugin.ts'
import { CommandModelService } from './command-model.ts'
import * as inputPlugin from './input-plugin.ts'
import * as keysPlugin from './keys.ts'
import * as providerOnboardingPlugin from './provider-onboarding.ts'
import * as questionsPlugin from './questions-plugin.ts'
import * as settingsPlugin from './settings.ts'
import * as terminalTitlePlugin from './terminal-title.ts'
import * as updateCheckPlugin from './updater/check.ts'
import { EditorModelService } from './editor-model.ts'
import { EditorHostService } from './editor-instance.ts'
import { SkillsCatalogService } from './skills-catalog.ts'
import { InteractionStateService } from './runtime-state.ts'
import { DEFAULT_SETTINGS } from './settings.ts'
import { registerInteractionLocale } from './locale.ts'

// BluePanel is the package's public overlay container; BlueSelect stays
// package-internal as the multi-select-only list (single-select moved to
// ctx.blueComponents.createSelectList) and is no longer exported.
export { BluePanel } from './select.ts'
export { CommandModelService } from './command-model.ts'
export { FrontendPanel } from './frontend-panel.ts'
export { EditorModelService } from './editor-model.ts'
export { EditorHostService } from './editor-instance.ts'
export { SkillsCatalogService } from './skills-catalog.ts'
export { InteractionStateService } from './runtime-state.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-interaction'
/** App-owned session boundaries required before child interaction fibers mount. */
export const inject = ['blueSessionReader', 'blueSessionActions', 'blueRequests', 'blueRetractions']

/** Interaction configuration; the override identifies acceptance profiles without changing the release line. */
export interface Config {
  /** Optional profile-local identity shown in version surfaces. */
  readonly displayVersion?: string
}

/** Interaction configuration schema. */
export const Config: z<Config> = z.object({
  displayVersion: z.string(),
})

/**
 * Mount the Blue interaction plugins. The key batch registers first; the
 * other plugins resolve their keys against it.
 * @param ctx - plugin context.
 * @param config - interaction presentation configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const localeRegistration = registerInteractionLocale(ctx)
  ctx.effect(() => localeRegistration)
  const runtimeState = new InteractionStateService(ctx, DEFAULT_SETTINGS)
  ctx.effect(() => () => runtimeState.dispose())
  const editorHost = new EditorHostService(ctx)
  ctx.effect(() => () => editorHost.dispose())
  const skillsCatalog = new SkillsCatalogService(ctx)
  ctx.effect(() => () => skillsCatalog.dispose())
  ctx.plugin(keysPlugin)
  ctx.plugin(CommandModelService)
  ctx.plugin(EditorModelService)
  ctx.plugin(commandsPlugin, config)
  ctx.plugin(inputPlugin)
  ctx.plugin(providerOnboardingPlugin)
  ctx.plugin(questionsPlugin)
  ctx.plugin(approvalPlugin)
  ctx.plugin(terminalTitlePlugin)
  ctx.plugin(settingsPlugin)
  ctx.plugin(updateCheckPlugin)
}
