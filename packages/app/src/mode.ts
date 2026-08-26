/**
 * App-owned persistence fold for Blue's yolo session mode. Harness event
 * values stay inside blue-app; interaction consumers see only mode snapshots.
 *
 * @module @dsh-blue/blue-app/mode
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Fold yolo state from durable command records.
 * @param events - the active session event snapshot.
 * @returns whether the newest recorded yolo command enables auto-approval.
 */
export function foldYolo(events: readonly SessionEvent[]): boolean {
  let active = false
  for (const event of events) {
    if (event.type !== 'command/run') continue
    const { name, args } = event.data
    if (name !== 'yolo' || args === undefined) continue
    active = args.trim() !== 'off'
  }
  return active
}
