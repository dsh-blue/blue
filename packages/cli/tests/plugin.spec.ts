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
  const out: string[] = []
  const err: string[] = []
  const exits: number[] = []
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

  it('handles sparse entries, title fallbacks, flags, and empty registries', async () => {
    const capture = mount()
    const sparse = {
      plugins: [
        { id: 'zh-only', title: { zh: '中文标题' } },
        { id: 7, package: '@scope/seven', title: { en: 42 }, capabilities: undefined, verified: false },
        {},
      ],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(sparse), { status: 200 })))
    expect(await handlePluginCommand(['--json', 'list'])).toBe(true)
    expect(await handlePluginCommand(['search', '--all', '中文'])).toBe(true)
    expect(await handlePluginCommand(['search'])).toBe(true)
    expect(await handlePluginCommand(['info', '@scope/seven'])).toBe(true)
    expect(await handlePluginCommand(['info'])).toBe(true)
    expect(capture.out.join('')).toContain('zh-only\t\t中文标题')
    expect(capture.out.join('')).toContain('"capabilities": []')
    expect(capture.out.join('')).toContain('"verified": false')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    expect(await handlePluginCommand(['list'])).toBe(true)
  })

  it('reports missing entries, malformed registry roots, and non-Error failures', async () => {
    const capture = mount()
    expect(await handlePluginCommand(['info', 'missing'])).toBe(true)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('null', { status: 200 })))
    expect(await handlePluginCommand(['list'])).toBe(true)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('3', { status: 200 })))
    expect(await handlePluginCommand(['list'])).toBe(true)
    vi.stubGlobal('fetch', vi.fn(async () => { throw 'offline' }))
    expect(await handlePluginCommand(['list'])).toBe(true)
    expect(capture.exits).toEqual([1, 1, 1, 1])
    expect(capture.err.join('')).toContain('plugin not found')
    expect(capture.err.join('')).toContain('registry is not an object')
    expect(capture.err.join('')).toContain('offline')
  })

  it('uses a configured marketplace registry URL', async () => {
    const capture = mount()
    cliInternals.env.BLUE_MARKETPLACE_REGISTRY = 'https://registry.example.test/blue.json'
    const request = vi.fn(async () => new Response(JSON.stringify(registry), { status: 200 }))
    vi.stubGlobal('fetch', request)
    expect(await handlePluginCommand(['list'])).toBe(true)
    expect(request).toHaveBeenCalledWith('https://registry.example.test/blue.json', { headers: { accept: 'application/json' } })
    expect(capture.exits).toEqual([])
  })
})
