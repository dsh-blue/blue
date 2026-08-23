/**
 * The models.dev catalog lookup — the kimi `catalog-fetch` port, scoped to
 * the Add wizard's metadata gap: OpenAI-compatible gateways list bare model
 * ids, so the adopted models land on pi-ai's 262k default with no thinking
 * levels. Matching the ids against `https://models.dev/api.json` fills the
 * context window (and the effort set, when the entry declares one) for every
 * well-known model; the manual defaults form remains the fallback for
 * anything the catalog does not know. The fetch is best-effort: offline or
 * slow networks quietly leave the form as the only source, and a short-lived
 * cache keeps repeated wizard runs from re-downloading the index.
 *
 * @module @dsh-blue/blue-interaction/models-dev
 */

/** The thinking levels a pi-ai profile may declare (pi-ai's own gate set). */
const PI_AI_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

/** One model's catalog match: what the wizard can adopt without asking. */
export interface ModelsDevMatch {
  /** The declared context window (`limit.context`). */
  readonly contextWindow?: number
  /** The declared output ceiling (`limit.output`). */
  readonly maxTokens?: number
  /** Selectable effort levels (`reasoning_options` effort values minus the
   * off tier), intersected with pi-ai's gate — empty matches carry nothing. */
  readonly efforts?: readonly string[]
  /** The catalog explicitly marks the model non-reasoning. */
  readonly nonReasoning?: boolean
}

/** A loaded, queryable catalog index. */
export interface ModelsDevIndex {
  /** Look one model id up (case-insensitive, provider-prefix tolerant). */
  lookup(id: string): ModelsDevMatch | undefined
}

/** The public catalog endpoint (the kimi default). */
export const MODELS_DEV_URL = 'https://models.dev/api.json'

/** One index entry lives this long; repeated wizard runs reuse it. */
const CACHE_TTL_MS = 10 * 60 * 1000

/** The network fetch behind the index (tests replace the seam; the body is
 * the plain fetch-then-ok-check and never runs against the net in specs). */
async function defaultCatalogFetch(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`models.dev answered HTTP ${response.status}`)
  return await response.json()
}

/** The fetch the loader uses — module-replaceable for tests. */
let catalogFetch: (url: string, signal: AbortSignal) => Promise<unknown> = defaultCatalogFetch

/** Replace the catalog fetch (tests); restores the network default when omitted. */
export function setModelsDevFetch(replacement?: (url: string, signal: AbortSignal) => Promise<unknown>): void {
  catalogFetch = replacement ?? defaultCatalogFetch
  cache = undefined
}

/** The loaded index plus its load time. */
let cache: { at: number, index: ModelsDevIndex } | undefined

/** The loader the wizard calls — module-replaceable for tests. */
export let loadModelsDevIndex: () => Promise<ModelsDevIndex | undefined> = defaultLoadIndex

/** Replace the index loader (tests); restores the default when omitted. */
export function setModelsDevLoader(replacement?: () => Promise<ModelsDevIndex | undefined>): void {
  loadModelsDevIndex = replacement ?? defaultLoadIndex
  cache = undefined
}

async function defaultLoadIndex(): Promise<ModelsDevIndex | undefined> {
  if (cache !== undefined && Date.now() - cache.at < CACHE_TTL_MS) return cache.index
  try {
    // Best-effort: a slow or unreachable endpoint must never block the
    // wizard, so the fetch carries its own short deadline.
    const payload = await catalogFetch(MODELS_DEV_URL, AbortSignal.timeout(4000))
    const index = buildIndex(payload)
    cache = { at: Date.now(), index }
    return index
  } catch {
    return undefined
  }
}

/** One raw models.dev model entry (the fields this module reads). */
interface RawModelEntry {
  readonly limit?: { readonly context?: unknown, readonly output?: unknown }
  readonly reasoning?: unknown
  readonly reasoning_options?: unknown
  readonly status?: unknown
}

/** One raw models.dev provider entry. */
interface RawProviderEntry {
  readonly models?: Record<string, RawModelEntry>
}

/**
 * Flatten the catalog payload into a queryable index. Deprecated models are
 * dropped (the kimi import rule); later providers win id collisions.
 * @param payload - the parsed `api.json` payload.
 * @returns the index.
 */
export function buildIndex(payload: unknown): ModelsDevIndex {
  const matches = new Map<string, ModelsDevMatch>()
  if (typeof payload !== 'object' || payload === null) return { lookup: () => undefined }
  for (const entry of Object.values(payload as Record<string, RawProviderEntry>)) {
    if (entry?.models === undefined) continue
    for (const [id, model] of Object.entries(entry.models)) {
      if (model?.status === 'deprecated') continue
      const match = matchOf(model)
      if (match !== undefined) matches.set(id.toLowerCase(), match)
    }
  }
  return {
    lookup: (id: string): ModelsDevMatch | undefined =>
      matches.get(modelsDevKey(id)) ?? matches.get(bareKey(id)),
  }
}

/** Lower-cased lookup key. */
function modelsDevKey(id: string): string {
  return id.trim().toLowerCase()
}

/** The id after a provider prefix (`z-ai/glm-4.6` → `glm-4.6`). */
function bareKey(id: string): string {
  const slash = id.lastIndexOf('/')
  return slash === -1 ? modelsDevKey(id) : modelsDevKey(id.slice(slash + 1))
}

/** Extract the wizard-usable match from one raw entry, if any. */
function matchOf(model: RawModelEntry): ModelsDevMatch | undefined {
  const contextWindow = positiveNumber(model.limit?.context)
  const maxTokens = positiveNumber(model.limit?.output)
  const { efforts, nonReasoning } = effortFacts(model)
  if (contextWindow === undefined && efforts === undefined && nonReasoning === undefined) {
    return undefined
  }
  return {
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(efforts !== undefined ? { efforts } : {}),
    ...(nonReasoning === true ? { nonReasoning: true } : {}),
  }
}

/**
 * Map models.dev's `reasoning_options` onto pi-ai-gated effort levels —
 * the kimi rules: only `{type: 'effort', values}` yields levels, the `none`
 * entry (or JSON null) is the off tier and drops out, `toggle` marks
 * user-switchable thinking without levels. Levels outside pi-ai's gate
 * (vendor-specific names) cannot be written to a profile and drop too.
 */
function effortFacts(model: RawModelEntry): { efforts?: readonly string[], nonReasoning?: boolean } {
  const options = model.reasoning_options
  if (Array.isArray(options)) {
    for (const option of options) {
      if (typeof option !== 'object' || option === null) continue
      const typed = option as { type?: unknown, values?: unknown }
      if (typed.type !== 'effort' || !Array.isArray(typed.values)) continue
      const levels = typed.values
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .filter(level => level.toLowerCase() !== 'none')
        .filter(level => PI_AI_LEVELS.has(level.toLowerCase()))
      if (levels.length > 0) {
        // Keep the catalog's casing but normalize onto pi-ai's gate ids.
        return { efforts: levels.map(level => level.toLowerCase()) }
      }
    }
    return {}
  }
  if (model.reasoning === false) return { nonReasoning: true }
  return {}
}

/** A positive finite number, or undefined. */
function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}
