/**
 * Capturing overlay example opened only from a Blue-owned user dispatch.
 *
 * @module @dsh-blue-example/overlay
 */
import type { Context } from '@deepseek-ai/cordis'
import type { BlueOverlayRequest, BlueResult } from '@dsh-blue/blue-api'
import type {} from '@dsh-blue/blue-api'
import { ui } from '@dsh-blue/blue-ui'

export const name = '@dsh-blue-example/overlay'
export const inject = ['bluePluginHost']

/** Static request reused by the command and packed fixture. */
export const overlayRequest: BlueOverlayRequest = {
  id: 'example.overlay.details',
  title: 'Example details',
  capturing: true,
  dismissible: true,
  anchor: 'center',
  width: '70%',
  maxHeight: '70%',
  render: () => ui.surface({
    chrome: 'overlay',
    padding: 1,
    child: ui.stack.column([
      ui.text('This modal was opened by an explicit Blue user gesture.'),
      ui.text('Escape returns focus to the previous surface.', { tone: 'muted' }),
    ], { gap: 1 }),
  }),
}

/** Register a command whose owner-minted gesture authorizes the modal. */
export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, { id: name, api: '^1.0.0', capabilities: ['commands', 'overlays'] })
  if (!opened.ok) return
  const api = opened.value
  api.commands!.register({
    id: 'example-overlay',
    label: 'Open the example overlay',
    execute: async (_args, options): Promise<BlueResult> => {
      if (options?.userGesture === undefined) {
        return { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'the overlay requires an active user gesture' }
      }
      const result = api.overlays!.open(overlayRequest, { userGesture: options.userGesture })
      return result.ok ? { ok: true, value: undefined } : result
    },
  })
}
