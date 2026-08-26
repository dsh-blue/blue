/**
 * The Add Provider flow (S23 v1): a promise-per-panel wizard over the D30
 * editor-slot stack — the kimi `provider.ts` flow shape. Two branches share
 * the machinery: adopting a known vendor from `listConfigurableProviders()`
 * (the dormant pi-ai catalog — anthropic, openai, …) with only its key and
 * host-supplied endpoint, or declaring a custom endpoint (own route id, wire
 * protocol, baseURL, key). The commit is the
 * harness Web Models page's sequence: `settings.mutate` writes the provider
 * profile into the `llm-pi-ai` namespace first (validated at the write by
 * the registering plugin's schema), `credentials.set` stores the key under
 * the conventional ref second — a failed retry then has one step left.
 * After the writes land, the caller-supplied picker opens over the fresh
 * route; keeping it cancelled leaves the provider in place with no
 * default-model change (the kimi "provider persists regardless" ruling).
 *
 * @module @dsh-blue/blue-interaction/provider-add
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
// Empty type imports carry the `settings`/`credentials` Context merges this
// module resolves lazily.
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-credentials'
import { mountEditorReplacement } from './editor-instance.ts'
import { loadModelsDevIndex, type ModelsDevMatch } from './models-dev.ts'
import { FormPanel, type FormField } from './form-panel.ts'
import { BlueSelect } from './select.ts'
import { SelectListPanel } from './select-list.ts'

/** The wire protocols a custom endpoint may declare — the pi-ai `supportedProtocols` subset with a plain baseURL surface. */
export const ENDPOINT_PROTOCOLS = [
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
] as const

/** The protocols whose `/models` listing works — used for discovery. */
const LISTABLE_PROTOCOLS = new Set<string>(['openai-completions', 'openai-responses'])

/** The thinking levels a pi-ai profile may declare (pi-ai's own gate set). */
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** The route-id shape the settings section accepts (the Web Models page's rule). */
const ROUTE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/**
 * The conventional credential ref for one provider route (the Web Models
 * page's derivation): uppercase, non-alphanumerics folded to `_`, `_API_KEY`
 * appended.
 * @param route - the provider route id.
 * @returns the credential ref string.
 */
export function deriveKeyRef(route: string): string {
  return `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/** Render one failure reason for an error result. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Render a failure with its full cause chain — pi-ai's discovery errors say
 * `could not reach <url>` and park the real reason (DNS, TLS, refused
 * socket) in `cause`; without the chain the user sees the wrapper but not
 * the truth.
 * @param error - the thrown failure.
 * @returns the message plus every nested cause's message, `: `-joined.
 */
function describeDeep(error: unknown): string {
  const parts: string[] = []
  let at: unknown = error
  for (let depth = 0; depth < 5 && at instanceof Error; depth += 1) {
    parts.push(at.message)
    at = (at as { cause?: unknown }).cause
  }
  /* v8 ignore next -- the catch always hands an Error; the string arm is
     a non-Error throw that never escapes pi-ai's own catch */
  return parts.length > 0 ? parts.join(': ') : String(error)
}

/** One configured provider row of the picker panel. */
export interface ProviderRow {
  /** The provider route id. */
  readonly id: string
  /** The display name. */
  readonly name: string
}

/** The display quartet the flow threads through every panel. */
export interface ProviderAddDisplay {
  readonly keymap: BlueKeymap
  readonly theme: BlueTheme
  readonly components: BlueComponents
}

/** The declared endpoint a wizard run gathered, before the commit. */
interface EndpointDraft {
  route: string
  protocol: string | undefined
  baseURL?: string
  key: string
  models: { id: string, contextWindow?: number, maxTokens?: number, reasoningEfforts?: Record<string, string> | false }[] | undefined
}

/**
 * Run one wizard step: build the panel around a `done` callback, mount it,
 * and await the callback; `done` pops the panel before resolving, so
 * consecutive steps never stack.
 * @param build - constructs the panel with `done` wired into its callbacks.
 * @returns the step's value, or `undefined` when cancelled.
 */
function step<T>(ctx: Context, build: (done: (value: T | undefined) => void) => BlueFocusable): Promise<T | undefined> {
  return new Promise(resolve => {
    /* v8 ignore next -- the placeholder only runs if a panel settles
       before its mount returns, which the building order forbids */
    let restore: () => void = () => {}
    const done = (value: T | undefined): void => {
      restore()
      resolve(value)
    }
    const panel = build(done)
    restore = mountEditorReplacement(ctx, panel)
  })
}

/** One row of a single-choice step. */
interface Choice {
  readonly value: string
  readonly label: string
}

/** Mount a single-choice list step and await its value. */
function choose(ctx: Context, display: ProviderAddDisplay, title: string, items: readonly Choice[]): Promise<string | undefined> {
  return step<string>(ctx, done => new SelectListPanel({
    keymap: display.keymap,
    theme: display.theme,
    components: display.components,
    rows: items,
    title,
    titleHint: '· esc cancel · ↵ choose',
    onSelect: row => done(row.value),
    onCancel: () => done(undefined),
  }))
}

/** Mount a form step and await its values. */
function fillForm(
  ctx: Context,
  display: ProviderAddDisplay,
  options: { title: string, subtitle: string, fields: readonly FormField[] },
): Promise<Record<string, string> | undefined> {
  return step<Record<string, string>>(ctx, done => new FormPanel({
    keymap: display.keymap,
    theme: display.theme,
    components: display.components,
    title: options.title,
    subtitle: options.subtitle,
    fields: options.fields,
    onSubmit: values => done(values),
    onCancel: () => done(undefined),
  }))
}

/** The llm surface `collectModels` interrogates. */
interface DiscoveryLlm {
  discoverModels(ns: string, request: { baseURL: string, api: string, apiKey: string }): Promise<readonly LlmDiscoveredModel[]>
}

/** One classified discovery failure — the message already distinguishes an
 * unreachable endpoint (`could not reach &lt;url&gt;`), a rejected credential
 * (`…; check the API key` on 401/403), and an unlistable protocol. */
interface DiscoveryFailure {
  readonly message: string
  readonly code?: string
}

/**
 * The listing-probe candidates: the entered base first (respect the user),
 * then the OpenAI `/v1` form, then the bare host — gateways serve the
 * `GET …/models` listing under different path conventions than their
 * conversation routes (new-api answers `/v1/models` while the
 * anthropic-messages transport appends `/v1/messages` to a bare base).
 * @param baseURL - the user-entered base.
 * @returns the deduplicated probe candidates, entered first.
 */
function discoveryBases(baseURL: string): string[] {
  const trimmed = baseURL.replace(/\/+$/, '')
  const withV1 = trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
  const stripped = trimmed.replace(/\/v1$/, '')
  return [...new Set([trimmed, withV1, ...stripped !== trimmed ? [stripped] : []])]
}

/**
 * Normalize the base the profile carries, by protocol convention:
 * anthropic-messages routes append `/v1/messages` themselves so the profile
 * base never keeps a trailing `/v1` (the dogfood's `POST /v1/v1/messages`);
 * the OpenAI protocols append `/chat/completions` so a base that only
 * listed under the `/v1` candidate carries that `/v1` into the profile.
 */
function normalizeBaseURL(protocol: string, entered: string, listingBase: string | undefined): string {
  const trimmed = entered.replace(/\/+$/, '')
  if (protocol === 'anthropic-messages') return trimmed.replace(/\/v1$/, '')
  if (listingBase === `${trimmed}/v1`) return listingBase
  return trimmed
}

/** One discovery attempt's outcome: the models it listed, or the
 * classified failure when it could not (an empty listing is neither). */
interface DiscoveryResult {
  readonly models?: readonly LlmDiscoveredModel[]
  readonly failure?: DiscoveryFailure
}

/**
 * Interrogate the endpoint once. The error's classification rides along so
 * the manual-entry fallback can tell the user whether the gateway is down,
 * the key was rejected, or the protocol simply has no listing.
 */
async function tryDiscover(
  llm: DiscoveryLlm,
  ns: string,
  api: string,
  baseURL: string,
  key: string,
): Promise<DiscoveryResult> {
  try {
    const found = await llm.discoverModels(ns, { baseURL, api, apiKey: key })
    return found.length > 0 ? { models: found } : {}
  } catch (error) {
    const code = (error as { code?: unknown }).code
    return {
      failure: {
        message: describeDeep(error),
        ...(typeof code === 'string' && code.length > 0 ? { code } : {}),
      },
    }
  }
}

/**
 * Determine the custom endpoint's model set by interrogating the endpoint
 * (the adopt multi-select over its answer), with manual entry as the
 * fallback. The declared protocol goes first when it has a listing; every
 * failed or unlistable attempt then probes the endpoint once as a plain
 * `openai-completions` surface — OpenAI-compatible gateways commonly serve
 * the `/models` listing regardless of which wire protocol the caller
 * picked (the first real-terminal dogfood: an anthropic-declared route on
 * a gateway that lists fine). The failure rides the manual form's
 * subtitle.
 */
/** What the models step produced: the entries plus which base listed them,
 * or the classified error that aborts the add. */
type CollectedModels =
  | { models: NonNullable<EndpointDraft['models']>, listingBase?: string }
  | { error: string }

async function collectModels(
  ctx: Context,
  display: ProviderAddDisplay,
  llm: DiscoveryLlm,
  ns: string,
  protocol: string,
  baseURL: string,
  key: string,
): Promise<CollectedModels | undefined> {
  // Declared protocol first (when it has a listing), then the
  // openai-completions gateway fallback; each api probes every base
  // candidate. The first failure (entered base, declared api) is the one
  // the manual form reports — it describes the URL the user typed.
  const apis = [...new Set(LISTABLE_PROTOCOLS.has(protocol)
    ? [protocol, 'openai-completions']
    : ['openai-completions'])]
  let found: { models: readonly LlmDiscoveredModel[], listingBase: string } | undefined
  let failure: DiscoveryFailure | undefined
  for (const api of apis) {
    for (const base of discoveryBases(baseURL)) {
      const outcome = await tryDiscover(llm, ns, api, base, key)
      if (outcome.models !== undefined) {
        found = { models: outcome.models, listingBase: base }
        break
      }
      failure ??= outcome.failure
    }
    if (found !== undefined) break
  }
  if (found !== undefined) {
    {
      const catalog = found.models
      const adopted = await step<string[]>(ctx, done => new BlueSelect({
        keymap: display.keymap,
        theme: display.theme,
        components: display.components,
        items: catalog.map((model: LlmDiscoveredModel) => ({ value: model.id, label: model.id })),
        title: 'Advertised models',
        onConfirm: items => done(items.map(item => item.value)),
        onCancel: () => done(undefined),
      }))
      if (adopted === undefined || adopted.length === 0) return undefined
      return {
        listingBase: found.listingBase,
        models: adopted.map(id => {
          const entry = catalog.find((model: LlmDiscoveredModel) => model.id === id)
          return {
            id,
            ...(entry?.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
            ...(entry?.maxTokens !== undefined ? { maxTokens: entry.maxTokens } : {}),
          }
        }),
      }
    }
  }
  // The manual model-entry stage is disabled (the dogfood ruling): the
  // endpoint must list its models through discovery or the add aborts with
  // the classified reason — the reason tells the user whether the gateway
  // is unreachable, the key was rejected, or nothing was listed. Manual
  // entry may return behind a flag if a listing-less gateway shows up.
  return {
    error: failure !== undefined
      ? `could not list models from the endpoint: ${failure.message}`
      : `the endpoint listed no models under ${baseURL}`,
  }
}


/**
 * Fold one models.dev match into an adopted model entry: fill the context
 * window when neither the listing nor a prior pass described it, and set
 * the effort facts — the pi-ai level→wire map for declared levels, the
 * explicit `false` for a catalog-marked non-reasoning model.
 */
function applyCatalogMatch(
  model: EndpointDraft['models'] extends (infer M)[] | undefined ? M : never,
  match: ModelsDevMatch,
): EndpointDraft['models'] extends (infer M)[] | undefined ? M : never {
  return {
    ...model,
    ...(model.contextWindow === undefined && match.contextWindow !== undefined
      ? { contextWindow: match.contextWindow }
      : {}),
    ...(model.maxTokens === undefined && match.maxTokens !== undefined ? { maxTokens: match.maxTokens } : {}),
    ...(model.reasoningEfforts === undefined && match.efforts !== undefined
      ? { reasoningEfforts: Object.fromEntries(match.efforts.map(level => [level, level])) }
      : {}),
    ...(model.reasoningEfforts === undefined && match.efforts === undefined && match.nonReasoning === true
      ? { reasoningEfforts: false }
      : {}),
  } as EndpointDraft['models'] extends (infer M)[] | undefined ? M : never
}

/**
 * The manual defaults pass for the models the catalog could not describe —
 * one optional context window (applied to undescribed models only) and one
 * thinking-effort set, both skippable with two Enters.
 */
async function fillModelDefaults(
  ctx: Context,
  display: ProviderAddDisplay,
  models: NonNullable<EndpointDraft['models']>,
  catalogReached: boolean,
): Promise<NonNullable<EndpointDraft['models']> | undefined> {
  const defaults = await fillForm(ctx, display, {
    title: 'Model defaults',
    subtitle: catalogReached
      ? 'models.dev did not describe every model — fill the gap or press enter to skip'
      : 'optional — applies to every model this endpoint did not describe',
    fields: [
      {
        id: 'context',
        label: 'Context window',
        hint: 'tokens, e.g. 1048576 — empty keeps the 256k default',
        validate: value => value === '' || /^[0-9]+$/.test(value)
          ? undefined
          : 'the context window is a token count (digits only)',
      },
      {
        id: 'efforts',
        label: 'Thinking efforts',
        hint: `comma-separated from ${(THINKING_LEVELS as readonly string[]).join(', ')} — empty means none`,
        validate: value => value === '' || value.split(',').every(level =>
          THINKING_LEVELS.includes(level.trim() as typeof THINKING_LEVELS[number]))
          ? undefined
          : `efforts come from ${(THINKING_LEVELS as readonly string[]).join(', ')}`,
      },
    ],
  })
  if (defaults === undefined) return undefined
  const contextWindow = defaults.context === '' ? undefined : Number(defaults.context)
  // pi-ai's reasoningEfforts is a level→wire map (the level itself is the
  // wire value on a plain gateway), not a bare list.
  const effortLevels = defaults.efforts !== undefined && defaults.efforts !== ''
    ? defaults.efforts.split(',').map(level => level.trim())
    : undefined
  const reasoningEfforts = effortLevels === undefined
    ? undefined
    : Object.fromEntries(effortLevels.map(level => [level, level]))
  return models.map(model => ({
    ...model,
    ...(model.contextWindow === undefined && contextWindow !== undefined ? { contextWindow } : {}),
    ...(model.reasoningEfforts === undefined && reasoningEfforts !== undefined
      ? { reasoningEfforts }
      : {}),
  }))
}

/** The settings surface the edit flow reads and writes. */
interface EditSettings {
  get(ns: object): unknown
  describe(): { ns: unknown, revision?: number }[]
  mutate(ns: object, ops: unknown[], expected?: number): Promise<void>
}

/** The credentials surface the edit flow writes. */
interface EditCredentials {
  set(ref: object, value: string): Promise<void>
  unset(ref: object): Promise<void>
}

/** One pi-ai provider profile as stored in settings. */
interface ProviderProfile {
  displayName?: string
  api?: string
  baseURL?: string
  models?: unknown
  apiKeyEnv?: string
}

/**
 * Read one route's provider profile from the settings section.
 * @param settings - the settings service.
 * @param ns - the pi-ai namespace.
 * @param route - the provider route id.
 * @returns the stored profile, or undefined when absent.
 */
function readProfile(settings: EditSettings, ns: object, route: string): ProviderProfile | undefined {
  const section = settings.get(ns)
  if (typeof section !== 'object' || section === null) return undefined
  const providers = (section as { providers?: Record<string, unknown> }).providers
  const profile = providers?.[route]
  return typeof profile === 'object' && profile !== null ? profile as ProviderProfile : undefined
}

/** The edit form's settlement: saved values, a delete request, or cancel. */
type EditOutcome = { saved: Record<string, string> } | { delete: true } | { cancelled: true }

/**
 * Edit one configured provider: its display name and API key, plus the base
 * URL for custom routes only (catalog vendors keep the host endpoint), with
 * Ctrl+D deleting the whole route after a typed confirmation. Save normalizes
 * custom base URLs by protocol and keeps every untouched field exactly as
 * stored.
 * @param ctx - plugin context; `settings` and `credentials` resolve lazily.
 * @param display - the resolved display quartet.
 * @param route - the configured provider route id.
 * @returns the outcome line for the notice channel.
 */
export async function runProviderEdit(ctx: Context, display: ProviderAddDisplay, route: string): Promise<string> {
  const settings = ctx.get('settings') as EditSettings | undefined
  const credentials = ctx.get('credentials') as EditCredentials | undefined
  if (settings === undefined || credentials === undefined) {
    return 'provider configuration requires the host settings and credentials services'
  }
  const ns = settingsNamespace('llm-pi-ai')
  const profile = readProfile(settings, ns, route)
  if (profile === undefined) {
    return `provider "${route}" has no stored profile (catalog vendors carry none) — nothing to edit`
  }
  /* v8 ignore next -- the edit command's host guard covers absent llm; this
     optional probe only distinguishes catalog routes when the service exists. */
  const known = ctx.get('llm')?.listConfigurableProviders().some(entry =>
    entry.settingsNs === 'llm-pi-ai' && entry.provider === route) ?? false
  const fields: FormField[] = [
    { id: 'name', label: 'Provider Name', initial: profile.displayName ?? route },
    ...known ? [] : [{
      id: 'baseURL',
      label: 'Base URL',
      initial: profile.baseURL ?? '',
      hint: profile.api === 'anthropic-messages'
        ? 'no trailing /v1 — the client appends /v1/messages'
        : 'include /v1',
    }],
    { id: 'key', label: 'API key', mask: true, hint: 'empty keeps the stored key' },
  ]
  const outcome = await step<EditOutcome>(ctx, done => new FormPanel({
    keymap: display.keymap,
    theme: display.theme,
    components: display.components,
    title: `Configure ${route}`,
    subtitle: 'empty fields keep their stored values',
    fields,
    onSubmit: values => done({ saved: values }),
    onCancel: () => done({ cancelled: true }),
    onDelete: () => done({ delete: true }),
  }))
  if (outcome === undefined || 'cancelled' in outcome) return 'provider edit cancelled'
  if ('delete' in outcome) {
    const confirm = await fillForm(ctx, display, {
      title: `Delete ${route}`,
      subtitle: 'type y to remove the provider and its stored key',
      fields: [
        {
          id: 'yes',
          label: `Delete provider "${route}"?`,
          required: true,
          validate: value => value.toLowerCase() === 'y'
            ? undefined
            : 'type y to confirm, or Esc to keep the provider',
        },
      ],
    })
    if (confirm === undefined) return 'delete cancelled'
    const revision = settings.describe().find(descriptor => String(descriptor.ns) === 'llm-pi-ai')?.revision
    try {
      await settings.mutate(ns, [{ op: 'unset', path: ['providers', route] }], revision)
      await credentials.unset(credentialRef(deriveKeyRef(route)))
    } catch (error) {
      return `could not delete provider ${route}: ${describe(error)}`
    }
    return `provider "${route}" removed`
  }
  const saved = outcome.saved
  const next: Record<string, unknown> = {
    ...profile,
    displayName: saved.name !== undefined && saved.name.trim() !== '' ? saved.name.trim() : route,
    /* v8 ignore next 2 -- the form always delivers defined strings; the
       undefined arms are exactOptionalPropertyTypes artifacts */
    ...(!known && saved.baseURL !== undefined && saved.baseURL !== ''
      ? { baseURL: normalizeBaseURL(profile.api ?? 'openai-completions', saved.baseURL, undefined) }
      : {}),
  }
  /* v8 ignore next -- same form-delivers-strings artifact */
  const key = saved.key ?? ''
  const revision = settings.describe().find(descriptor => String(descriptor.ns) === 'llm-pi-ai')?.revision
  try {
    await settings.mutate(ns, [{ op: 'set', path: ['providers', route], value: next }], revision)
    if (key.trim().length > 0) {
      await credentials.set(credentialRef(deriveKeyRef(route)), key.trim())
    }
  } catch (error) {
    return `could not update provider ${route}: ${describe(error)}`
  }
  return `provider "${route}" updated`
}

/**
 * Whether a provider-flow outcome line is a failure — the cue its notice
 * paints error-red instead of plain (the dogfood ruling: a silent grey
 * error row the user scrolls past is a bug).
 * @param text - the outcome line the add/edit flow returned.
 * @returns `true` for guard and failure lines.
 */
export function isProviderFlowError(text: string): boolean {
  return text.startsWith('could not ')
    || text.startsWith('provider configuration requires')
    || text.startsWith('no configurable providers')
    || text.startsWith('the endpoint listed no models')
    || text.includes('has no stored profile')
    || text.startsWith('every catalog vendor is already active')
}

/**
 * Run the Add Provider wizard to completion (or cancellation).
 * @param ctx - plugin context; `llm`, `settings`, and `credentials` are
 * resolved lazily.
 * @param display - the resolved display quartet.
 * @param openPicker - opens the scoped model picker over a route (the
 * post-add step; a cancelled picker keeps the provider).
 * @returns the outcome line for the command result.
 */
export async function runProviderAdd(
  ctx: Context,
  display: ProviderAddDisplay,
  openPicker: (route: string) => void,
): Promise<string> {
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  const llm = ctx.get('llm')
  if (settings === undefined || credentials === undefined || llm === undefined) {
    return 'provider configuration requires the host settings, credentials, and llm services'
  }
  const configurable = llm.listConfigurableProviders()
  const active = new Set(llm.listProviders().map(provider => provider.id))
  // Custom endpoints are pi-ai profiles — the wire protocols on offer are
  // pi-ai's and only pi-ai's schema accepts arbitrary provider routes. The
  // configurable directory mixes families (a real host lists the deepseek
  // adapter's own entry first), so select the pi-ai namespace explicitly
  // instead of trusting the first entry (the second real-terminal dogfood:
  // discovery answered NO_DISCOVERY for "llm-deepseek").
  const piAi = configurable.filter(entry => entry.settingsNs === 'llm-pi-ai')
  if (piAi.length === 0) {
    return 'no configurable providers: the host composition carries no llm-pi-ai provider settings surface'
  }
  const ns = settingsNamespace('llm-pi-ai')

  // Step 1: the source branch.
  const source = await choose(ctx, display, 'Add provider', [
    { value: 'known', label: 'Known provider (anthropic, openai, …)' },
    { value: 'custom', label: 'Custom endpoint (own baseURL and key)' },
  ])
  if (source === undefined) return 'add provider cancelled'

  // Step 2: the branch-specific declarations.
  let draft: EndpointDraft
  if (source === 'known') {
    const vendors = piAi
      .filter(entry => !active.has(entry.provider))
      .map(entry => ({ value: entry.provider, label: `${entry.displayName} (${entry.provider})` }))
    if (vendors.length === 0) {
      return 'every catalog vendor is already active — switch with /provider switch'
    }
    const route = await choose(ctx, display, 'Known provider', vendors)
    if (route === undefined) return 'add provider cancelled'
    const ref = deriveKeyRef(route)
    const values = await fillForm(ctx, display, {
      title: `Configure ${route}`,
      subtitle: `the vendor default endpoint will be used; the key is stored under ${ref}`,
      fields: [
        { id: 'key', label: 'API key', mask: true, required: true },
      ],
    })
    if (values === undefined) return 'add provider cancelled'
    draft = {
      route,
      protocol: undefined,
      /* v8 ignore next -- the key field is required */
      key: values.key ?? '',
      models: undefined,
    }
  } else {
    const protocol = await choose(ctx, display, 'Endpoint protocol',
      ENDPOINT_PROTOCOLS.map(value => ({ value, label: value })))
    if (protocol === undefined) return 'add provider cancelled'
    // The form loops: a failed listing re-opens the same panel with the
    // classified reason in its error line — fix the URL or key and
    // resubmit; only Escape leaves (the dogfood ruling: an error must not
    // kick the user out of the form they are editing).
    let settle: ((values: Record<string, string> | undefined) => void) | undefined
    const panel = new FormPanel({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      title: 'Custom endpoint',
      subtitle: 'the profile is written to the llm-pi-ai settings namespace',
      fields: [
        {
          id: 'route',
          label: 'Provider Name',
          required: true,
          hint: 'lowercase kebab-case, e.g. my-gateway',
          validate: value => ROUTE_ID.test(value)
            ? (active.has(value) ? `provider name "${value}" already exists` : undefined)
            : 'provider names are lowercase kebab-case (a-z, 0-9, -)',
        },
        {
          id: 'baseURL',
          label: 'Base URL',
          required: true,
          hint: protocol === 'anthropic-messages'
            ? 'no trailing /v1 — the client appends /v1/messages, e.g. https://gw.example.com'
            : 'include /v1, e.g. https://gw.example.com/v1',
        },
        { id: 'key', label: 'API key', mask: true, required: true },
      ],
      onSubmit: values => settle?.(values),
      onCancel: () => settle?.(undefined),
    })
    let restore = mountEditorReplacement(ctx, panel)
    let declared: Record<string, string> | undefined
    let collected: Extract<CollectedModels, { models: unknown }> | undefined
    for (;;) {
      const values = await new Promise<Record<string, string> | undefined>(resolve => {
        settle = resolve
      })
      if (values === undefined) {
        restore()
        return 'add provider cancelled'
      }
      /* v8 ignore next 2 -- both fields are required, the fallbacks are
         exactOptionalPropertyTypes artifacts */
      const outcome = await collectModels(ctx, display, llm, ns, protocol, values.baseURL ?? '', values.key ?? '')
      if (outcome === undefined) {
        restore()
        return 'add provider cancelled'
      }
      if ('error' in outcome) {
        panel.setError(outcome.error)
        continue
      }
      declared = values
      collected = outcome
      restore()
      break
    }
    // The profile base follows the protocol's path convention, not the
    // user's typing: anthropic transports append /v1 themselves, the
    // OpenAI family needs it present.
    /* v8 ignore next -- the required form field guarantees a non-empty base */
    const baseURL = normalizeBaseURL(protocol, declared.baseURL ?? '', collected.listingBase)
    // Match the ids against the models.dev catalog first (the kimi flow):
    // well-known models get their context window and effort set without
    // asking, and a fully-matched set skips the defaults form entirely.
    const index = await loadModelsDevIndex(ctx)
    const enriched = collected.models.map(model => {
      const match = index?.lookup(model.id)
      return match === undefined ? model : applyCatalogMatch(model, match)
    })
    const described = enriched.every(model =>
      model.contextWindow !== undefined && model.reasoningEfforts !== undefined)
    const models = described
      ? enriched
      : await fillModelDefaults(ctx, display, enriched, index !== undefined)
    if (models === undefined) return 'add provider cancelled'
    /* v8 ignore next -- same required-field artifacts */
    draft = { route: declared.route ?? '', protocol, baseURL, key: declared.key ?? '', models }
  }

  // Step 3: the commit — profile first, key second (the Web Models order:
  // a failed retry has one step left).
  const profile: Record<string, unknown> = {
    ...(draft.protocol !== undefined ? { api: draft.protocol } : {}),
    ...(draft.baseURL !== undefined ? { baseURL: draft.baseURL } : {}),
    ...(draft.models !== undefined ? { models: draft.models } : {}),
    apiKeyEnv: deriveKeyRef(draft.route),
  }
  const revision = settings.describe().find(descriptor => descriptor.ns === ns)?.revision
  try {
    await settings.mutate(
      ns,
      [{ op: 'set', path: ['providers', draft.route], value: profile }],
      revision,
    )
    await credentials.set(credentialRef(deriveKeyRef(draft.route)), draft.key)
  } catch (error) {
    return `could not add provider ${draft.route}: ${describe(error)}`
  }
  // The route is live: offer the scoped picker; Escape keeps the provider.
  openPicker(draft.route)
  return `provider "${draft.route}" added`
}
