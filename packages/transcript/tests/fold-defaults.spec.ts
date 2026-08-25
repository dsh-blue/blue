/**
 * The per-category expansion defaults: shipped collapsed defaults, partial
 * merge semantics of the setter, and the undefined reset (specs must restore
 * the defaults so other suites stay deterministic — the window.spec pattern).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { defaultExpansion, setDefaultExpansion } from '../src/fold-defaults.ts'

afterEach(() => {
  setDefaultExpansion(undefined)
})

describe('fold defaults', () => {
  it('collapses both categories by default', () => {
    expect(defaultExpansion('thinking')).toBe(false)
    expect(defaultExpansion('tools')).toBe(false)
  })

  it('merges partial updates, keeping untouched categories', () => {
    setDefaultExpansion({ tools: true })
    expect(defaultExpansion('tools')).toBe(true)
    expect(defaultExpansion('thinking')).toBe(false)

    setDefaultExpansion({ thinking: true })
    expect(defaultExpansion('thinking')).toBe(true)
    expect(defaultExpansion('tools')).toBe(true)

    setDefaultExpansion({ tools: false })
    expect(defaultExpansion('tools')).toBe(false)
    expect(defaultExpansion('thinking')).toBe(true)
  })

  it('restores both shipped defaults on undefined', () => {
    setDefaultExpansion({ thinking: true, tools: true })
    setDefaultExpansion(undefined)
    expect(defaultExpansion('thinking')).toBe(false)
    expect(defaultExpansion('tools')).toBe(false)
  })
})
