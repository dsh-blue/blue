/** The three-tier model-selection reference: pick, logged header, process default. */

import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createModelSelectionRef } from '../src/model-ref.ts'

/** The fake default-model tier; a spy so the tests can see the fallback reads. */
function defaults(selection = { provider: 'test-provider', model: 'test-model' }) {
  return { currentSelection: vi.fn(() => selection) }
}

/** A fake Agent whose session answers `requestHeader()` with the given config (or none). */
function fakeAgent(config?: { provider: string, model: string, reasoningEffort?: string }): Agent {
  return {
    session: { requestHeader: () => (config === undefined ? undefined : { config }) },
  } as unknown as Agent
}

describe('createModelSelectionRef', () => {
  it('reads the process default when no pick and no header exist', () => {
    const tier = defaults()
    const ref = createModelSelectionRef(fakeAgent(), tier)
    expect(ref.current).toEqual({ provider: 'test-provider', model: 'test-model' })
    expect(tier.currentSelection).toHaveBeenCalledTimes(1)
  })

  it('reads the logged header tier, projecting the effort only when present', () => {
    const tier = defaults()
    const withEffort = createModelSelectionRef(
      fakeAgent({ provider: 'mock', model: 'mock-pro', reasoningEffort: 'high' }),
      tier,
    )
    expect(withEffort.current).toEqual({ provider: 'mock', model: 'mock-pro', reasoningEffort: 'high' })
    const withoutEffort = createModelSelectionRef(fakeAgent({ provider: 'mock', model: 'mock' }), tier)
    expect(withoutEffort.current).toEqual({ provider: 'mock', model: 'mock' })
    expect('reasoningEffort' in withoutEffort.current).toBe(false)
    // The header tier answers without touching the default tier.
    expect(tier.currentSelection).not.toHaveBeenCalled()
  })

  it('lets a pick override the header until a new pick replaces it', () => {
    const ref = createModelSelectionRef(
      fakeAgent({ provider: 'mock', model: 'mock', reasoningEffort: 'low' }),
      defaults(),
    )
    ref.current = { provider: 'mock', model: 'mock-pro' }
    expect(ref.current).toEqual({ provider: 'mock', model: 'mock-pro' })
    ref.current = { provider: 'other', model: 'm2', reasoningEffort: 'high' }
    expect(ref.current).toEqual({ provider: 'other', model: 'm2', reasoningEffort: 'high' })
  })

  it('starts with no assembled snapshot', () => {
    const ref = createModelSelectionRef(fakeAgent(), defaults())
    expect(ref.assembled).toBeUndefined()
  })
})
