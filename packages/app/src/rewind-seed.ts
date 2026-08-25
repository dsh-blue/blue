/**
 * Pure validation for event prefixes used by Blue's safe rewind branch.
 * Kept internal to blue-app: dsh's Agent factory remains the authoritative
 * publication-time validator.
 *
 * @module @dsh-blue/blue-app/rewind-seed
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Check that a rewind seed ends at a durable, balanced event boundary.
 * @param events - the active session's immutable event snapshot.
 * @param boundary - number of events to retain.
 * @returns whether the prefix contains no open turn, step, or tool call.
 */
export function isBalancedRewindSeed(events: readonly SessionEvent[], boundary: number): boolean {
  if (!Number.isSafeInteger(boundary) || boundary < 0 || boundary > events.length) return false
  let turns = 0
  let steps = 0
  const calls = new Set<string>()
  for (const event of events.slice(0, boundary)) {
    if (event.type === 'turn/start') turns += 1
    else if (event.type === 'turn/end') {
      turns -= 1
      if (turns < 0) return false
    } else if (event.type === 'step/start') steps += 1
    else if (event.type === 'step/end') {
      steps -= 1
      if (steps < 0) return false
    } else if (event.type === 'tool/call') {
      calls.add(String(event.data.callId))
    } else if (event.type === 'tool/result') {
      const block = event.data.message.content[0]
      if (block?.type === 'tool-result') calls.delete(String(block.toolCallId))
    }
  }
  return turns === 0 && steps === 0 && calls.size === 0
}
