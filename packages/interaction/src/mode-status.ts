/** Session-mode status contribution backed by native dsh state.
 * @module @dsh-blue/blue-interaction/mode-status
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@dsh-blue/blue-app'
import type {} from '@dsh-blue/blue-api'
import { sessionModeSnapshot } from './mode-commands.ts'

export const name = 'blue-status-mode'
export const inject = ['blueStatus', 'blueCurrentAgent', 'sessionProjections']

/** Register the current Agent's plan/yolo badge. */
export function apply(ctx: Context): void {
  const model = () => {
    const agent = ctx.blueCurrentAgent.current()
    const state = agent === null ? undefined : sessionModeSnapshot(ctx, agent)
    const text = state?.mode === 'yolo'
      ? 'yolo'
      : state?.mode === 'plan' ? state.plan?.pending === true ? 'plan...' : 'plan' : ''
    return {
      id: 'blue.status.mode',
      priority: 2,
      node: { kind: 'text' as const, content: text, tone: text === 'yolo' ? 'warning' as const : 'accent' as const },
      visible: text !== '',
    }
  }
  const registration = ctx.blueStatus.register(model)
  const refresh = (): void => registration.refresh()
  const offAgent = ctx.blueCurrentAgent.subscribe(refresh)
  const offSession = ctx.on('session/event', (session) => {
    if (session === ctx.blueCurrentAgent.current()?.session) refresh()
  })
  ctx.effect(() => () => {
    offAgent()
    offSession()
    registration.dispose()
  })
}
