/**
 * @deepseek-ai/dsh-blue-transcript — Blue terminal UI transcript layer. On
 * `'blue/session-changed'` (emitted by `@deepseek-ai/dsh-blue-app` after
 * create/resume) the plugin first folds the `agent.session.events` snapshot
 * — resume seeds do not replay `session/event` — then subscribes to the live
 * feed, dropping events at or below the snapshot's last seq. Every applied
 * branch ends in `blueScreen.requestRender()`. A global `ctrl+o` keymap
 * action (`blue.transcript.toggle-collapse`) toggles tool-call components
 * between the one-line result summary and the full output. The plugin also
 * owns the status line's extension seam: it provides the `blueStatus`
 * registry and mounts the persistent two-row footer shell bottom-pinned
 * above the input editor; the entries themselves ship as the `status-basic`
 * / `status-git` / `status-context` subpath plugins so the composing bundle
 * lists them as its own patch rows. Unloading the plugin unmounts every
 * mounted component, the footer included, and unregisters the action.
 *
 * @module @deepseek-ai/dsh-blue-transcript
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  BlueComponent,
  BlueComponents,
  BlueScreen,
  BlueSemanticColors,
} from '@deepseek-ai/dsh-blue-core'
// Empty type import carries the app-owned `blueSession` Context merge and the
// `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@deepseek-ai/dsh-blue-app'
import {
  AssistantMessageComponent,
  ToolCallComponent,
  UserMessageComponent,
} from './components.ts'
import { TranscriptFolder, type FoldUpdate } from './fold.ts'
import { BlueStatusService, FooterShellComponent } from './status.ts'

export type { FoldUpdate } from './fold.ts'
export { ellipsize, foldSessionEvents, RESULT_SUMMARY_MAX_CHARS, TranscriptFolder } from './fold.ts'
export {
  AssistantMessageComponent,
  TOOL_ARGUMENTS_MAX_CHARS,
  ToolCallComponent,
  UserMessageComponent,
} from './components.ts'
export { BlueStatusError, BlueStatusService, FOOTER_MAX_ROWS, FooterShellComponent } from './status.ts'
export type { BlueStatus, BlueStatusEntry } from './types.ts'
export type {
  TranscriptAssistantItem,
  TranscriptItem,
  TranscriptToolItem,
  TranscriptToolResult,
  TranscriptUserItem,
} from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-transcript'

/** Services the plugin requires before it can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap']

/** The global action toggling tool-output expansion (Ctrl-O). */
export const ACTION_TOGGLE_COLLAPSE = 'blue.transcript.toggle-collapse'

/**
 * The plugin-wide expansion toggle state plus the live session's tool-call
 * components the toggle re-renders. `expanded` resets to collapsed and the
 * collection empties whenever the mounted session unmounts.
 */
interface CollapseToggle {
  expanded: boolean
  components: Set<ToolCallComponent>
}

/** Create the component rendering one folded item. */
function createComponent(
  item: FoldUpdate['item'],
  colors: BlueSemanticColors,
  components: BlueComponents,
): BlueComponent {
  switch (item.kind) {
    case 'user':
      return new UserMessageComponent(item, colors, components)
    case 'assistant':
      return new AssistantMessageComponent(item, colors, components)
    case 'tool':
      return new ToolCallComponent(item, colors, components)
  }
}

/**
 * Mount one agent's transcript: snapshot fold, then the live `session/event`
 * subscription. Tool-call components (snapshot and live alike) join
 * `toggle.components` so the Ctrl-O handler reaches them. Returns the
 * disposer unmounting everything this session mounted and resetting the
 * toggle to its collapsed default.
 */
function mountSession(
  ctx: Context,
  screen: BlueScreen,
  colors: BlueSemanticColors,
  agent: Agent,
  toggle: CollapseToggle,
): () => void {
  const components = ctx.blueComponents
  const disposers: (() => void)[] = []
  const folder = new TranscriptFolder()

  const present = (update: FoldUpdate | null): void => {
    if (!update?.isNew) return
    const component = createComponent(update.item, colors, components)
    if (component instanceof ToolCallComponent) {
      component.setExpanded(toggle.expanded)
      toggle.components.add(component)
    }
    disposers.push(screen.addChild(component))
  }

  // Snapshot first: resume seeds never replay session/event, so history
  // renders from agent.session.events; the subscription below then carries
  // only newer seqs. Both happen in one synchronous turn, so no committed
  // event can fall between them.
  let lastSeq = -1
  for (const event of agent.session.events) {
    lastSeq = Math.max(lastSeq, event.seq)
    present(folder.apply(event))
  }

  disposers.push(ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (event.seq <= lastSeq) return
    lastSeq = event.seq
    present(folder.apply(event))
    screen.requestRender()
  }))

  screen.requestRender(true)
  return () => {
    toggle.expanded = false
    toggle.components.clear()
    for (const dispose of disposers.splice(0)) dispose()
  }
}

/**
 * Mount the transcript renderer. Renders `blueSession.current` when an agent
 * already exists at load time, then remounts on every
 * `'blue/session-changed'`. Also provides the `blueStatus` registry and
 * mounts the footer shell once, bottom-pinned (the transcript patch row
 * precedes the interaction row, so the footer lands right above the input
 * editor); entry plugins register into it independently of session mounts.
 * Finally registers the global Ctrl-O action whose handler flips tool-output
 * expansion for the mounted session's tool calls.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const screen = ctx.blueScreen
  const colors = ctx.blueTheme.colors
  const toggle: CollapseToggle = { expanded: false, components: new Set() }

  const status = new BlueStatusService(ctx, screen)
  const footer = new FooterShellComponent(status, colors, ctx.blueComponents)
  status.attach(footer)
  ctx.effect(() => screen.addBottomChild(footer))

  ctx.effect(() => ctx.blueKeymap.register([{
    id: ACTION_TOGGLE_COLLAPSE,
    keys: 'ctrl+o',
    description: 'Toggle tool output expansion',
    handler: () => {
      toggle.expanded = !toggle.expanded
      for (const component of toggle.components) component.setExpanded(toggle.expanded)
      screen.requestRender(true)
    },
  }]))

  let unmount: (() => void) | null = null
  ctx.on('blue/session-changed', (agent) => {
    unmount?.()
    unmount = mountSession(ctx, screen, colors, agent, toggle)
  })
  ctx.effect(() => () => unmount?.())

  const current = ctx.get('blueSession')?.current
  if (current) {
    unmount = mountSession(ctx, screen, colors, current, toggle)
  }
}
