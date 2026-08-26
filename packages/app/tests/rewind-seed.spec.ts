/** Tests for safe rewind seed validation. */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { isBalancedRewindSeed } from '../src/rewind-seed.ts'

const event = (type: string, data: unknown = {}): SessionEvent =>
  ({ type, data } as unknown as SessionEvent)

describe('isBalancedRewindSeed', () => {
  it('rejects invalid numeric boundaries', () => {
    expect(isBalancedRewindSeed([], -1)).toBe(false)
    expect(isBalancedRewindSeed([], 1)).toBe(false)
    expect(isBalancedRewindSeed([], 0.5)).toBe(false)
  })

  it('accepts empty and balanced turn/step prefixes', () => {
    expect(isBalancedRewindSeed([], 0)).toBe(true)
    const events = [
      event('turn/start'),
      event('step/start'),
      event('step/end'),
      event('turn/end'),
    ]
    expect(isBalancedRewindSeed(events, events.length)).toBe(true)
    expect(isBalancedRewindSeed(events, 1)).toBe(false)
  })

  it('rejects closing brackets without matching openings', () => {
    expect(isBalancedRewindSeed([event('turn/end')], 1)).toBe(false)
    expect(isBalancedRewindSeed([event('step/end')], 1)).toBe(false)
  })

  it('tracks tool calls and matching tool-result blocks', () => {
    const call = event('tool/call', { callId: 'call-1' })
    const unrelated = event('tool/result', { message: { content: [{ type: 'text', text: 'x' }] } })
    const result = event('tool/result', {
      message: { content: [{ type: 'tool-result', toolCallId: 'call-1', content: [] }] },
    })
    expect(isBalancedRewindSeed([call], 1)).toBe(false)
    expect(isBalancedRewindSeed([call, unrelated], 2)).toBe(false)
    expect(isBalancedRewindSeed([call, result], 2)).toBe(true)
  })
})
