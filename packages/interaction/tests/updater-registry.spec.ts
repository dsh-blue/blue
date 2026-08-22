/**
 * Tests for the updater's registry module (D52): packument
 * normalization, the npm-view → direct-fetch ladder with bounded
 * retries, and the harness-line / publish-time selectors.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { SpawnOutcome } from '../src/updater/io.ts'
import { updaterInternals } from '../src/updater/io.ts'
import {
  fetchPackument,
  harnessLineOf,
  normalizePackument,
  publishedAt,
  type Packument,
} from '../src/updater/registry.ts'

/** A valid npm-view/registry-API document fixture. */
const RAW_DOCUMENT = {
  name: '@dsh-blue/blue',
  'dist-tags': { rc: '0.1.0-rc.2', latest: '0.1.0-rc.2', broken: 7 },
  versions: {
    '0.1.0-rc.1': { dependencies: { '@deepseek-ai/dsh-agent-presets': '0.1.1-rc.1' } },
    '0.1.0-rc.2': {
      dependencies: {
        '@dsh-blue/blue-core': '^0.1.0-rc.2',
        '@deepseek-ai/dsh-agent-presets': '0.1.1-rc.2',
      },
    },
    '0.2.0': 'not-a-manifest',
    '0.3.0': { dependencies: 'not-an-object' },
  },
  time: {
    created: '2026-08-20T00:00:00.000Z',
    modified: '2026-08-22T00:00:00.000Z',
    '0.1.0-rc.2': '2026-08-22T00:00:00.000Z',
    '0.1.0-rc.1': '2026-08-21T00:00:00.000Z',
    broken: null,
  },
}

/** The real seams, restored after every test. */
const REAL = { ...updaterInternals }

/** Replace the async seams for one test and restore them after. */
function seam(overrides: {
  spawnOnce?: (cmd: string, args: readonly string[], opts?: { timeoutMs?: number }) => Promise<SpawnOutcome>
  fetchText?: (url: string, timeoutMs: number) => Promise<string>
  sleep?: (ms: number) => Promise<void>
}): void {
  if (overrides.spawnOnce !== undefined) updaterInternals.spawnOnce = overrides.spawnOnce
  if (overrides.fetchText !== undefined) updaterInternals.fetchText = overrides.fetchText
  if (overrides.sleep !== undefined) updaterInternals.sleep = overrides.sleep
}

afterEach(() => {
  Object.assign(updaterInternals, REAL)
})

/** A successful npm-view outcome carrying the given stdout. */
function viewOk(stdout: string): Promise<SpawnOutcome> {
  return Promise.resolve({ code: 0, signal: null, stdout, stderr: '', timedOut: false })
}

describe('updater/registry normalizePackument', () => {
  it('normalizes tags, per-version dependencies, and publish times', () => {
    const packument = normalizePackument(RAW_DOCUMENT)
    expect(packument).toBeDefined()
    expect(packument?.tags).toEqual({ rc: '0.1.0-rc.2', latest: '0.1.0-rc.2' })
    expect(packument?.versions['0.1.0-rc.2']).toEqual({
      '@dsh-blue/blue-core': '^0.1.0-rc.2',
      '@deepseek-ai/dsh-agent-presets': '0.1.1-rc.2',
    })
    expect(packument?.versions['0.2.0']).toBeUndefined()
    expect(packument?.versions['0.3.0']).toBeUndefined()
    expect(packument?.time['0.1.0-rc.2']).toBe('2026-08-22T00:00:00.000Z')
    expect(packument?.time.broken).toBeUndefined()
  })

  it('rejects foreign shapes', () => {
    for (const raw of [null, 'text', 42, {}, { 'dist-tags': {} }, { 'dist-tags': {}, versions: {} }]) {
      expect(normalizePackument(raw)).toBeUndefined()
    }
  })

  it('skips non-string dependency specs inside an object block', () => {
    const packument = normalizePackument({
      'dist-tags': { rc: '1.0.0' },
      versions: { '1.0.0': { dependencies: { good: '1.2.3', bad: 9 } } },
      time: {},
    })
    expect(packument?.versions['1.0.0']).toEqual({ good: '1.2.3' })
  })
})

describe('updater/registry fetchPackument', () => {
  it('reads a successful npm view on the first attempt without sleeping', async () => {
    let spawns = 0
    seam({
      spawnOnce: () => {
        spawns += 1
        return viewOk(JSON.stringify(RAW_DOCUMENT))
      },
      sleep: () => {
        throw new Error('no retry expected')
      },
    })
    const result = await fetchPackument()
    expect(spawns).toBe(1)
    expect(result.ok).toBe(true)
  })

  it('retries a nonzero npm view and succeeds on the second attempt', async () => {
    let spawns = 0
    const delays: number[] = []
    seam({
      spawnOnce: () => {
        spawns += 1
        if (spawns === 1) {
          return Promise.resolve({ code: 1, signal: null, stdout: '', stderr: 'ETIMEDOUT', timedOut: false })
        }
        return viewOk(JSON.stringify(RAW_DOCUMENT))
      },
      sleep: ms => {
        delays.push(ms)
        return Promise.resolve()
      },
    })
    const result = await fetchPackument()
    expect(result.ok).toBe(true)
    expect(spawns).toBe(2)
    expect(delays).toEqual([1_500])
  })

  it('keeps the unparseable verdict after retrying proxy-weird output', async () => {
    let spawns = 0
    seam({
      spawnOnce: () => {
        spawns += 1
        return viewOk('<html>maintenance</html>')
      },
      sleep: () => Promise.resolve(),
    })
    const result = await fetchPackument()
    expect(result).toEqual({ ok: false, reason: 'unparseable' })
    expect(spawns).toBe(3)
  })

  it('reports valid JSON of a foreign shape as unparseable', async () => {
    seam({
      spawnOnce: () => viewOk('{}'),
      sleep: () => Promise.resolve(),
    })
    expect(await fetchPackument()).toEqual({ ok: false, reason: 'unparseable' })
  })

  it('falls back to the direct fetch when npm is missing', async () => {
    const urls: string[] = []
    seam({
      spawnOnce: () =>
        Promise.resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: false, spawnError: 'ENOENT' }),
      fetchText: (url, timeoutMs) => {
        urls.push(url)
        expect(timeoutMs).toBe(8_000)
        return Promise.resolve(JSON.stringify(RAW_DOCUMENT))
      },
      sleep: () => Promise.resolve(),
    })
    const result = await fetchPackument()
    expect(result.ok).toBe(true)
    expect(urls).toEqual(['https://registry.npmjs.org/@dsh-blue/blue'])
  })

  it('falls back per attempt when npm is missing and the fetch keeps failing', async () => {
    let spawns = 0
    let fetches = 0
    seam({
      spawnOnce: () => {
        spawns += 1
        return Promise.resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: false, spawnError: 'ENOENT' })
      },
      fetchText: () => {
        fetches += 1
        return Promise.reject(new Error('network down'))
      },
      sleep: () => Promise.resolve(),
    })
    const result = await fetchPackument()
    expect(result).toEqual({ ok: false, reason: 'network' })
    expect(spawns).toBe(3)
    expect(fetches).toBe(3)
  })

  it('exhausts retries when npm view keeps failing', async () => {
    let spawns = 0
    const delays: number[] = []
    seam({
      spawnOnce: () => {
        spawns += 1
        return Promise.resolve({ code: 1, signal: null, stdout: '', stderr: 'EPUBLISHCONFLICT', timedOut: false })
      },
      sleep: ms => {
        delays.push(ms)
        return Promise.resolve()
      },
    })
    const result = await fetchPackument()
    expect(result).toEqual({ ok: false, reason: 'network' })
    expect(spawns).toBe(3)
    expect(delays).toEqual([1_500, 4_000])
  })
})

describe('updater/registry selectors', () => {
  const packument: Packument = normalizePackument(RAW_DOCUMENT)!

  it('harnessLineOf reads the exact pin and rejects ranges', () => {
    expect(harnessLineOf(packument, '0.1.0-rc.2')).toBe('0.1.1-rc.2')
    expect(harnessLineOf(packument, '0.3.0')).toBeUndefined()
    expect(harnessLineOf(packument, '9.9.9')).toBeUndefined()
  })

  it('publishedAt parses timestamps and reports unknowns', () => {
    expect(publishedAt(packument, '0.1.0-rc.2')).toBe(Date.parse('2026-08-22T00:00:00.000Z'))
    expect(publishedAt(packument, '9.9.9')).toBeUndefined()
  })

  it('publishedAt reports unparseable timestamps as unknown', () => {
    const packument = normalizePackument({
      'dist-tags': { rc: '1.0.0' },
      versions: { '1.0.0': {} },
      time: { '1.0.0': 'not-a-date' },
    })!
    expect(publishedAt(packument, '1.0.0')).toBeUndefined()
  })
})
