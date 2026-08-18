/**
 * The window policy: frontier math plus the module tunables' set/reset
 * semantics (tests must restore defaults so other specs stay deterministic).
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_WINDOW_TURNS,
  currentWindowTurns,
  isStepFoldingEnabled,
  setStepFoldingEnabled,
  setWindowTurns,
  windowEvictTurn,
} from '../src/window.ts'

afterEach(() => {
  setWindowTurns(undefined)
  setStepFoldingEnabled(undefined)
})

describe('windowEvictTurn', () => {
  it('returns undefined while within the limit', () => {
    expect(windowEvictTurn([1, 2, 3], 15)).toBeUndefined()
    expect(windowEvictTurn([], 15)).toBeUndefined()
  })

  it('returns the frontier just below the kept window', () => {
    expect(windowEvictTurn([1, 2, 3, 4], 2)).toBe(2)
    expect(windowEvictTurn([5, 6, 7, 8, 9], 3)).toBe(6)
  })

  it('clamps turns to at least one kept turn', () => {
    expect(windowEvictTurn([1, 2, 3], 0)).toBe(2)
    expect(windowEvictTurn([1, 2, 3], -5)).toBe(2)
  })

  it('keeps the exact boundary un-evicted', () => {
    // completed == keep + 1: exactly one turn (the oldest) evicts.
    expect(windowEvictTurn([1, 2, 3], 2)).toBe(1)
    expect(windowEvictTurn([1, 2, 3], 3)).toBeUndefined()
  })
})

describe('window tunables', () => {
  it('defaults to DEFAULT_WINDOW_TURNS', () => {
    expect(DEFAULT_WINDOW_TURNS).toBe(15)
    expect(currentWindowTurns()).toBe(15)
  })

  it('setWindowTurns replaces and undefined restores the default', () => {
    setWindowTurns(3)
    expect(currentWindowTurns()).toBe(3)
    setWindowTurns(undefined)
    expect(currentWindowTurns()).toBe(15)
  })

  it('setStepFoldingEnabled toggles and undefined restores on', () => {
    expect(isStepFoldingEnabled()).toBe(true)
    setStepFoldingEnabled(false)
    expect(isStepFoldingEnabled()).toBe(false)
    setStepFoldingEnabled(undefined)
    expect(isStepFoldingEnabled()).toBe(true)
  })
})
