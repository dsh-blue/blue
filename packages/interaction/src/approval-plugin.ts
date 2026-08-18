/**
 * `blue-approval` plugin: the interactive answerer on the
 * `approval/request` waterfall. Requests for the agent currently attached
 * to the UI open a modal overlay (Allow once / Reject; Escape cancels; an
 * aborted request signal cancels). Requests for any other agent — and
 * requests arriving before a session attaches — delegate down the chain
 * with `next()`. Returning without `next()` short-circuits the waterfall
 * with the chosen outcome.
 *
 * @module @deepseek-ai/dsh-blue-interaction/approval-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { BluePanel, BlueSelect } from './select.ts'
import { currentBlueAgent } from './session.ts'
import { truncate } from './text.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-approval'
/** Services required before the answerer can listen. */
export const inject = ['blueScreen', 'blueTheme', 'blueKeymap']

/** Overlay width as a share of the terminal. */
const OVERLAY_WIDTH = '60%'

/**
 * Listen on the `approval/request` waterfall; the fiber's disposal removes
 * the listener.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.on('approval/request', (req, next) => answer(ctx, req, next))
}

/**
 * Answer one approval request interactively, or delegate when this UI does
 * not own the requesting agent.
 * @param ctx - plugin context carrying the Blue services.
 * @param req - the pending decision.
 * @param next - delegates to the remaining answerers.
 * @returns the chosen outcome.
 */
function answer(
  ctx: Context,
  req: ApprovalRequest,
  next: () => Promise<ApprovalOutcome>,
): Promise<ApprovalOutcome> {
  const agent = currentBlueAgent(ctx)
  if (agent === undefined || agent !== req.agent) return next()
  if (req.signal?.aborted) return Promise.resolve<ApprovalOutcome>('cancelled')
  return new Promise<ApprovalOutcome>((resolve) => {
    let settled = false
    const settle = (outcome: ApprovalOutcome): void => {
      if (settled) return
      settled = true
      req.signal?.removeEventListener('abort', onAbort)
      handle.hide()
      resolve(outcome)
    }
    const select = new BlueSelect({
      keymap: ctx.blueKeymap,
      theme: ctx.blueTheme,
      items: [
        { value: 'allow', label: 'Allow once', description: `run ${req.toolName} this time` },
        { value: 'reject', label: 'Reject', description: `do not run ${req.toolName}` },
      ],
      onConfirm: (items) => {
        settle(items[0]?.value === 'allow' ? 'allowed-once' : 'rejected')
      },
      onCancel: () => {
        settle('cancelled')
      },
    })
    const colors = ctx.blueTheme.colors
    const contentWidth = Math.max(1, Math.floor(ctx.blueScreen.columns * 0.6) - 2)
    const header = [
      colors.warning(truncate(`Approve ${req.toolName}?`, contentWidth)),
      ...req.reason === undefined ? [] : [colors.muted(truncate(req.reason, contentWidth))],
    ]
    const handle = ctx.blueScreen.showOverlay(new BluePanel(header, select), {
      width: OVERLAY_WIDTH,
      maxHeight: '40%',
    })
    const onAbort = (): void => {
      settle('cancelled')
    }
    req.signal?.addEventListener('abort', onAbort, { once: true })
  })
}
