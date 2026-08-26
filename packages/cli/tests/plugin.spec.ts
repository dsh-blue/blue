/** Marketplace command tests for the standalone launcher. @module cli/plugin-tests */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cliInternals } from '../src/internals.ts'
import { handlePluginCommand } from '../src/plugin.ts'

const REAL = { ...cliInternals }

afterEach(() => {
  Object.assign(cliInternals, REAL)
  vi.unstubAllGlobals()
})

const registry = {
  plugins: [{ id: 'blue-doudizhu', package: '@dsh-blue/blue-doudizhu', version: '0.1.0', title: { en: 'Doudizhu', zh: '斗地主' }, tagline: { en: 'cards' }, capabilities: ['commands'], verified: true, repo: 'https://github.com/dsh-blue/blue-doudizhu' }],
}

function mount(): { out: string[], err: string[], exits: number[] } {
  const out: string[] = []; const err: string[] = []; const exits: number[] = []
  cliInternals.env = {}
  cliInternals.stdout = value => out.push(value)
  cliInternals.stderr = value => err.push(value)
  cliInternals.exit = value => exits.push(value)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(registry), { status: 200 })))
  return { out, err, exits }
}

describe('handlePluginCommand', () => {
  it('lists and searches marketplace entries', async () => {
    const capture = mount()
    expect(await handlePluginCommand(['list'])).toBe(true)
    expect(await handlePluginCommand(['search', 'doudizhu'])).toBe(true)
    expect(capture.out.join('')).toContain('blue-doudizhu')
  })

  it('prints plugin info and leaves mutating commands to dsh', async () => {
    const capture = mount()
    expect(await handlePluginCommand(['info', 'blue-doudizhu'])).toBe(true)
    expect(await handlePluginCommand(['install', '@dsh-blue/blue-doudizhu'])).toBe(false)
    expect(capture.out.join('')).toContain('Doudizhu')
  })

  it('reports registry failures and unknown commands', async () => {
    const capture = mount()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 503 })))
    expect(await handlePluginCommand(['list'])).toBe(true)
    expect(capture.exits).toEqual([1])
    expect(await handlePluginCommand(['verify', 'x'])).toBe(false)
  })
})
