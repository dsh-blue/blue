/**
 * Compact current-goal state in the Blue status footer.
 *
 * @module @dsh-blue/blue-transcript/status-goal
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import type { SessionFactsService } from './session-facts.ts'
import type { BlueStatusEntry } from './status-model.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-status-goal'

/** Native and Blue services required by the status contribution. */
export const inject = ['blueStatus', 'blueCurrentAgent', 'blueSessionFacts', 'goals']

/** Render the bounded goal summary shared by the live producer and tests. */
export function goalStatusText(goal: GoalView | undefined): string {
  if (goal === undefined) return ''
  return `Goal ${goal.phase} · ${String(goal.roundsStarted)}/${String(goal.maxGoalRounds)} · ${goal.activation}`
}

/** Register the direct status contribution. */
export function apply(ctx: Context): void {
  let text = ''
  let tone: 'accent' | 'success' | 'warning' | 'muted' = 'muted'
  const derive = (): void => {
    const agent = ctx.blueCurrentAgent.current()
    let goal: GoalView | undefined
    try {
      goal = agent === null ? undefined : ctx.goals.get(agent)
    } catch (error) {
      ctx.logger.warn(`could not read current goal for status: ${error instanceof Error ? error.message : String(error)}`)
    }
    const nextText = goalStatusText(goal)
    const nextTone = goal?.phase === 'active'
      ? 'accent'
      : goal?.phase === 'complete'
        ? 'success'
        : goal?.phase === 'blocked' || goal?.phase === 'paused'
          ? 'warning'
          : 'muted'
    if (nextText === text && nextTone === tone) return
    text = nextText
    tone = nextTone
    ctx.blueStatus.refresh('blue.status.goal')
  }
  const model = (): BlueStatusEntry => ({
    id: 'blue.status.goal',
    priority: 2,
    overflow: 'hide',
    node: { kind: 'text', content: text, tone },
    visible: text !== '',
  })
  ctx.blueStatus.register(model)
  const facts = ctx.get('blueSessionFacts') as SessionFactsService
  const offGoal = facts.subscribeGoal(() => derive())
  const offAgent = ctx.blueCurrentAgent.subscribe(() => derive())
  ctx.on('goal/changed', ({ agent }) => {
    if (agent === ctx.blueCurrentAgent.current()) derive()
  })
  ctx.on('agent/session-start', ({ agent }) => {
    if (agent === ctx.blueCurrentAgent.current()) derive()
  })
  ctx.effect(() => () => {
    offGoal()
    offAgent()
  })
}
