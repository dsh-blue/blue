/**
 * `ctx.blueKeymap` service: registration and disposal on the fiber, key
 * matching, and registration-time conflict detection.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { BlueKeymapError, BlueKeymapService } from '../src/keymap.ts'

describe('BlueKeymapService', () => {
  it('registers as ctx.blueKeymap and unregisters when the fiber disposes', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(BlueKeymapService)
    await fiber
    expect(ctx.get('blueKeymap')).toBeInstanceOf(BlueKeymapService)
    await fiber.dispose()
    expect(ctx.get('blueKeymap')).toBeUndefined()
  })

  it('matches input sequences against registered keys', async () => {
    const ctx = new Context()
    await ctx.plugin(BlueKeymapService)
    const keymap = ctx.blueKeymap
    keymap.register([{ id: 'blue.app.quit', keys: ['ctrl+c', 'ctrl+d'], description: 'Quit' }])

    expect(keymap.matches('\x03', 'blue.app.quit')).toBe(true)
    expect(keymap.matches('\x04', 'blue.app.quit')).toBe(true)
    expect(keymap.matches('\r', 'blue.app.quit')).toBe(false)
    expect(keymap.getKeys('blue.app.quit')).toEqual(['ctrl+c', 'ctrl+d'])
  })

  it('accepts a single string key and never matches unknown actions', async () => {
    const ctx = new Context()
    await ctx.plugin(BlueKeymapService)
    const keymap = ctx.blueKeymap
    keymap.register([{ id: 'blue.input.submit', keys: 'enter' }])

    expect(keymap.matches('\r', 'blue.input.submit')).toBe(true)
    expect(keymap.matches('\r', 'blue.input.nope')).toBe(false)
    expect(keymap.getKeys('blue.input.nope')).toEqual([])
  })

  it('dedupes repeated keys within one action', async () => {
    const ctx = new Context()
    await ctx.plugin(BlueKeymapService)
    const keymap = ctx.blueKeymap
    keymap.register([{ id: 'blue.app.quit', keys: ['ctrl+c', 'ctrl+c'] }])
    expect(keymap.getKeys('blue.app.quit')).toEqual(['ctrl+c'])
  })

  it('rejects a key already claimed by another registered action', async () => {
    const ctx = new Context()
    await ctx.plugin(BlueKeymapService)
    const keymap = ctx.blueKeymap
    keymap.register([{ id: 'blue.app.quit', keys: 'ctrl+c' }])

    expect(() => keymap.register([{ id: 'blue.app.interrupt', keys: 'ctrl+c' }]))
      .toThrow(BlueKeymapError)
    expect(() => keymap.register([{ id: 'blue.app.interrupt', keys: 'ctrl+c' }]))
      .toThrow(/"ctrl\+c" is claimed by both "blue\.app\.quit" and "blue\.app\.interrupt"/)
    // The rejected registration committed nothing.
    expect(keymap.matches('\x03', 'blue.app.interrupt')).toBe(false)
  })

  it('rejects conflicting claims inside one batch without committing any', async () => {
    const ctx = new Context()
    await ctx.plugin(BlueKeymapService)
    const keymap = ctx.blueKeymap

    let caught: unknown
    try {
      keymap.register([
        { id: 'blue.a', keys: 'ctrl+x' },
        { id: 'blue.b', keys: 'ctrl+x' },
      ])
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(BlueKeymapError)
    expect((caught as BlueKeymapError).code).toBe('KEY_CONFLICT')
    expect(keymap.getKeys('blue.a')).toEqual([])
    expect(keymap.getKeys('blue.b')).toEqual([])
  })

  it('rejects duplicate action ids', async () => {
    const ctx = new Context()
    await ctx.plugin(BlueKeymapService)
    const keymap = ctx.blueKeymap
    keymap.register([{ id: 'blue.app.quit', keys: 'ctrl+c' }])

    expect(() => keymap.register([{ id: 'blue.app.quit', keys: 'ctrl+q' }]))
      .toThrow(/"blue\.app\.quit" is already registered/)
    expect(() => keymap.register([
      { id: 'blue.dup', keys: 'f1' },
      { id: 'blue.dup', keys: 'f2' },
    ])).toThrow(/"blue\.dup" is already registered/)
  })

  it('unregisters exactly the batch through the disposer, freeing its keys', async () => {
    const ctx = new Context()
    await ctx.plugin(BlueKeymapService)
    const keymap = ctx.blueKeymap
    keymap.register([{ id: 'blue.stay', keys: 'f5' }])
    const dispose = keymap.register([{ id: 'blue.app.quit', keys: 'ctrl+c' }])

    dispose()
    dispose()
    expect(keymap.matches('\x03', 'blue.app.quit')).toBe(false)
    expect(keymap.getKeys('blue.stay')).toEqual(['f5'])

    // The freed key can be claimed again.
    keymap.register([{ id: 'blue.app.interrupt', keys: 'ctrl+c' }])
    expect(keymap.matches('\x03', 'blue.app.interrupt')).toBe(true)
  })
})
