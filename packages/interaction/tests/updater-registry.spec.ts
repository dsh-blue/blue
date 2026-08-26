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
  normalizePackument,
  publishedAt,
  releaseFacts,
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
    '0.4.0': { dependencies: { '@deepseek-ai/dsh-agent-presets': '^0.1.1-rc.2' } },
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

  it('folds the npm-view shapes into the version-keyed map', () => {
    // The real `npm view <pkg> --json` emits versions as an ARRAY of
    // version strings (manifest fields ride only on the top level) — the
    // rehearsal caught the parser assuming the registry API's map of
    // manifests; a full-manifest array folds the same way.
    const stringList = normalizePackument({
      'dist-tags': { rc: '0.1.0-rc.2' },
      versions: ['0.1.0-rc.1', '0.1.0-rc.2'],
      time: { '0.1.0-rc.2': '2026-08-20T00:00:00.000Z' },
    })
    expect(Object.keys(stringList?.versions ?? {})).toEqual(['0.1.0-rc.1', '0.1.0-rc.2'])
    expect(stringList?.versions['0.1.0-rc.2']).toBeUndefined()
    const manifestList = normalizePackument({
      'dist-tags': { rc: '0.1.0-rc.2' },
      versions: [
        { version: '0.1.0-rc.2', dependencies: { '@dsh-blue/blue-core': '^0.1.0-rc.2' } },
        '0.1.0-rc.3',
        { name: 'broken' },
        42,
      ],
      time: {},
    })
    expect(manifestList?.versions['0.1.0-rc.2']).toEqual({ '@dsh-blue/blue-core': '^0.1.0-rc.2' })
    expect(Object.keys(manifestList?.versions ?? {})).toEqual(['0.1.0-rc.2', '0.1.0-rc.3'])
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

  it('classifies an E404 stderr as not-found, distinct from network', async () => {
    seam({
      spawnOnce: () =>
        Promise.resolve({ code: 1, signal: null, stdout: '', stderr: 'npm error code E404\n Not Found', timedOut: false }),
      sleep: () => Promise.resolve(),
    })
    expect(await fetchPackument()).toEqual({ ok: false, reason: 'not-found' })
  })

  it('reports each retry through the onRetry hook, never the first attempt', async () => {
    let spawns = 0
    const retries: Array<[number, number]> = []
    seam({
      spawnOnce: () => {
        spawns += 1
        if (spawns < 3) {
          return Promise.resolve({ code: 1, signal: null, stdout: '', stderr: 'ETIMEDOUT', timedOut: false })
        }
        return viewOk(JSON.stringify(RAW_DOCUMENT))
      },
      sleep: () => Promise.resolve(),
    })
    const result = await fetchPackument({ onRetry: (attempt, total) => retries.push([attempt, total]) })
    expect(result.ok).toBe(true)
    expect(retries).toEqual([[2, 3], [3, 3]])
    // A first-attempt success never fires the hook.
    retries.length = 0
    await fetchPackument({ onRetry: (attempt, total) => retries.push([attempt, total]) })
    expect(retries).toEqual([])
  })
})

describe('updater/registry releaseFacts', () => {
  const packument: Packument = normalizePackument(RAW_DOCUMENT)!

  it('reads the set and harness pin from the packument without a query', async () => {
    const release = await releaseFacts(packument, '0.1.0-rc.2')
    expect(release.names).toEqual([
      '@dsh-blue/blue',
      '@dsh-blue/blue-core',
    ])
    expect(release.harnessLine).toBe('0.1.1-rc.2')
    expect((await releaseFacts(packument, '0.1.0-rc.1')).harnessLine).toBe('0.1.1-rc.1')
    // A range spec carries no pin.
    expect((await releaseFacts(packument, '0.4.0')).harnessLine).toBeUndefined()
  })

  it('falls back to the targeted dependencies query for version-list packuments', async () => {
    const queries: string[][] = []
    updaterInternals.spawnOnce = (cmd, args) => {
      queries.push([...args])
      return Promise.resolve({
        code: 0,
        signal: null,
        stdout: JSON.stringify({
          '@dsh-blue/blue-api': '^0.1.0-rc.3',
          '@dsh-blue/blue-core': '^0.1.0-rc.3',
          '@deepseek-ai/dsh-agent-presets': '0.1.1-rc.3',
        }),
        stderr: '',
        timedOut: false,
      })
    }
    const listed = normalizePackument({
      'dist-tags': { rc: '0.1.0-rc.3' },
      versions: ['0.1.0-rc.2', '0.1.0-rc.3'],
      time: {},
    })!
    const release = await releaseFacts(listed, '0.1.0-rc.3')
    expect(queries).toEqual([['view', '@dsh-blue/blue@0.1.0-rc.3', 'dependencies', '--json']])
    expect(release.names).toEqual(['@dsh-blue/blue', '@dsh-blue/blue-api', '@dsh-blue/blue-core'])
    expect(release.harnessLine).toBe('0.1.1-rc.3')
  })

  it('survives a failed targeted query with an empty set', async () => {
    updaterInternals.spawnOnce = () =>
      Promise.resolve({ code: 1, signal: null, stdout: '', stderr: 'ETIMEDOUT', timedOut: false })
    const listed = normalizePackument({ 'dist-tags': {}, versions: ['0.1.0-rc.3'], time: {} })!
    const release = await releaseFacts(listed, '0.1.0-rc.3')
    expect(release.names).toEqual(['@dsh-blue/blue'])
    expect(release.harnessLine).toBeUndefined()
  })

  it('survives unparseable targeted-query output with an empty set', async () => {
    updaterInternals.spawnOnce = () =>
      Promise.resolve({ code: 0, signal: null, stdout: '<html>maintenance</html>', stderr: '', timedOut: false })
    const listed = normalizePackument({ 'dist-tags': {}, versions: ['0.1.0-rc.3'], time: {} })!
    const release = await releaseFacts(listed, '0.1.0-rc.3')
    expect(release.names).toEqual(['@dsh-blue/blue'])
  })

  it('survives a non-object targeted-query answer with an empty set', async () => {
    updaterInternals.spawnOnce = () =>
      Promise.resolve({ code: 0, signal: null, stdout: 'null', stderr: '', timedOut: false })
    const listed = normalizePackument({ 'dist-tags': {}, versions: ['0.1.0-rc.3'], time: {} })!
    expect((await releaseFacts(listed, '0.1.0-rc.3')).names).toEqual(['@dsh-blue/blue'])
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

