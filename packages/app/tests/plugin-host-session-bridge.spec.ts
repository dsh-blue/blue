/**
 * Public session owner bridge wiring and subpath contract.
 *
 * @module @dsh-blue/blue-app/tests/plugin-host-session-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueSessionReader } from '../../api/src/contracts.ts'

const api = vi.hoisted(() => ({ attach: vi.fn() }))

import * as bridge from '../src/plugin-host-session-bridge.ts'

describe('plugin host session bridge', () => {
  beforeEach(() => { api.attach.mockReset() })

  it('keeps an independent subpath and attaches only the readonly app facade', () => {
    const reader: BlueSessionReader = {
      current: () => null,
      subscribe: () => ({ disposed: false, dispose() {} }),
    }
    const broadActions = { followup: vi.fn() }
    const ctx = {
      bluePluginControl: { attachSessionReader: api.attach },
      blueSessionReader: reader,
      blueSessionActions: broadActions,
    } as unknown as Context

    bridge.apply(ctx)

    expect(bridge.name).toBe('blue-plugin-session-bridge')
    expect(bridge.inject).toEqual(['bluePluginControl', 'blueSessionReader'])
    expect(api.attach).toHaveBeenCalledWith(ctx, reader)
    expect(api.attach.mock.calls[0]).not.toContain(broadActions)
  })

  it('uses the injected control authority directly', () => {
    const reader = { current: () => null, subscribe: () => ({ disposed: false, dispose() {} }) } as BlueSessionReader
    const ctx = { bluePluginControl: { attachSessionReader: api.attach }, blueSessionReader: reader } as unknown as Context

    bridge.apply(ctx)

    expect(api.attach).toHaveBeenCalledWith(ctx, reader)
  })
})
