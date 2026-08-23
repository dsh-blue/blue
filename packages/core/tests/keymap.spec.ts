/**
 * `ctx.blueKeymap` service: registration and disposal on the fiber, key
 * matching, and registration-time conflict detection.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { BlueKeymapError, BlueKeymapService } from '../src/keymap.ts'
import type { BlueKeyAction } from '../src/types.ts'

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

  it('dispatches input to handler-carrying actions only, in registration order', async () => {
    const ctx = new Context()
    await ctx.plugin(BlueKeymapService)
    const keymap = ctx.blueKeymap
    const calls: string[] = []
    // A handler-less action never participates in dispatch.
    keymap.register([{ id: 'blue.input.submit', keys: 'enter' }])
    keymap.register([
      { id: 'blue.transcript.toggle', keys: 'ctrl+o', handler: () => calls.push('toggle') },
      { id: 'blue.app.palette', keys: 'ctrl+p', handler: () => calls.push('palette') },
    ])

    expect(keymap.dispatch('\r')).toBe(false)
    expect(keymap.dispatch('\x11')).toBe(false)
    expect(calls).toEqual([])

    expect(keymap.dispatch('\x0f')).toBe(true)
    expect(keymap.dispatch('\x10')).toBe(true)
    expect(calls).toEqual(['toggle', 'palette'])
  })

  it('stops at the first matching handler action', async () => {
    const ctx = new Context()
    await ctx.plugin(BlueKeymapService)
    const keymap = ctx.blueKeymap
    const calls: string[] = []
    // Two handler actions claiming different keys: dispatch of the later
    // key must not invoke the earlier action.
    keymap.register([{ id: 'blue.first', keys: 'ctrl+o', handler: () => calls.push('first') }])
    keymap.register([{ id: 'blue.second', keys: 'ctrl+p', handler: () => calls.push('second') }])

    expect(keymap.dispatch('\x10')).toBe(true)
    expect(calls).toEqual(['second'])
  })

  it('rejects a handler action claiming a taken key without committing it', async () => {
    const ctx = new Context()
    await ctx.plugin(BlueKeymapService)
    const keymap = ctx.blueKeymap
    keymap.register([{ id: 'blue.app.quit', keys: 'ctrl+o' }])
    const handler = vi.fn()

    expect(() => keymap.register([{ id: 'blue.transcript.toggle', keys: 'ctrl+o', handler }]))
      .toThrow(BlueKeymapError)
    // Zero-commit: the rejected handler action never dispatches.
    expect(keymap.dispatch('\x0f')).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  })

  it('stops dispatching an action after its disposer unregisters the batch', async () => {
    const ctx = new Context()
    await ctx.plugin(BlueKeymapService)
    const keymap = ctx.blueKeymap
    const handler = vi.fn()
    const dispose = keymap.register([{ id: 'blue.transcript.toggle', keys: 'ctrl+o', handler }])

    expect(keymap.dispatch('\x0f')).toBe(true)
    dispose()
    expect(keymap.dispatch('\x0f')).toBe(false)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('lists every registered action in registration order across batches', async () => {
    const ctx = new Context()
    await ctx.plugin(BlueKeymapService)
    const keymap = ctx.blueKeymap
    expect(keymap.list()).toEqual([])

    keymap.register([{ id: 'blue.a', keys: 'ctrl+x', description: 'A' }])
    const handler = () => {}
    keymap.register([
      { id: 'blue.b', keys: ['ctrl+o', 'f2'], handler },
      { id: 'blue.c', keys: 'f3' },
    ])

    expect(keymap.list()).toEqual([
      { id: 'blue.a', keys: ['ctrl+x'], description: 'A' },
      { id: 'blue.b', keys: ['ctrl+o', 'f2'], handler },
      { id: 'blue.c', keys: ['f3'] },
    ])
  })

  it('returns a detached snapshot that cannot reach the registry state', async () => {
    const ctx = new Context()
    await ctx.plugin(BlueKeymapService)
    const keymap = ctx.blueKeymap
    keymap.register([{ id: 'blue.a', keys: 'ctrl+x' }])

    const snapshot = keymap.list() as BlueKeyAction[]
    snapshot.length = 0
    snapshot.push({ id: 'blue.injected', keys: ['f9'] })
    expect(keymap.list().map(action => action.id)).toEqual(['blue.a'])
    // Mutating a snapshotted key list does not rebind the action.
    const entry = keymap.list()[0]!
    ;(entry.keys as string[]).push('f9')
    expect(keymap.getKeys('blue.a')).toEqual(['ctrl+x'])
    expect(keymap.matches('\x1bOP', 'blue.a')).toBe(false)
  })

  it('drops a batch from the snapshot once its disposer runs', async () => {
    const ctx = new Context()
    await ctx.plugin(BlueKeymapService)
    const keymap = ctx.blueKeymap
    keymap.register([{ id: 'blue.stay', keys: 'f5' }])
    const dispose = keymap.register([{ id: 'blue.temp', keys: 'ctrl+t', description: 'Temp' }])
    keymap.register([{ id: 'blue.tail', keys: 'f6' }])

    expect(keymap.list().map(action => action.id)).toEqual(['blue.stay', 'blue.temp', 'blue.tail'])
    dispose()
    expect(keymap.list().map(action => action.id)).toEqual(['blue.stay', 'blue.tail'])
  })
})
