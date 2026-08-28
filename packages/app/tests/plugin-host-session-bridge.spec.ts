/**
 * Public session owner bridge wiring and subpath contract.
 *
 * @module @dsh-blue/blue-app/tests/plugin-host-session-bridge
 */

import { symbols, type Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueSessionReader, BlueSessionRequester } from '../../api/src/contracts.ts'

const api = vi.hoisted(() => ({ attach: vi.fn() }))

vi.mock('@dsh-blue/blue-api', () => ({
  attachBluePluginHostSessionOwner: api.attach,
}))

import * as bridge from '../src/plugin-host-session-bridge.ts'

describe('plugin host session bridge', () => {
  beforeEach(() => { api.attach.mockReset() })

  it('keeps an independent subpath and attaches only the narrow app facades', () => {
    const originalHost = { id: 'original' }
    const proxiedHost = { [symbols.original]: originalHost }
    const reader: BlueSessionReader = {
      current: () => null,
      subscribe: () => ({ disposed: false, dispose() {} }),
    }
    const requester: BlueSessionRequester = {
      request: async () => ({ ok: true, value: undefined }),
    }
    const broadActions = { followup: vi.fn() }
    const ctx = {
      bluePluginHost: proxiedHost,
      blueSessionReader: reader,
      blueSessionRequester: requester,
      blueSessionActions: broadActions,
    } as unknown as Context

    bridge.apply(ctx)

    expect(bridge.name).toBe('blue-plugin-session-bridge')
    expect(bridge.inject).toEqual(['bluePluginHost', 'blueSessionReader', 'blueSessionRequester'])
    expect(api.attach).toHaveBeenCalledWith(originalHost, ctx, reader, requester)
    expect(api.attach.mock.calls[0]).not.toContain(broadActions)
  })

  it('accepts an unproxied host service', () => {
    const host = { id: 'direct' }
    const reader = { current: () => null, subscribe: () => ({ disposed: false, dispose() {} }) } as BlueSessionReader
    const requester = { request: async () => ({ ok: true as const, value: undefined }) }
    const ctx = { bluePluginHost: host, blueSessionReader: reader, blueSessionRequester: requester } as unknown as Context

    bridge.apply(ctx)

    expect(api.attach).toHaveBeenCalledWith(host, ctx, reader, requester)
  })
})
