/** Direct renderer-independent Cordis UI services for Blue.
 * @module @dsh-blue/blue-api
 */
import type { Context } from '@deepseek-ai/cordis'
import { BlueEditorExtensionService, BlueOverlayService, BluePaneService, BlueStatusService } from './services.ts'

export type * from './contracts.ts'
export { BlueEditorExtensionService, BlueOverlayService, BluePaneService, BlueStatusService } from './services.ts'

export const BLUE_API_VERSION = '2.0.0'
export const BLUE_VERSION = '0.2.0-alpha.1'
export const name = 'blue-api'

export function apply(ctx: Context): void {
  ctx.plugin(BluePaneService)
  ctx.plugin(BlueOverlayService)
  ctx.plugin(BlueStatusService)
  ctx.plugin(BlueEditorExtensionService)
}
