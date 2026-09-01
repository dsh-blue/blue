/**
 * Capturing overlay example opened only from a Blue-owned user dispatch.
 *
 * @module @dsh-blue-example/overlay
 */
import type { Context } from '@deepseek-ai/cordis'
import type { BlueOverlayRequest } from '@dsh-blue/blue-api'
import type {} from '@deepseek-ai/dsh-commands'
import { ui } from '@dsh-blue/blue-ui'

export const name = '@dsh-blue-example/overlay'
export const inject = ['commands', 'blueOverlays']

/** Static request reused by the command and packed fixture. */
export const overlayRequest: BlueOverlayRequest = {
  id: 'example.overlay.details',
  title: 'Example details',
  capturing: true,
  dismissible: true,
  anchor: 'center',
  width: '70%',
  maxHeight: '70%',
  render: () => ui.stack.column([
    ui.text('Opened by an explicit Blue user gesture.'),
    ui.text('Escape returns focus to the previous surface.', { tone: 'muted' }),
  ], { gap: 1 }),
}

/** Register a regular dsh command that opens the direct Blue overlay. */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'example-overlay',
    description: 'Open the example overlay',
    handler: () => {
      ctx.blueOverlays.close(overlayRequest.id)
      ctx.blueOverlays.open(overlayRequest)
      return { kind: 'success', text: 'opened the example overlay' }
    },
  })
}
