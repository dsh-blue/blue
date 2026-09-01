/** Current-Agent inbox pane contributed through Blue's public pane registry.
 * @module @dsh-blue/blue-interaction/pane-queue
 */

import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { BlueUiNode } from '@dsh-blue/blue-api'
import type {} from '@dsh-blue/blue-app'

export const name = 'blue-pane-queue'
export const inject = ['bluePanes', 'blueCurrentAgent']

function messageText(message: UserMessage): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join(' ')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

/** Register one ordinary bottom pane over the selected Agent's inbox. */
export function apply(ctx: Context): void {
  const render = (): BlueUiNode | null => {
    const agent = ctx.blueCurrentAgent.current()
    if (agent === null || !agent.inbox.hasPending) return null
    const rows = [
      ...agent.inbox.nextTurn.map(message => `queued / turn: ${messageText(message)}`),
      ...agent.inbox.nextStep.map(message => `queued / step: ${messageText(message)}`),
    ]
    return {
      kind: 'stack',
      direction: 'column',
      children: rows.map(content => ({ node: { kind: 'text', content, tone: 'muted' } })),
    }
  }
  const pane = ctx.bluePanes.register({
    id: 'blue.pane.queue',
    title: 'Queued messages',
    placement: 'bottom',
    priority: 20,
    narrow: 'bottom',
    render,
  })
  const refresh = (): void => pane.refresh()
  const offAgent = ctx.blueCurrentAgent.subscribe(refresh)
  const offInserted = ctx.on('agent/inbox/inserted', ({ agent }) => {
    if (agent === ctx.blueCurrentAgent.current()) refresh()
  })
  const offClaimed = ctx.on('agent/inbox/claimed', ({ agent }) => {
    if (agent === ctx.blueCurrentAgent.current()) refresh()
  })
  const offDiscarded = ctx.on('agent/inbox/discarded', ({ agent }) => {
    if (agent === ctx.blueCurrentAgent.current()) refresh()
  })
  ctx.effect(() => () => {
    offAgent()
    offInserted()
    offClaimed()
    offDiscarded()
    pane.dispose()
  })
}
