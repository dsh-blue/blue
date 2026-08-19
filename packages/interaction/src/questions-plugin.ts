/**
 * `blue-questions` plugin: the UI provider for `ctx.userQuestions`. The
 * whole request — however many questions it carries — opens as a single
 * modal overlay hosting the tabbed `Questionnaire` component (see
 * `./questionnaire.ts`): every question must be answered before the
 * request resolves, Escape dismisses the whole request, and an aborted
 * request signal closes the overlay and rejects. Registration is
 * effect-bound, so HMR disposal unregisters the provider.
 *
 * @module @deepseek-ai/dsh-blue-interaction/questions-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { Questionnaire } from './questionnaire.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-questions'
/** Services required before the provider can register. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'userQuestions']

/** Overlay width as a share of the terminal. */
const OVERLAY_WIDTH = '80%'
/**
 * Overlay height bound as a share of the terminal. S12 raises the bound so
 * the framed dialog (bars, title, tabs, question, six option rows, key
 * row) fits inside its budget — pi-tui slices overlay output past
 * maxHeight.
 */
const OVERLAY_MAX_HEIGHT = '75%'

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
      handle.hide()
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
    const handle = ctx.blueScreen.showOverlay(questionnaire, {
      width: OVERLAY_WIDTH,
      maxHeight: OVERLAY_MAX_HEIGHT,
    })
    const onAbort = (): void => {
      settle(() => {
        reject(new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED'))
      })
    }
    request.signal?.addEventListener('abort', onAbort, { once: true })
  })
}
