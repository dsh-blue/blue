/**
 * GitHub catalog indexing, canonical admission, fallback, and abort tests.
 *
 * @module @dsh-blue/blue-interaction/plugin-catalog-tests
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bundledPluginCatalog,
  pluginCatalogEffects,
  pluginCatalogInternals,
  refreshPluginCatalog,
} from '../src/plugin-catalog.ts'

const source = pluginCatalogInternals.repositories[0]!

function packageManifest(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    name: '@acme/catalog-plugin',
    version: '1.2.3',
    description: 'A catalog fixture.',
    blue: { manifest: './blue.plugin.json' },
    ...overrides,
  }
}

function canonicalManifest(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    $schema: 'https://dsh-blue.dev/schema/blue.plugin.v1.schema.json',
    schemaVersion: 1,
    id: '@acme/catalog-plugin',
    entry: '.',
    api: '^1.0.0-beta.1',
    compatibility: {
      blue: '>=0.1.1-rc.3 <0.1.2',
      harness: '>=0.1.1-rc.1 <=0.1.1-rc.2',
      node: '^22.19.0 || >=24.0.0',
    },
    capabilities: {
      required: [{ name: 'status', version: '^1.0.0' }],
      optional: [{ name: 'overlays', version: '^1.0.0' }],
    },
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('plugin catalog admission', () => {
  it('ships the indexed doudizhu snapshot without presenting a legacy manifest as installable', () => {
    const result = bundledPluginCatalog()
    expect(result.source).toBe('bundled')
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({
      packageName: '@dsh-blue/blue-doudizhu',
      version: '0.2.0',
      repository: 'dsh-blue/blue-doudizhu',
      commit: 'd2edd2b6cce3440d8aab87dd23e2a05e00d54f14',
      state: 'needs-migration',
      capabilities: ['commands', 'overlays', 'notifications.publish'],
    })
    expect(result.entries[0]?.installSpec).toBeUndefined()
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.entries)).toBe(true)
  })

  it('admits only a compatible canonical manifest and pins its full commit', () => {
    const entry = pluginCatalogInternals.entryFrom(source, 'a'.repeat(40), packageManifest(), canonicalManifest())
    expect(entry).toMatchObject({
      state: 'compatible',
      reason: 'canonical manifest compatible',
      capabilities: ['status', 'overlays'],
      installSpec: `github:${source.repository}@${'a'.repeat(40)}`,
    })
    expect(Object.isFrozen(entry.capabilities)).toBe(true)
  })

  it('classifies malformed, mismatched, legacy, and incompatible source metadata', () => {
    expect(pluginCatalogInternals.entryFrom(source, 'short', packageManifest(), canonicalManifest()))
      .toMatchObject({ state: 'invalid', reason: expect.stringContaining('full commit') })
    expect(pluginCatalogInternals.entryFrom(source, 'a'.repeat(40), null, canonicalManifest()))
      .toMatchObject({ packageName: source.repository, state: 'invalid' })
    expect(pluginCatalogInternals.entryFrom(source, 'a'.repeat(40), packageManifest({ blue: {} }), canonicalManifest()))
      .toMatchObject({ state: 'invalid', reason: expect.stringContaining('./blue.plugin.json') })
    expect(pluginCatalogInternals.entryFrom(source, 'a'.repeat(40), packageManifest(), null))
      .toMatchObject({ state: 'invalid', reason: expect.stringContaining('not an object') })
    expect(pluginCatalogInternals.entryFrom(source, 'a'.repeat(40), packageManifest(), canonicalManifest({ id: '@acme/other' })))
      .toMatchObject({ state: 'invalid', reason: expect.stringContaining('differs') })
    expect(pluginCatalogInternals.entryFrom(source, 'a'.repeat(40), packageManifest(), {
      id: '@acme/catalog-plugin', api: '^1.0.0-beta.1', capabilities: ['commands'],
    })).toMatchObject({ state: 'needs-migration', capabilities: ['commands'] })
    expect(pluginCatalogInternals.entryFrom(source, 'a'.repeat(40), packageManifest(), {
      id: '@acme/catalog-plugin', api: '^1.0.0-beta.1', capabilities: ['commands', 1],
    })).toMatchObject({ state: 'invalid', capabilities: ['commands'] })
    expect(pluginCatalogInternals.entryFrom(source, 'a'.repeat(40), packageManifest(), {
      id: '@acme/catalog-plugin', api: '', capabilities: [],
    })).toMatchObject({ state: 'invalid', reason: expect.stringContaining('api') })
    expect(pluginCatalogInternals.entryFrom(source, 'a'.repeat(40), packageManifest(), {
      id: '@acme/catalog-plugin', api: '^1.0.0-beta.1', capabilities: {},
    })).toMatchObject({ state: 'invalid', capabilities: [] })
    expect(pluginCatalogInternals.entryFrom(source, 'a'.repeat(40), packageManifest(), canonicalManifest({ capabilities: [] })))
      .toMatchObject({ state: 'invalid', reason: expect.stringContaining('/capabilities') })

    const incompatible = pluginCatalogInternals.entryFrom(source, 'a'.repeat(40), packageManifest({
      version: 'not-semver', description: '',
    }), canonicalManifest({
      api: '>=9',
      compatibility: { blue: '>=9', harness: '>=9', node: '>=99' },
    }))
    expect(incompatible).toMatchObject({
      version: 'unknown',
      description: expect.stringContaining('github.com'),
      state: 'incompatible',
      reason: expect.stringContaining('API'),
    })
    expect(incompatible.reason).toContain('Blue')
    expect(incompatible.reason).toContain('Harness')
    expect(incompatible.reason).toContain('Node')
  })
})

describe('plugin catalog refresh', () => {
  it('refreshes the configured repository at a pinned live commit', async () => {
    const fetchJson = vi.spyOn(pluginCatalogEffects, 'fetchJson')
    fetchJson
      .mockResolvedValueOnce({ sha: 'b'.repeat(40) })
      .mockResolvedValueOnce(packageManifest())
      .mockResolvedValueOnce(canonicalManifest())
    const result = await refreshPluginCatalog(new AbortController().signal)
    expect(result).toMatchObject({ source: 'live', entries: [{ state: 'compatible', commit: 'b'.repeat(40) }] })
    expect(fetchJson).toHaveBeenNthCalledWith(1, `https://api.github.com/repos/${source.repository}/commits/main`, expect.any(AbortSignal))
    expect(fetchJson).toHaveBeenNthCalledWith(2, `https://raw.githubusercontent.com/${source.repository}/${'b'.repeat(40)}/package.json`, expect.any(AbortSignal))
    expect(fetchJson).toHaveBeenNthCalledWith(3, `https://raw.githubusercontent.com/${source.repository}/${'b'.repeat(40)}/blue.plugin.json`, expect.any(AbortSignal))
  })

  it('retains the bundled row when GitHub fails or returns no commit', async () => {
    const fetchJson = vi.spyOn(pluginCatalogEffects, 'fetchJson')
    fetchJson.mockRejectedValueOnce('offline')
    const offline = await refreshPluginCatalog(new AbortController().signal)
    expect(offline).toMatchObject({ source: 'bundled', message: expect.stringContaining('offline') })
    expect(offline.entries[0]?.commit).toBe(source.snapshot.commit)

    fetchJson.mockResolvedValueOnce({ sha: 'short' })
    const malformed = await refreshPluginCatalog(new AbortController().signal)
    expect(malformed).toMatchObject({ source: 'bundled', message: expect.stringContaining('no full commit') })

    fetchJson.mockResolvedValueOnce({})
    const missing = await refreshPluginCatalog(new AbortController().signal)
    expect(missing).toMatchObject({ source: 'bundled', message: expect.stringContaining('no full commit') })
  })

  it('propagates an aborted refresh so closed panels reject late state', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.spyOn(pluginCatalogEffects, 'fetchJson').mockRejectedValueOnce(new DOMException('closed', 'AbortError'))
    await expect(refreshPluginCatalog(controller.signal)).rejects.toThrow('closed')
  })
})

describe('catalog HTTP boundary', () => {
  it('parses bounded successful JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '11' }),
      text: async () => '{"ok":true}',
    }))
    await expect(pluginCatalogInternals.defaultFetchJson('https://example.test/catalog', new AbortController().signal))
      .resolves.toEqual({ ok: true })
  })

  it('rejects HTTP, declared-size, body-size, and JSON failures', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    fetch.mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers(), text: async () => '' })
    await expect(pluginCatalogInternals.defaultFetchJson('https://example.test/http', new AbortController().signal)).rejects.toThrow('503')
    fetch.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-length': String(129 * 1024) }), text: async () => '{}' })
    await expect(pluginCatalogInternals.defaultFetchJson('https://example.test/declared', new AbortController().signal)).rejects.toThrow('size limit')
    fetch.mockResolvedValueOnce({ ok: true, headers: new Headers(), text: async () => `"${'x'.repeat(129 * 1024)}"` })
    await expect(pluginCatalogInternals.defaultFetchJson('https://example.test/body', new AbortController().signal)).rejects.toThrow('size limit')
    fetch.mockResolvedValueOnce({ ok: true, headers: new Headers(), text: async () => '{broken' })
    await expect(pluginCatalogInternals.defaultFetchJson('https://example.test/json', new AbortController().signal)).rejects.toThrow('invalid catalog JSON')
  })
})
