/**
 * Renderer-neutral baseline model footer row. The producer reads the current
 * app session snapshot and official conversation facts; the renderer owns
 * styling and width handling.
 *
 * @module @dsh-blue/blue-transcript/status-basic-model
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dsh-blue/blue-app'
import type { StatusModel } from '@dsh-blue/blue-frontend'
import type { ConversationFacts } from '@dsh-blue/blue-conversation'
import type { SessionFactsService } from './session-facts.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-status-basic-model'
/** Services required before the baseline model can register. */
export const inject = ['blueStatusModels', 'blueSessionFacts']

/** Register the baseline model row. */
export function apply(ctx: Context): void {
  const factsService = ctx.get('blueSessionFacts') as SessionFactsService
  let facts: ConversationFacts = factsService.current
  let session = factsService.currentSession
  let text = ''
  const derive = (): void => {
    text = session?.model?.id
      ?? facts.model
      ?? facts.provider
      ?? (session === null ? '' : 'no model')
  }
  derive()
  const model = (): StatusModel => ({ kind: 'status', id: 'blue.status.basic', priority: 0, view: { kind: 'text', text, tone: 'default' }, visible: text !== '' })
  const refresh = (): void => { derive(); ctx.blueStatusModels.refresh('blue.status.basic') }
  const offFacts = factsService.subscribe(next => { facts = next; refresh() })
  const offSession = factsService.subscribeSession(next => { session = next; refresh() })
  ctx.effect(() => () => offFacts())
  ctx.effect(() => () => offSession())
  ctx.effect(() => ctx.blueStatusModels.register(model))
}
