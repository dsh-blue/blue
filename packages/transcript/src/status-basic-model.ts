import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@dsh-blue/blue-app'
import type { StatusModel } from '@dsh-blue/blue-frontend'

export const name = 'blue-status-basic-model'
export const inject = ['blueStatusModels']

export function apply(ctx: Context): void {
  let agent: Agent | undefined = ctx.get('blueSession')?.current ?? undefined
  let text = ''
  const derive = (): void => {
    if (agent === undefined) { text = ''; return }
    const selection = ctx.get('blueSession')?.modelRef?.current
    text = selection?.model ?? agent.session.requestHeader()?.config.model ?? agent.options.model ?? agent.options.provider ?? 'no model'
  }
  derive()
  const model = (): StatusModel => ({ kind: 'status', id: 'blue.status.basic', priority: 0, view: { kind: 'text', text, tone: 'default' }, visible: text !== '' })
  const refresh = (): void => { derive(); ctx.blueStatusModels.refresh('blue.status.basic') }
  ctx.on('blue/session-changed', next => { agent = next; refresh() })
  ctx.on('blue/model-changed', refresh)
  ctx.on('session/event', (session) => { if (agent !== undefined && session === agent.session) refresh() })
  ctx.effect(() => ctx.blueStatusModels.register(model))
}
