/**
 * Public session owner bridge wiring and subpath contract.
 *
 * @module @dsh-blue/blue-app/tests/plugin-host-session-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueSessionReader } from '../../api/src/contracts.ts'

const api = vi.hoisted(() => ({ attachReader: vi.fn(), attachProjections: vi.fn() }))

import * as bridge from '../src/plugin-host-session-bridge.ts'

describe('plugin host session bridge', () => {
  beforeEach(() => { api.attachReader.mockReset(); api.attachProjections.mockReset() })

  it('keeps an independent subpath and attaches only the readonly app facade', () => {
    const reader: BlueSessionReader = {
      current: () => null,
      subscribe: () => ({ disposed: false, dispose() {} }),
    }
    const projections = { currentMany: vi.fn(), subscribe: vi.fn(() => vi.fn()) }
    const broadActions = { followup: vi.fn() }
    const ctx = {
      bluePluginControl: { attachSessionReader: api.attachReader, attachSessionProjections: api.attachProjections },
      blueSessionReader: reader,
      blueSessionProjections: projections,
      blueSessionActions: broadActions,
    } as unknown as Context

    bridge.apply(ctx)

    expect(bridge.name).toBe('blue-plugin-session-bridge')
    expect(bridge.inject).toEqual(['bluePluginControl', 'blueSessionReader', 'blueSessionProjections'])
    expect(api.attachReader).toHaveBeenCalledWith(ctx, reader)
    expect(api.attachReader.mock.calls[0]).not.toContain(broadActions)
    expect(api.attachProjections).toHaveBeenCalledWith(ctx, expect.objectContaining({ currentMany: expect.any(Function), subscribe: expect.any(Function) }))
    const owner = api.attachProjections.mock.calls[0]![1]
    expect(owner.currentMany(['costUsage'])).toBeNull()
    expect(projections.currentMany).not.toHaveBeenCalled()
  })

  it('uses the injected control authority directly', () => {
    const reader = { current: () => ({ revision: 1, sessionEpoch: 2, id: 's', cwd: '/', status: 'idle', mode: 'normal' }), subscribe: () => ({ disposed: false, dispose() {} }) } as BlueSessionReader
    const off = vi.fn()
    const projections = {
      currentMany: vi.fn(() => ({ sessionEpoch: 2, asOfSeq: 4, values: { costUsage: 3 } })),
      subscribe: vi.fn(() => off),
    }
    const ctx = {
      bluePluginControl: { attachSessionReader: api.attachReader, attachSessionProjections: api.attachProjections },
      blueSessionReader: reader,
      blueSessionProjections: projections,
    } as unknown as Context

    bridge.apply(ctx)

    expect(api.attachReader).toHaveBeenCalledWith(ctx, reader)
    const owner = api.attachProjections.mock.calls[0]![1]
    expect(owner.currentMany(['costUsage'])).toEqual({ sessionEpoch: 2, asOfSeq: 4, values: { costUsage: 3 } })
    const registration = owner.subscribe(vi.fn())
    expect(registration.disposed).toBe(false)
    registration.dispose()
    registration.dispose()
    expect(off).toHaveBeenCalledOnce()
  })
})
