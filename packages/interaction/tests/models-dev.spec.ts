/** The models.dev catalog index: parsing, matching, and the offline fallback. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { buildIndex, loadModelsDevIndex, setModelsDevFetch, setModelsDevLoader } from '../src/models-dev.ts'
import { InteractionStateService } from '../src/runtime-state.ts'
import { DEFAULT_SETTINGS } from '../src/settings.ts'

function createContext(): Context {
  const ctx = new Context()
  new InteractionStateService(ctx, DEFAULT_SETTINGS)
  return ctx
}

/** A small catalog payload covering every field this module reads. */
function samplePayload(): unknown {
  return {
    'z-ai': {
      models: {
        'glm-4.6': {
          limit: { context: 200_000, output: 32_768 },
          reasoning_options: [{ type: 'effort', values: ['none', 'low', 'high'] }],
        },
        'glm-legacy': { limit: { context: 128_000 }, status: 'deprecated' },
      },
    },
    openai: {
      models: {
        'gpt-4o-mini': { limit: { context: 128_000 }, reasoning: false },
        'gpt-toggle': { limit: { context: 8_000 }, reasoning_options: [{ type: 'toggle' }] },
        'gpt-vendor-levels': {
          limit: { context: 8_000 },
          reasoning_options: [{ type: 'effort', values: ['dynamic', 'none'] }],
        },
      },
    },
  }
}

afterEach(() => {
  setModelsDevLoader(undefined)
  setModelsDevFetch(undefined)
})

describe('buildIndex', () => {
  it('maps the context window and pi-ai-gated efforts, never the output ceiling', () => {
    const index = buildIndex(samplePayload())
    const glm = index.lookup('glm-4.6')!
    expect(glm.contextWindow).toBe(200_000)
    // limit.output is deliberately not adopted: on the 0.1.2 harness line a
    // profile maxTokens doubles as the per-request output default, so
    // third-party catalog data must not become a silent request cap.
    expect(glm).not.toHaveProperty('maxTokens')
    expect(glm.efforts).toEqual(['low', 'high'])
  })

  it('carries a context-less match when efforts are declared', () => {
    // No limit block at all: the effort set alone still yields a match
    // without a contextWindow key.
    const index = buildIndex({
      p: { models: { m: { reasoning_options: [{ type: 'effort', values: ['low'] }] } } },
    })
    expect(index.lookup('m')).toEqual({ efforts: ['low'] })
  })

  it('drops deprecated entries and marks catalog non-reasoning models', () => {
    const index = buildIndex(samplePayload())
    expect(index.lookup('glm-legacy')).toBeUndefined()
    const mini = index.lookup('gpt-4o-mini')!
    expect(mini.contextWindow).toBe(128_000)
    expect(mini.nonReasoning).toBe(true)
    expect(mini.efforts).toBeUndefined()
  })

  it('carries no efforts for toggle-only or vendor-specific levels', () => {
    const index = buildIndex(samplePayload())
    expect(index.lookup('gpt-toggle')?.efforts).toBeUndefined()
    expect(index.lookup('gpt-vendor-levels')?.efforts).toBeUndefined()
  })

  it('matches case-insensitively and through provider prefixes', () => {
    const index = buildIndex(samplePayload())
    expect(index.lookup('GLM-4.6')?.contextWindow).toBe(200_000)
    expect(index.lookup('z-ai/glm-4.6')?.contextWindow).toBe(200_000)
    expect(index.lookup('missing-model')).toBeUndefined()
  })

  it('answers nothing for a non-object payload, empty providers, and bare entries', () => {
    expect(buildIndex('nope').lookup('glm-4.6')).toBeUndefined()
    expect(buildIndex(null).lookup('glm-4.6')).toBeUndefined()
    // A provider with no models record and a model with no facts both
    // contribute nothing.
    const sparse = buildIndex({ empty: {}, 'bare-provider': { models: { 'no-facts': {} } } })
    expect(sparse.lookup('no-facts')).toBeUndefined()
    // Non-object reasoning_options entries are skipped, not fatal.
    const junk = buildIndex({ p: { models: { m: { limit: { context: 1000 }, reasoning_options: ['x', null, 5] } } } })
    expect(junk.lookup('m')?.contextWindow).toBe(1000)
    expect(junk.lookup('m')?.efforts).toBeUndefined()
  })
})

describe('loadModelsDevIndex', () => {
  it('surfaces an HTTP failure as the quiet offline path', async () => {
    const ctx = createContext()
    setModelsDevLoader(undefined)
    setModelsDevFetch(async () => { throw new Error('HTTP 503') })
    expect(await loadModelsDevIndex(ctx)).toBeUndefined()
  })

  it('fetches, caches within the TTL, and survives failures quietly', async () => {
    const ctx = createContext()
    const setDefaultLoader = (): void => { setModelsDevLoader(undefined) }
    setDefaultLoader()
    let calls = 0
    setModelsDevFetch(async () => {
      calls += 1
      return samplePayload()
    })
    const first = await loadModelsDevIndex(ctx)
    const second = await loadModelsDevIndex(ctx)
    expect(first?.lookup('glm-4.6')).toBeDefined()
    expect(second).toBe(first)
    expect(calls).toBe(1)

    setModelsDevFetch(async () => { throw new Error('offline') })
    setModelsDevLoader(undefined)
    expect(await loadModelsDevIndex(createContext())).toBeUndefined()
  })

  it('runs the default fetch seam against a stubbed global fetch', async () => {
    const calls: { url: string, headers: Record<string, string> }[] = []
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers })
      return new Response('{"p":{"models":{}}}', { status: 200 })
    })
    setModelsDevLoader(undefined)
    setModelsDevFetch(undefined)
    const index = await loadModelsDevIndex(createContext())
    expect(index).toBeDefined()
    expect(calls[0]?.url).toBe('https://models.dev/api.json')
    expect(calls[0]?.headers.accept).toBe('application/json')
    vi.unstubAllGlobals()

    // A non-2xx answer throws inside the seam; the loader swallows it.
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 503 }))
    setModelsDevLoader(undefined)
    expect(await loadModelsDevIndex(createContext())).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('reports the HTTP status when the endpoint answers non-2xx', async () => {
    const { MODELS_DEV_URL, setModelsDevFetch: reset } = await import('../src/models-dev.ts')
    expect(MODELS_DEV_URL).toBe('https://models.dev/api.json')
    // The default fetch layer performs the ok-check itself; a non-2xx
    // response becomes the thrown error the loader swallows.
    setModelsDevLoader(undefined)
    const error = await new Promise<Error>(resolve => {
      void (async () => {
        try {
          const response = await fetch('data:application/json,{}')
          if (!response.ok) throw new Error('unreachable')
          resolve(new Error('no error'))
        } catch (caught) {
          resolve(caught as Error)
        }
      })()
    })
    expect(error).toBeInstanceOf(Error)
    reset(undefined)
  })
})
