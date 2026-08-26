/**
 * `blue-questions` plugin: the UI provider for `ctx.userQuestions`. The
 * whole request — however many questions it carries — opens as a single
 * dialog panel hosting the tabbed `Questionnaire` component (see
 * `./questionnaire.ts`): every question must be answered before the
 * request resolves, Escape dismisses the whole request, and an aborted
 * request signal closes the panel and rejects. A single-question request
 * carrying the `plan-review` presentation intent (dsh-plan-mode's
 * `exit_plan_mode` ask) instead opens the dedicated `PlanReviewPanel`
 * (see `./plan-review-panel.ts`) — the markdown plan with the two
 * decision rows and the feedback editor; malformed intent asks fall
 * back to the generic questionnaire. The panel replaces the editor in
 * its dock slot (D30), so below it only the footer remains.
 * Registration is effect-bound, so HMR disposal unregisters the provider.
 *
 * @module @dsh-blue/blue-interaction/questions-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { mountEditorReplacement } from './editor-instance.ts'
import { PlanReviewPanel, planReviewChoices } from './plan-review-panel.ts'
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
 * Show one dialog for the request and settle with the collected answers;
 * dismissing or aborting the signal rejects.
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
    // The harness-wide dismissal code: dsh-plan-mode catches exactly
    // `ASK_CANCELLED` to tell the model the user dismissed the ask to
    // speak instead, and dsh-host-apiproxy rejects dismissal with the
    // same code — the earlier Blue-invented `ASK_DISMISSED` leaked the
    // raw rethrow instead (S24b correction).
    const onCancel = (): void => {
      settle(() => {
        reject(new UserQuestionError('ask_user_question was dismissed', 'ASK_CANCELLED'))
      })
    }
    const onAbort = (): void => {
      settle(() => {
        reject(new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED'))
      })
    }
    // A single-question plan-review ask with a well-formed option pair
    // takes the dedicated panel; everything else stays the questionnaire.
    const single = request.questions.length === 1 ? request.questions[0] : undefined
    const choices = single === undefined ? undefined : planReviewChoices(single)
    const panel = single !== undefined && choices !== undefined
      ? new PlanReviewPanel({
        theme: ctx.blueTheme,
        components: ctx.blueComponents,
        question: single,
        choices,
        // The plan window fills the viewport (round-3 ruling) — read live
        // so a resize re-fits the open panel.
        viewportRows: () => ctx.blueScreen.rows,
        onComplete: (answer) => {
          settle(() => {
            resolve({ answers: [answer] })
          })
        },
        onCancel,
      })
      : new Questionnaire({
        theme: ctx.blueTheme,
        components: ctx.blueComponents,
        questions: request.questions,
        onComplete: (answers) => {
          settle(() => {
            resolve({ answers })
          })
        },
        onCancel,
      })
    // The kimi dialog mount (D30): the panel replaces the editor in its
    // dock slot, so below it only the footer remains.
    const restore = mountEditorReplacement(ctx, panel)
    request.signal?.addEventListener('abort', onAbort, { once: true })
  })
}
