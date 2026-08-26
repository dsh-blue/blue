/**
 * @dsh-blue/blue-transcript — renderer adapter for the frontend runtime.
 * The official conversation plugin publishes a renderer-neutral transcript
 * model from the Harness projection; this plugin owns component
 * reconciliation, Ctrl-O expansion, settings, dock chrome, and the
 * StatusModel footer. It does not fold a Harness event log. Unloading removes
 * mounted components and keymap actions.
 *
 * @module @dsh-blue/blue-transcript
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  GutterComponent,
} from '@dsh-blue/blue-core'
// Empty type import carries the app-owned session reader/projection services.
import type {} from '@dsh-blue/blue-app'
// Carries the optional host `settings` service Context merge.
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { UserMessageImages } from './components.ts'
import { BlueStatusModelService, StatusModelFooterComponent } from './status-model.ts'
import { BlueDockModelService } from './dock-model.ts'
import { BlueModelToolService } from './tool-model.ts'
import { TranscriptModelService } from './transcript-model.ts'
import { SessionFactsService } from './session-facts.ts'
import {
  DEFAULT_EXPAND_TURNS,
  TranscriptPresentationPolicy,
} from './presentation-policy.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** New transcript content arrived while the user was scrolled away. */
    'blue/transcript-content-changed'(paused: boolean): void
  }
}

export {
  AssistantMessageComponent,
  StepSummaryComponent,
  TOOL_ARGUMENTS_MAX_CHARS,
  ToolCallComponent,
  USER_PREVIEW_LINES,
  UserMessageComponent,
} from './components.ts'
export { AgentGroupComponent, setAgentGroupTimers, type AgentGroupTimers } from './agent-group.ts'
export { BlueStatusModelService, StatusModelFooterComponent, plainView } from './status-model.ts'
export { SessionFactsService } from './session-facts.ts'
export { BlueDockModelService, ModelDockComponent } from './dock-model.ts'
export { createToolPresentationModel, toolCallView, toolResultView, BlueModelToolService, ToolModelComponent, ToolModelService } from './tool-model.ts'
export type { ToolPresentationFacts } from './tool-model.ts'
export { appendTranscriptView, createTranscriptModel, TRANSCRIPT_MODEL_WINDOW, TranscriptModelService, TranscriptModelComponent } from './transcript-model.ts'
export {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_INTERVAL_MS,
  MOON_SPINNER_FRAMES,
  MOON_SPINNER_INTERVAL_MS,
} from './spinners.ts'
export { ThinkingComponent, THINKING_PREVIEW_LINES } from './thinking.ts'
export type {
  TranscriptAssistantItem,
  TranscriptItem,
  TranscriptStepSummaryItem,
  TranscriptThinkingItem,
  TranscriptToolItem,
  TranscriptToolResult,
  TranscriptUserItem,
} from './types.ts'
export {
  DEFAULT_EXPAND_TURNS,
  DEFAULT_RECENT_STEPS_RETENTION,
  DEFAULT_TRANSCRIPT_PRESENTATION,
  DEFAULT_USER_FOLD_CHARS,
  DEFAULT_USER_FOLD_LINES,
  DEFAULT_WINDOW_TURNS,
  TranscriptPresentationPolicy,
} from './presentation-policy.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-transcript'

/** Services the plugin requires before it can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap', 'blueSessionReader', 'blueSessionProjections', 'tools']

/** The global action toggling tool-output expansion (Ctrl-O). */
export const ACTION_TOGGLE_COLLAPSE = 'blue.transcript.toggle-collapse'

/**
 * The Ctrl-O expansion range (kimi `TRANSCRIPT_EXPAND_TURNS`): only cards in
 * the most recent turns flip; older turns stay collapsed.
 */
export const EXPAND_TURNS = DEFAULT_EXPAND_TURNS

/** The plugin-wide expansion state forwarded to the semantic transcript model. */
interface CollapseToggle { expanded: boolean }
/**
 * Mount the renderer adapter and model footer. The official transcript
 * consumer owns projection binding; this fiber provides only the shared
 * model registry, dock chrome, settings, and global Ctrl-O expansion action.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const screen = ctx.blueScreen
  const colors = ctx.blueTheme.colors
  const toggle: CollapseToggle = { expanded: false }
  const presentation = new TranscriptPresentationPolicy()

  const BLUE_NS = 'blue' as SettingsNamespace
  presentation.apply(ctx.get('settings')?.get(BLUE_NS))

  // Optional image wiring is renderer-owned; the projected model carries only
  // durable references and the byte loader stays in this renderer adapter.
  const imageDependencies = (): UserMessageImages => {
    const attachments = ctx.get('attachments') as
      | { readImage(ref: unknown): Promise<{ data: Uint8Array }> }
      | undefined
    return attachments === undefined ? {} : {
      loadImage: async (ref: unknown) => {
        try {
          return (await attachments.readImage(ref)).data
        } catch {
          return undefined
        }
      },
      onReady: () => screen.requestRender(),
    }
  }

  const sessionFacts = new SessionFactsService(ctx)
  ctx.effect(() => () => sessionFacts.dispose())
  const statusModels = new BlueStatusModelService(ctx, screen)
  const dockModels = new BlueDockModelService(ctx)
  const toolModels = new BlueModelToolService(ctx)
  const transcriptModels = new TranscriptModelService(ctx, undefined, {
    renderer: {
      colors,
      components: ctx.blueComponents,
      images: imageDependencies,
      requestRender: () => screen.requestRender(),
      presentation,
    },
  })
  ctx.effect(() => () => statusModels.dispose())
  ctx.effect(() => () => dockModels.dispose())
  ctx.effect(() => () => toolModels.dispose())
  ctx.effect(() => () => transcriptModels.dispose())
  const footer = new StatusModelFooterComponent(statusModels, ctx.blueComponents, colors)
  dockModels.attach(screen)
  toolModels.attach(screen)
  transcriptModels.attach(screen)
  // The footer pins to the dock's lowest slot (S12): the two-row status
  // stays on the terminal's last rows beneath the editor, the kimi layout
  // dialog panels pull up over.
  ctx.effect(() => screen.addBottomChild(new GutterComponent(footer), 'bottom'))

  ctx.effect(() => ctx.blueKeymap.register([{
    id: ACTION_TOGGLE_COLLAPSE,
    keys: 'ctrl+o',
    description: 'Toggle detail expansion (tool output, long messages)',
    handler: () => {
      toggle.expanded = !toggle.expanded
      transcriptModels.setExpanded(toggle.expanded)
      screen.requestRender(true)
    },
  }]))

  // Blue settings ride the host settings document: the resolved `blue`
  // namespace (schema owned by interaction) carries the fold defaults
  // (`collapseThinking` / `collapseToolCalls`) and the transcript tunables
  // (`windowTurns` / `recentStepsRetention` / `expandTurns` /
  // `userFoldLines` / `userFoldChars`). The service is optional and its
  // value unknown here, so every read parses defensively — absent keys or
  // wrongly typed values keep the current setting; a host without settings
  // keeps every shipped default.
  const applyFoldSettings = (value: unknown): void => {
    if (presentation.apply(value)) transcriptModels.refreshPresentationPolicy()
  }
  ctx.on('settings/updated', (ns, next) => {
    if (ns === BLUE_NS) applyFoldSettings(next)
  })

}
