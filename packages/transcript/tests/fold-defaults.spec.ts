/**
 * Frontend-tree transcript presentation policy parsing and isolation.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRANSCRIPT_PRESENTATION,
  TranscriptPresentationPolicy,
} from '../src/presentation-policy.ts'

describe('transcript presentation policy', () => {
  it('starts with immutable shipped defaults', () => {
    const policy = new TranscriptPresentationPolicy()
    expect(policy.snapshot()).toBe(DEFAULT_TRANSCRIPT_PRESENTATION)
    expect(Object.isFrozen(policy.snapshot())).toBe(true)
  })

  it('applies booleans and positive integer tunables', () => {
    const policy = new TranscriptPresentationPolicy()
    expect(policy.apply({
      collapseThinking: false,
      collapseToolCalls: false,
      windowTurns: 5,
      recentStepsRetention: 20,
      expandTurns: 2,
      userFoldLines: 25,
      userFoldChars: 750,
    })).toBe(true)
    expect(policy.snapshot()).toEqual({
      thinkingExpanded: true,
      toolsExpanded: true,
      windowTurns: 5,
      recentStepsRetention: 20,
      expandTurns: 2,
      userFoldLines: 25,
      userFoldChars: 750,
    })
  })

  it('retains current values for missing and malformed fields', () => {
    const policy = new TranscriptPresentationPolicy()
    policy.apply({ windowTurns: 5, userFoldChars: 750 })
    expect(policy.apply(null)).toBe(false)
    expect(policy.apply({
      collapseThinking: 'yes', collapseToolCalls: 1,
      windowTurns: -3, recentStepsRetention: 1.5, expandTurns: 'many',
      userFoldLines: 0, userFoldChars: null,
    })).toBe(false)
    expect(policy.snapshot().windowTurns).toBe(5)
    expect(policy.snapshot().userFoldChars).toBe(750)
  })

  it('does not share updates between trees', () => {
    const first = new TranscriptPresentationPolicy()
    const second = new TranscriptPresentationPolicy()
    first.apply({ collapseThinking: false })
    expect(first.snapshot().thinkingExpanded).toBe(true)
    expect(second.snapshot().thinkingExpanded).toBe(false)
  })
})
