/**
 * `blue-questions` plugin: the UI provider for `ctx.userQuestions`. The
 * whole request — however many questions it carries — opens as a single
 * dialog panel hosting the tabbed `Questionnaire` component (see
 * `./questionnaire.ts`): every question must be answered before the
 * request resolves, Escape dismisses the whole request, and an aborted
 * request signal closes the panel and rejects. The panel replaces the
 * editor in its dock slot (D30), so below it only the footer remains.
 * Registration is effect-bound, so HMR disposal unregisters the provider.
 *
 * @module @dsh-blue/blue-interaction/questions-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { mountEditorReplacement } from './editor-instance.ts'
import { Questionnaire } from './questionnaire.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-questions'
/** Services required before the provider can register. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'userQuestions']

/**
 * Register the overlay-backed user-questions provider; the fiber's disposal
 * unregisters it.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.userQuestions.registerProvider({
    ask: request => askAll(ctx, request),
  }))
}

/**
 * Show one questionnaire overlay for the whole request and settle with the
 * collected answers; dismissing or aborting the signal rejects.
 * @param ctx - plugin context carrying the Blue services.
 * @param request - the questions and their abort signal.
 * @returns the collected answers, in question order.
 */
function askAll(ctx: Context, request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
  // No pre-abort check here: `UserQuestionService.ask` verifies the signal
  // synchronously before invoking the provider, so only the listener path
  // below can observe an abort.
  return new Promise<AskUserQuestionAnswer>((resolve, reject) => {
    let settled = false
    const settle = (complete: () => void): void => {
      if (settled) return
      settled = true
      request.signal?.removeEventListener('abort', onAbort)
      restore()
      complete()
    }
    const questionnaire = new Questionnaire({
      theme: ctx.blueTheme,
      components: ctx.blueComponents,
      questions: request.questions,
      onComplete: (answers) => {
        settle(() => {
          resolve({ answers })
        })
      },
      onCancel: () => {
        settle(() => {
          reject(new UserQuestionError('ask_user_question was dismissed', 'ASK_DISMISSED'))
        })
      },
    })
    // The kimi dialog mount (D30): the questionnaire replaces the editor in
    // its dock slot, so below it only the footer remains.
    const restore = mountEditorReplacement(questionnaire)
    const onAbort = (): void => {
      settle(() => {
        reject(new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED'))
      })
    }
    request.signal?.addEventListener('abort', onAbort, { once: true })
  })
}
