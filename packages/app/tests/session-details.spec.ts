/** Branch coverage for the app-owned renderer-neutral session details snapshot. */

import { describe, expect, it } from 'vitest'
import { sessionDetails } from '../src/session-details.ts'

describe('sessionDetails header fallbacks', () => {
  it('prefers a session header id and normalizes a non-numeric creation time', () => {
    const details = sessionDetails({
      id: 'agent-id',
      status: 'idle',
      session: {
        header: { id: 'header-id', createdAt: 'unknown' as never },
        events: [],
        requestContext: () => undefined,
      },
    }, undefined, undefined)
    expect(details.header).toEqual({ id: 'header-id', createdAt: 0 })
  })

  it('falls back to the Agent id when the session header has none', () => {
    const details = sessionDetails({
      id: 'agent-id',
      status: 'idle',
      session: { header: {}, events: [], requestContext: () => undefined },
    }, undefined, undefined)
    expect(details.header.id).toBe('agent-id')
  })
})
