/**
 * @deepseek-ai/dsh-blue-transcript — Blue terminal UI transcript layer. On
 * `'blue/session-changed'` (emitted by `@deepseek-ai/dsh-blue-app` after
 * create/resume) the plugin first folds the `agent.session.events` snapshot
 * — resume seeds do not replay `session/event` — then subscribes to the live
 * feed, dropping events at or below the snapshot's last seq. Every applied
 * branch ends in `blueScreen.requestRender()`. Unloading the plugin unmounts
 * every mounted component.
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
  StatusBarComponent,
  ToolCallComponent,
  UserMessageComponent,
} from './components.ts'
import { TranscriptFolder, type FoldUpdate } from './fold.ts'

export type { FoldUpdate } from './fold.ts'
export { ellipsize, foldSessionEvents, RESULT_SUMMARY_MAX_CHARS, TranscriptFolder } from './fold.ts'
export {
  AssistantMessageComponent,
  StatusBarComponent,
  TOOL_ARGUMENTS_MAX_CHARS,
  ToolCallComponent,
  UserMessageComponent,
} from './components.ts'
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
export const inject = ['blueScreen', 'blueTheme', 'blueComponents']

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
 * Mount one agent's transcript: status bar, snapshot fold, then the live
 * `session/event` subscription. Returns the disposer unmounting everything
 * this session mounted.
 */
function mountSession(ctx: Context, screen: BlueScreen, colors: BlueSemanticColors, agent: Agent): () => void {
  const components = ctx.blueComponents
  const disposers: (() => void)[] = []
  const folder = new TranscriptFolder()

  const statusBar = new StatusBarComponent(colors, components)
  statusBar.update(agent)
  disposers.push(screen.addChild(statusBar))

  const present = (update: FoldUpdate | null): void => {
    if (update?.isNew) disposers.push(screen.addChild(createComponent(update.item, colors, components)))
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
    statusBar.update(agent)
    present(folder.apply(event))
    screen.requestRender()
  }))

  screen.requestRender(true)
  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}

/**
 * Mount the transcript renderer. Renders `blueSession.current` when an agent
 * already exists at load time, then remounts on every
 * `'blue/session-changed'`.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const screen = ctx.blueScreen
  const colors = ctx.blueTheme.colors

  let unmount: (() => void) | null = null
  ctx.on('blue/session-changed', (agent) => {
    unmount?.()
    unmount = mountSession(ctx, screen, colors, agent)
  })
  ctx.effect(() => () => unmount?.())

  const current = ctx.get('blueSession')?.current
  if (current) {
    unmount = mountSession(ctx, screen, colors, current)
  }
}
