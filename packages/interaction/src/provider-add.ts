/**
 * The Add Provider flow (S23 v1): a promise-per-panel wizard over the D30
 * editor-slot stack — the kimi `provider.ts` flow shape. Two branches share
 * the machinery: adopting a known vendor from `listConfigurableProviders()`
 * (the dormant pi-ai catalog — anthropic, openai, …), or declaring a custom
 * endpoint (own route id, wire protocol, baseURL, key). The commit is the
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
import { framePanel } from '@dsh-blue/blue-core/chrome'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
// Empty type imports carry the `settings`/`credentials` Context merges this
// module resolves lazily.
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-credentials'
import { mountEditorReplacement } from './editor-instance.ts'
import { FormPanel, type FormField } from './form-panel.ts'
import { ACTION_CANCEL, ACTION_MOVE_DOWN, ACTION_MOVE_UP, ACTION_SUBMIT } from './keys.ts'
import { BlueSelect, SessionList } from './select.ts'
import { CURRENT_MARK, SELECT_POINTER } from './symbols.ts'

/** The wire protocols a custom endpoint may declare — the pi-ai `supportedProtocols` subset with a plain baseURL surface. */
export const ENDPOINT_PROTOCOLS = [
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
] as const

/** The protocols whose `/models` listing works — used for discovery. */
const LISTABLE_PROTOCOLS = new Set<string>(['openai-completions', 'openai-responses'])

/** The route-id shape the settings section accepts (the Web Models page's rule). */
const ROUTE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Provider rows rendered at once; the real catalog lists ~36 vendors, so
 * the pane windows like every other list (the @ completion's shape). */
const MAX_VISIBLE = 8

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

/** One configured provider row of the picker panel. */
export interface ProviderRow {
  /** The provider route id. */
  readonly id: string
  /** The display name. */
  readonly name: string
}

/** Construction options for {@link ProviderPanel}. */
export interface ProviderPanelOptions {
  /** Keybinding registry used to resolve the list keys. */
  readonly keymap: BlueKeymap
  /** Theme supplying the row, badge, and rule colors. */
  readonly theme: BlueTheme
  /** Component factory supplying the width measurement/truncation helpers. */
  readonly components: BlueComponents
  /** Rows: active routes and dormant catalog vendors, in catalog order. */
  readonly rows: readonly ProviderRow[]
  /** The live selection's provider id, badged `← current`. */
  readonly currentProvider: string
  /** Enter on a configured row. */
  readonly onSelect: (row: ProviderRow) => void
  /** Enter on the trailing CTA row. */
  readonly onAdd: () => void
  /** Escape. */
  readonly onCancel: () => void
}

/**
 * The `/provider` picker: the configured routes (Enter opens the scoped
 * model picker over that route's models) and the trailing
 * `+ Add provider` CTA — plain until the cursor reaches it, then it
 * takes the pointer and the `primary` hue like any selected row (the
 * dogfood ruling). Dormant catalog vendors live in the wizard's
 * known-provider branch, not here.
 */
export class ProviderPanel implements BlueFocusable {
  /** Whether the panel currently holds focus. Managed by the screen. */
  focused = false

  private cursor = 0

  /**
   * @param options - see {@link ProviderPanelOptions}.
   */
  constructor(private readonly options: ProviderPanelOptions) {}

  /**
   * Dispatch one input sequence against the list keybindings.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    const { keymap, rows } = this.options
    const count = rows.length + 1
    if (keymap.matches(data, ACTION_MOVE_UP)) {
      this.cursor = this.cursor === 0 ? count - 1 : this.cursor - 1
      return
    }
    if (keymap.matches(data, ACTION_MOVE_DOWN)) {
      this.cursor = this.cursor === count - 1 ? 0 : this.cursor + 1
      return
    }
    if (keymap.matches(data, ACTION_SUBMIT)) {
      if (this.cursor === rows.length) {
        this.options.onAdd()
        return
      }
      const row = rows[this.cursor]
      /* v8 ignore next -- the cursor is always a row index or the CTA slot */
      if (row === undefined) return
      this.options.onSelect(row)
      return
    }
    if (keymap.matches(data, ACTION_CANCEL)) this.options.onCancel()
  }

  /** No cached render state. */
  invalidate(): void {}

  /**
   * Render the framed provider list.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const { rows, components, theme } = this.options
    const colors = theme.colors
    const lines: string[] = []
    // The visible window centers on the cursor like SessionList; the CTA
    // row rides directly under the window so it stays reachable without
    // ever letting the catalog spill the whole screen.
    const start = Math.max(0, Math.min(
      this.cursor - Math.floor(MAX_VISIBLE / 2),
      rows.length - MAX_VISIBLE,
    ))
    const end = Math.min(start + MAX_VISIBLE, rows.length)
    for (let index = start; index < end; index += 1) {
      const row = rows[index]
      /* v8 ignore next -- start/end are clamped to rows.length */
      if (row === undefined) continue
      const isCursor = index === this.cursor
      const pointer = isCursor ? colors.primary(SELECT_POINTER) : ' '
      const label = isCursor ? colors.primary(row.name) : colors.text(row.name)
      const tail = row.id === this.options.currentProvider ? `  ${colors.success(CURRENT_MARK)}` : ''
      lines.push(components.truncateToWidth(`  ${pointer} ${label}${tail}`, width))
    }
    if (rows.length > MAX_VISIBLE) {
      lines.push(colors.textMuted(`  (${this.cursor + 1}/${rows.length})`))
    }
    // The CTA is a plain `+` row until the cursor reaches it; selected it
    // takes the pointer and the primary hue like any other row.
    const addCursor = this.cursor === rows.length
    const addRow = `  ${addCursor ? SELECT_POINTER : '+'} + Add provider`
    lines.push(addCursor ? colors.primary(addRow) : colors.text(addRow))
    return framePanel(lines, width, {
      title: 'Providers',
      titlePaint: colors.primary,
      titleHint: '· esc cancel · ↵ switch / add',
      hintPaint: colors.textMuted,
      rulePaint: colors.primary,
    })
  }
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
  baseURL: string | undefined
  key: string
  models: { id: string, contextWindow?: number, maxTokens?: number }[] | undefined
}

/**
 * Run one wizard step: build the panel around a `done` callback, mount it,
 * and await the callback; `done` pops the panel before resolving, so
 * consecutive steps never stack.
 * @param build - constructs the panel with `done` wired into its callbacks.
 * @returns the step's value, or `undefined` when cancelled.
 */
function step<T>(build: (done: (value: T | undefined) => void) => BlueFocusable): Promise<T | undefined> {
  return new Promise(resolve => {
    /* v8 ignore next -- the placeholder only runs if a panel settles
       before its mount returns, which the building order forbids */
    let restore: () => void = () => {}
    const done = (value: T | undefined): void => {
      restore()
      resolve(value)
    }
    const panel = build(done)
    restore = mountEditorReplacement(panel)
  })
}

/** One row of a single-choice step. */
interface Choice {
  readonly value: string
  readonly label: string
}

/** Mount a single-choice list step and await its value. */
function choose(display: ProviderAddDisplay, title: string, items: readonly Choice[]): Promise<string | undefined> {
  return step<string>(done => new SessionList({
    keymap: display.keymap,
    theme: display.theme,
    components: display.components,
    items,
    title,
    titleHint: '· esc cancel · ↵ choose',
    onSelect: item => done(item.value),
    onCancel: () => done(undefined),
  }))
}

/** Mount a form step and await its values. */
function fillForm(
  display: ProviderAddDisplay,
  options: { title: string, subtitle: string, fields: readonly FormField[] },
): Promise<Record<string, string> | undefined> {
  return step<Record<string, string>>(done => new FormPanel({
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
        message: describe(error),
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
async function collectModels(
  display: ProviderAddDisplay,
  llm: DiscoveryLlm,
  ns: string,
  protocol: string,
  baseURL: string,
  key: string,
): Promise<EndpointDraft['models'] | undefined> {
  // Declared protocol first (when it has a listing), then the
  // openai-completions gateway fallback. The fallback keeps whichever
  // outcome is more informative: models win, a classified failure beats
  // an empty listing.
  let outcome: DiscoveryResult = {}
  if (LISTABLE_PROTOCOLS.has(protocol)) {
    outcome = await tryDiscover(llm, ns, protocol, baseURL, key)
  } else {
    outcome = await tryDiscover(llm, ns, 'openai-completions', baseURL, key)
  }
  if (outcome.models === undefined) {
    const fallback = await tryDiscover(llm, ns, 'openai-completions', baseURL, key)
    outcome = fallback.models !== undefined || fallback.failure !== undefined ? fallback : outcome
  }
  const models = outcome.models
  if (models !== undefined) {
    {
      const catalog = models
      const adopted = await step<string[]>(done => new BlueSelect({
        keymap: display.keymap,
        theme: display.theme,
        components: display.components,
        items: catalog.map((model: LlmDiscoveredModel) => ({ value: model.id, label: model.id })),
        title: 'Advertised models',
        onConfirm: items => done(items.map(item => item.value)),
        onCancel: () => done(undefined),
      }))
      if (adopted === undefined || adopted.length === 0) return undefined
      return adopted.map(id => {
        const found = catalog.find((model: LlmDiscoveredModel) => model.id === id)
        return {
          id,
          ...(found?.contextWindow !== undefined ? { contextWindow: found.contextWindow } : {}),
          ...(found?.maxTokens !== undefined ? { maxTokens: found.maxTokens } : {}),
        }
      })
    }
  }
  const manual = await fillForm(display, {
    title: 'Model ids',
    // The classified reason tells the user whether the gateway is
    // unreachable, the key was rejected, or nothing was listed.
    subtitle: outcome.failure !== undefined
      ? `discovery failed: ${outcome.failure.message} — enter model ids manually`
      : 'the endpoint listed no models — enter model ids manually',
    fields: [
      {
        id: 'ids',
        label: 'Model ids',
        required: true,
        hint: 'comma-separated, e.g. claude-sonnet-5, claude-haiku-4-5',
        validate: value => value.split(',').every(id => id.trim().length > 0)
          ? undefined
          : 'every comma-separated id must be non-empty',
      },
    ],
  })
  if (manual === undefined) return undefined
  /* v8 ignore next -- the required field guarantees a non-empty id list */
  return manual.ids?.split(',').map(id => ({ id: id.trim() })) ?? []
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
  const source = await choose(display, 'Add provider', [
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
    const route = await choose(display, 'Known provider', vendors)
    if (route === undefined) return 'add provider cancelled'
    const ref = deriveKeyRef(route)
    const values = await fillForm(display, {
      title: `Configure ${route}`,
      subtitle: `the key is stored under ${ref} via the credentials service`,
      fields: [
        { id: 'baseURL', label: 'Base URL', hint: 'leave empty for the vendor default endpoint' },
        { id: 'key', label: 'API key', mask: true, required: true },
      ],
    })
    if (values === undefined) return 'add provider cancelled'
    draft = {
      route,
      protocol: undefined,
      baseURL: values.baseURL === '' ? undefined : values.baseURL,
      /* v8 ignore next -- the key field is required */
      key: values.key ?? '',
      models: undefined,
    }
  } else {
    const protocol = await choose(display, 'Endpoint protocol',
      ENDPOINT_PROTOCOLS.map(value => ({ value, label: value })))
    if (protocol === undefined) return 'add provider cancelled'
    const declared = await fillForm(display, {
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
        { id: 'baseURL', label: 'Base URL', required: true, hint: 'e.g. https://gateway.example.com/v1' },
        { id: 'key', label: 'API key', mask: true, required: true },
      ],
    })
    if (declared === undefined) return 'add provider cancelled'
    /* v8 ignore next 2 -- both fields are required, the fallbacks are
       exactOptionalPropertyTypes artifacts */
    const models = await collectModels(display, llm, ns, protocol, declared.baseURL ?? '', declared.key ?? '')
    if (models === undefined) return 'add provider cancelled'
    /* v8 ignore next -- same required-field artifacts */
    draft = { route: declared.route ?? '', protocol, baseURL: declared.baseURL, key: declared.key ?? '', models }
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
