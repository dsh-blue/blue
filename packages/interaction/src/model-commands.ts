/**
 * The model-family commands: `/model` (picker over the llm catalog with the
 * footer thinking-segment control, or a direct id switch), `/effort`
 * (horizontal segment selector or a direct level switch), and the shared
 * commit path they both funnel into — call the app-owned model action for
 * the next step's route and, unless session-only, persist the new
 * default through `agentDefaultModel.saveSelection`. The Alt+M hotkey
 * cycle (`cycleSessionModel`, matched in the editor key chain) funnels
 * into the same commit path on the session-only channel. The S23 seam
 * supplies the handle; this module never injects a display or harness
 * service, it resolves everything through `ctx.get` (the `/theme`
 * fiber-dispose trap).
 *
 * @module @dsh-blue/blue-interaction/model-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { BlueSessionReader } from '@dsh-blue/blue-api'
// Empty type imports carry the `llm` and `agentDefaultModel` Context merges
// plus the app-owned session-action merge this module reads.
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { BlueSessionActions, BlueSessionModelSelection } from '@dsh-blue/blue-app'
import type { Action } from '@dsh-blue/blue-frontend'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { CanonicalDocumentController } from './frontend-panel.ts'
import {
  effortPickerPanelModel,
  modelPickerPanelModel,
  type ModelPickerItem,
} from './model-picker-model.ts'
import { isProviderFlowError, runProviderAdd, runProviderEdit } from './provider-add.ts'
import { CanonicalSelectController, type SelectRow } from './select-list.ts'
import { CURRENT_MARK } from './symbols.ts'

/** Render one failure reason for an error result. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The `/provider` picker's trailing wizard row — routes Enter to the Add flow. */
const ADD_PROVIDER = '__add__'

/**
 * Read the live session's immutable model selection.
 * @param ctx - plugin context.
 * @returns the selection, or the guard's error text.
 */
function readSelection(
  reader: BlueSessionReader,
  actions: BlueSessionActions,
): { read: BlueSessionModelSelection } | { error: string } {
  if (reader.current() === null) {
    return { error: 'no session is live yet' }
  }
  const selection = actions.modelSelection()
  if (selection === undefined) {
    return { error: 'model selection is unavailable for this session' }
  }
  return { read: selection }
}

/**
 * Whether two selections agree on every field.
 * @param a - one selection.
 * @param b - the other selection.
 * @returns `true` when provider, model, and effort all match.
 */
function sameSelection(a: BlueSessionModelSelection, b: BlueSessionModelSelection): boolean {
  return a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort
}

/** How the persisted-default write went. */
export type ModelSaveState = 'saved' | 'skipped' | 'session-only' | 'unavailable' | 'failed'

/**
 * The model-switch notice family (the kimi five-state wording, folded to
 * Blue's notice channel): what changed, then how the default write went.
 * @param previous - the selection before the switch.
 * @param next - the selection after the switch.
 * @param saveState - the persisted-default outcome.
 * @param failureDetail - the save error's message, for the `failed` state.
 * @returns the single-line notice text.
 */
export function modelSwitchNotice(
  previous: BlueSessionModelSelection,
  next: BlueSessionModelSelection,
  saveState: ModelSaveState,
  failureDetail?: string,
): string {
  const modelChanged = previous.provider !== next.provider || previous.model !== next.model
  const effortChanged = previous.reasoningEffort !== next.reasoningEffort
  let base: string
  if (modelChanged) {
    base = `Switched to ${next.model} (${next.provider})`
    if (next.reasoningEffort !== undefined) base += ` · thinking ${String(next.reasoningEffort)}`
  } else if (effortChanged) {
    base = next.reasoningEffort === undefined
      ? 'Thinking set to provider default'
      : `Thinking set to ${String(next.reasoningEffort)}`
  } else {
    base = `Already using ${next.model} (${next.provider})`
  }
  switch (saveState) {
    case 'session-only':
      return `${base} · session only`
    case 'unavailable':
      return `${base} — default not saved: no default-model service`
    case 'failed':
      /* v8 ignore next -- the catch always passes describe(error) */
      return `${base} — failed to save default: ${failureDetail ?? 'unknown error'}`
    default:
      return base
  }
}

/**
 * Commit one selection through the app-owned action and, unless
 * session-only, persist the new default.
 * @param ctx - plugin context (`agentDefaultModel` resolved lazily).
 * @param next - the selection to commit.
 * @param persist - `false` for the Alt+S session-only channel.
 * @returns the notice text describing the outcome.
 */
async function commitModelSelection(
  ctx: Context,
  actions: BlueSessionActions,
  next: BlueSessionModelSelection,
  persist: boolean,
): Promise<string> {
  const selected = actions.selectModel(next)
  if (!selected.ok) return selected.message
  const previous = selected.value
  if (!persist) return modelSwitchNotice(previous, next, 'session-only')
  const defaults = ctx.get('agentDefaultModel')
  if (defaults === undefined) return modelSwitchNotice(previous, next, 'unavailable')
  if (sameSelection(next, defaults.currentSelection())) {
    return modelSwitchNotice(previous, next, 'skipped')
  }
  try {
    await defaults.saveSelection({
      provider: next.provider,
      model: next.model,
      ...(next.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: ReasoningEffortId(next.reasoningEffort) }),
    })
    return modelSwitchNotice(previous, next, 'saved')
  } catch (error) {
    return modelSwitchNotice(previous, next, 'failed', describe(error))
  }
}

/** The llm surface the display-name helper reads. */
interface ListingLlm {
  listProviders(): { id: string, name: string }[]
}

/** How long a hotkey cycle trusts a cached provider model listing. */
const MODEL_CACHE_TTL_MS = 60_000

/** The cached provider model listing behind the Alt+M cycle. */
interface ModelListCacheValue {
  readonly provider: string
  readonly ids: string[]
  readonly fetchedAt: number
}

/** Fiber-owned cache state for the Alt+M model cycle. */
export interface ModelListCache {
  value?: ModelListCacheValue
}

/** Create empty cache state for one input-plugin Fiber. */
export function createModelListCache(): ModelListCache {
  return {}
}

/**
 * The provider's advertised model ids for the hotkey cycle, cached
 * briefly: `llm.listModels` can be a network round on discovery-based
 * routes, and a hotkey pressed in rhythm must not re-issue it per press.
 * A failed listing never poisons the cache — the next press retries.
 * @param ctx - plugin context (`llm` resolved lazily).
 * @param provider - the provider route to list.
 * @returns the advertised model ids, or the guard's error text.
 */
async function providerModelIds(
  ctx: Context,
  provider: string,
  cache: ModelListCache,
): Promise<{ ids: string[] } | { error: string }> {
  const cached = cache.value
  if (cached !== undefined && cached.provider === provider
    && Date.now() - cached.fetchedAt < MODEL_CACHE_TTL_MS) {
    return { ids: cached.ids }
  }
  const llm = ctx.get('llm')
  if (llm === undefined) return { error: 'the llm service is unavailable' }
  try {
    const models = await llm.listModels(provider)
    const ids = models.map(model => model.id)
    cache.value = { provider, ids, fetchedAt: Date.now() }
    return { ids }
  } catch (error) {
    return { error: `could not list the provider's models: ${describe(error)}` }
  }
}

/**
 * Cycle the session model within the current provider — the Alt+M hotkey.
 * The next advertised model commits through the session-only channel: the
 * persisted default stays untouched (a deliberate one-press switch must
 * not rewrite configuration — `/model` is the durable path), and the
 * reasoning effort is not carried, matching the `/model <id>` direct
 * switch (the cycled model uses its provider default). The press never
 * reaches the Editor, so the typed draft is intact by construction.
 * @param ctx - plugin context.
 */
export async function cycleSessionModel(ctx: Context, cache: ModelListCache): Promise<void> {
  const reader = ctx.blueSessionReader
  const actions = ctx.blueSessionActions
  const selection = readSelection(reader, actions)
  if ('error' in selection) {
    getSharedEditor(ctx)?.notice?.(selection.error)
    return
  }
  const currentSelection = selection.read
  const listing = await providerModelIds(ctx, currentSelection.provider, cache)
  if ('error' in listing) {
    const paint = displayServices(ctx)?.colors.error
    getSharedEditor(ctx)?.notice?.(paint === undefined ? listing.error : paint(listing.error))
    return
  }
  if (listing.ids.length === 0) {
    getSharedEditor(ctx)?.notice?.('the current provider advertises no models')
    return
  }
  const current = currentSelection.model
  const index = listing.ids.indexOf(current)
  const next = listing.ids[index === -1 ? 0 : (index + 1) % listing.ids.length]!
  try {
    const text = await commitModelSelection(
      ctx,
      actions,
      { provider: currentSelection.provider, model: next },
      false,
    )
    getSharedEditor(ctx)?.notice?.(text)
  } catch (error) {
    /* v8 ignore next -- the catch guards only the append-failure loud path
       (the cycleMode discipline); commitModelSelection itself never throws
       on the session-only channel */
    ctx.logger.warn(`model cycle commit failed: ${describe(error)}`)
  }
}

/**
 * The provider's display name for row labels, falling back to its id.
 * @param llm - the llm service.
 * @param id - the provider route id.
 * @returns the display name.
 */
function providerDisplayName(llm: ListingLlm, id: string): string {
  const name = llm.listProviders().find(provider => provider.id === id)?.name
  return name !== undefined && name.length > 0 ? name : id
}

/** The catalog rows with their resolved metadata, or the guard's error text. */
type CatalogResult = { items: ModelPickerItem[] } | { error: string }

/**
 * Collect the advertised models across the configured providers, attaching
 * each row's resolved context window and reasoning efforts. A provider
 * whose catalog listing fails is skipped (the catalog is advisory); a
 * metadata lookup that fails leaves the row without suffixes.
 * @param ctx - plugin context (`llm` resolved lazily).
 * @param signal - the dispatching UI request's cancellation signal.
 * @returns the rows, or the guard's error text.
 */
async function catalogRows(
  ctx: Context,
  signal: AbortSignal,
  filterProvider?: string,
): Promise<CatalogResult> {
  const llm = ctx.get('llm')
  if (llm === undefined) return { error: 'the llm service is unavailable' }
  const providers = llm.listProviders()
  /* v8 ignore next 3 -- callers pass routes taken from listProviders; the
     guard only trips when a route vanishes between the listing and here */
  if (filterProvider !== undefined && !providers.some(provider => provider.id === filterProvider)) {
    return { error: `provider "${filterProvider}" is not registered` }
  }
  // The row label renders `Provider Name/model` (the dogfood ruling), so
  // the display names ride along from the provider listing.
  const providerLabel = (id: string): string => providerDisplayName(llm, id)
  const rows: { provider: string, id: string, name: string }[] = []
  for (const provider of providers) {
    if (filterProvider !== undefined && provider.id !== filterProvider) continue
    try {
      const models = await llm.listModels(provider.id)
      for (const model of models) {
        rows.push({ provider: provider.id, id: model.id, name: model.name.length > 0 ? model.name : model.id })
      }
    } catch {
      // A provider whose catalog cannot be listed simply contributes no rows.
    }
  }
  const infos = await Promise.allSettled(
    rows.map(row => llm.resolveModelInfo(row.provider, row.id, signal)),
  )
  const items = rows.map((row, index) => {
    const info = infos[index]?.status === 'fulfilled' ? infos[index].value : undefined
    const reasoning = info?.reasoning
    const efforts = reasoning !== undefined && reasoning.efforts.length > 0
      ? reasoning.efforts.map(effort => String(effort.id))
      : undefined
    return {
      ...row,
      providerLabel: providerLabel(row.provider),
      ...(info?.context?.contextWindow !== undefined
        ? { contextWindow: info.context.contextWindow }
        : {}),
      ...(efforts !== undefined ? { efforts } : {}),
      ...(reasoning?.defaultEffort !== undefined
        ? { defaultEffort: String(reasoning.defaultEffort) }
        : {}),
    } satisfies ModelPickerItem
  })
  return { items }
}

/**
 * Register the model-family commands (`/model`, `/effort`) on
 * `ctx.commands`.
 * @param ctx - plugin context.
 * @returns the disposer removing both registrations and the alias relation.
 */
export function registerModelCommands(ctx: Context): () => void {
  const reader = ctx.blueSessionReader
  const actions = ctx.blueSessionActions
  /**
   * Set when this fiber unloads: the catalog awaits can still be in flight
   * (a tree unload lands between `listModels` and the panel mount), and the
   * continuation must not reach for services through the dead context.
   */
  let unloaded = false
  const stopUnloaded = ctx.effect(() => () => {
    unloaded = true
  })

  /**
   * Open the model picker over the catalog, optionally scoped to one
   * provider route (`/provider` switch and the post-add step reuse this).
   * @param signal - a cancellation signal for the catalog awaits.
   * @param filterProvider - restrict the rows to one provider route.
   * @returns the command outcome.
   */
  async function openModelPicker(signal: AbortSignal, filterProvider?: string): Promise<CommandResult> {
    const llm = ctx.get('llm')
    const selection = readSelection(reader, actions)
    if ('error' in selection) return { kind: 'error', text: selection.error }
    const current = selection.read
    // A freshly added route registers asynchronously on the real host —
    // the settings file's watcher fires the update pi-ai reacts to, which
    // can land a beat after the wizard's writes resolve (the first
    // real-terminal dogfood hit exactly this). Poll briefly instead of
    // failing the picker on the gap.
    if (filterProvider !== undefined && llm !== undefined) {
      const deadline = Date.now() + 2000
      while (!llm.listProviders().some(provider => provider.id === filterProvider)) {
        /* v8 ignore next -- the deadline and unload exits both return
           quietly; the interesting path is the registration landing */
        if (Date.now() >= deadline || unloaded) return { kind: 'success' }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    const catalog = await catalogRows(ctx, signal, filterProvider)
    /* v8 ignore next -- the llm guard ran in the calling handler; the
       service cannot vanish mid-catalog on a live tree */
    if ('error' in catalog) return { kind: 'error', text: catalog.error }
    if (unloaded) return { kind: 'success' }
    if (catalog.items.length === 0) {
      return {
        kind: 'success',
        text: filterProvider === undefined
          ? 'no models advertised for the configured providers'
          : `provider "${filterProvider}" advertises no models`,
      }
    }
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: 'model picker is unavailable: the Blue screen is not mounted' }
    }
    const applySwitch = (provider: string, model: string, effort: string | undefined, persist: boolean): void => {
      void (async () => {
        const text = await commitModelSelection(
          ctx,
          actions,
          {
            provider,
            model,
            ...(effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) }),
          },
          persist,
        )
        if (!unloaded) getSharedEditor(ctx)?.notice?.(text)
      })()
    }
    const model = modelPickerPanelModel(catalog.items.map(item => ({
        ...item,
        current: item.provider === current.provider && item.id === current.model,
      })), {
      ...(current.reasoningEffort !== undefined
        ? { currentEffort: String(current.reasoningEffort) }
        : {}),
      ...(actions.hasRequestHeader()
        ? { warning: 'switching models starts a fresh prompt cache' }
        : {}),
      ...(filterProvider !== undefined
        /* v8 ignore next -- the poll above already established the llm
           service for a scoped picker */
        ? { title: `Select a model · ${providerDisplayName(llm!, filterProvider)}` }
        : {}),
    })
    const execute = (action: Action): void => {
      if (action.kind !== 'model.select') return
      const provider = typeof action.provider === 'string' ? action.provider : undefined
      const nextModel = typeof action.model === 'string' ? action.model : undefined
      if (provider === undefined || nextModel === undefined) return
      const effort = typeof action.effort === 'string' ? action.effort : undefined
      const persist = action.persist !== false
      restore()
      applySwitch(provider, nextModel, effort, persist)
    }
    const panel = new CanonicalDocumentController({
      ...display,
      model: () => model,
      onAction: execute,
      onClose: () => {
        restore()
      },
    })
    // The kimi dialog mount (D30): the panel replaces the editor in its
    // dock slot, so below it only the footer remains.
    const restore = mountEditorReplacement(ctx, panel)
    return { kind: 'success' }
  }

  /**
   * The `/model` handler: no argument opens the picker over the catalog
   * with each row's context metadata and the footer thinking control; an
   * argument switches straight to that model id (the live provider's match
   * wins an ambiguity).
   * @param rawInput - the command's argument text.
   * @param signal - the dispatching UI request's cancellation signal.
   * @returns the command outcome.
   */
  async function switchModel(rawInput: string, signal: AbortSignal): Promise<CommandResult> {
    const selection = readSelection(reader, actions)
    if ('error' in selection) return { kind: 'error', text: selection.error }
    const current = selection.read
    const catalog = await catalogRows(ctx, signal)
    if ('error' in catalog) return { kind: 'error', text: catalog.error }
    if (unloaded) return { kind: 'success' }
    const argument = rawInput.trim()
    if (argument !== '') {
      const exact = catalog.items.filter(item => item.id === argument)
      if (exact.length === 0) {
        return { kind: 'error', text: `unknown model: ${argument}` }
      }
      const chosen = exact.length === 1
        ? exact[0]
        : exact.find(item => item.provider === current.provider)
      if (chosen === undefined) {
        return {
          kind: 'error',
          text: `ambiguous model id: ${argument} (${exact.map(item => `${item.provider}/${item.id}`).join(', ')})`,
        }
      }
      const text = await commitModelSelection(
        ctx,
        actions,
        { provider: chosen.provider, model: chosen.id },
        true,
      )
      return { kind: 'success', text }
    }
    return openModelPicker(signal)
  }

  /**
   * The `/effort` handler: no argument opens the horizontal segment
   * selector over the current model's reasoning efforts; an argument
   * switches straight to that level (`default` restores the provider
   * default).
   * @param rawInput - the command's argument text.
   * @param signal - the dispatching UI request's cancellation signal.
   * @returns the command outcome.
   */
  async function switchEffort(rawInput: string, signal: AbortSignal): Promise<CommandResult> {
    const selection = readSelection(reader, actions)
    if ('error' in selection) return { kind: 'error', text: selection.error }
    const current = selection.read
    const llm = ctx.get('llm')
    if (llm === undefined) return { kind: 'error', text: 'the llm service is unavailable' }
    let info
    try {
      info = await llm.resolveModelInfo(current.provider, current.model, signal)
    } catch (error) {
      return { kind: 'error', text: `could not resolve the current model: ${describe(error)}` }
    }
    if (unloaded) return { kind: 'success' }
    const efforts = info.reasoning?.efforts ?? []
    if (efforts.length === 0) {
      return { kind: 'error', text: 'the current model exposes no reasoning efforts' }
    }
    const argument = rawInput.trim()
    if (argument === '') {
      const display = displayServices(ctx)
      if (display === undefined) {
        return { kind: 'error', text: 'effort selector is unavailable: the Blue screen is not mounted' }
      }
      const segments = [
        { id: 'default', label: 'Default' },
        ...efforts.map(effort => ({ id: String(effort.id), label: String(effort.name) })),
      ]
      const currentId = current.reasoningEffort === undefined ? undefined : String(current.reasoningEffort)
      const activeId = segments.some(segment => segment.id === currentId) ? currentId : 'default'
      const applyEffort = (id: string, persist: boolean): void => {
        void (async () => {
          const text = await commitModelSelection(
            ctx,
            actions,
            {
              provider: current.provider,
              model: current.model,
              ...(id === 'default' ? {} : { reasoningEffort: ReasoningEffortId(id) }),
            },
            persist,
          )
          if (!unloaded) getSharedEditor(ctx)?.notice?.(text)
        })()
      }
      const model = effortPickerPanelModel(segments, activeId)
      const panel = new CanonicalDocumentController({
        ...display,
        model: () => model,
        onAction: (action) => {
          if (action.kind !== 'effort.select') return
          const id = typeof action.effort === 'string' ? action.effort : 'default'
          restore()
          applyEffort(id, action.persist !== false)
        },
        onClose: () => {
          restore()
        },
      })
      const restore = mountEditorReplacement(ctx, panel)
      return { kind: 'success' }
    }
    if (argument === 'default') {
      const text = await commitModelSelection(
        ctx,
        actions,
        { provider: current.provider, model: current.model },
        true,
      )
      return { kind: 'success', text }
    }
    const normalized = argument.toLowerCase()
    const match = efforts.find(effort =>
      String(effort.id).toLowerCase() === normalized
      || effort.name.toLowerCase() === normalized)
    if (match === undefined) {
      return {
        kind: 'error',
        text: `unsupported thinking effort "${argument}" for ${current.model}: available: default, ${efforts.map(effort => String(effort.id)).join(', ')}`,
      }
    }
    const text = await commitModelSelection(
      ctx,
      actions,
      {
        provider: current.provider,
        model: current.model,
        reasoningEffort: ReasoningEffortId(String(match.id)),
      },
      true,
    )
    return { kind: 'success', text }
  }

  /**
   * Open the scoped model picker from a fire-and-forget call site (the
   * provider panel, the post-add step) and flash its outcome through the
   * notice channel.
   * @param route - the provider route to scope to.
   */
  /** Paint a provider-flow outcome: failures flash error-red. */
  function paintFlowOutcome(display: { colors: { error(text: string): string } }, text: string): string {
    return isProviderFlowError(text) ? display.colors.error(text) : text
  }

  function pickModels(route: string): void {
    void (async () => {
      await openModelPicker(new AbortController().signal, route)
    })()
  }

  /**
   * The `/provider` handler: no argument opens the provider panel (active
   * routes with `← current`, dormant catalog vendors with
   * `· not configured`, and the `+ Add provider` CTA); `switch <name>`
   * opens the scoped model picker over that route's models (the picked
   * model commits provider and model together); `add` runs the wizard.
   * @param rawInput - the command's argument text.
   * @param signal - the dispatching UI request's cancellation signal.
   * @returns the command outcome.
   */
  async function manageProvider(rawInput: string, signal: AbortSignal): Promise<CommandResult> {
    const argument = rawInput.trim()
    const llm = ctx.get('llm')
    if (llm === undefined) return { kind: 'error', text: 'the llm service is unavailable' }
    if (argument === 'add') {
      const display = displayServices(ctx)
      if (display === undefined) {
        return { kind: 'error', text: 'provider wizard is unavailable: the Blue screen is not mounted' }
      }
      const text = await runProviderAdd(ctx, display, pickModels)
      return { kind: isProviderFlowError(text) ? 'error' : 'success', text }
    }
    if (argument.split(/\s+/)[0] === 'switch') {
      const name = argument.slice('switch'.length).trim()
      if (name.length === 0) return { kind: 'error', text: 'usage: /provider switch <name>' }
      const lowered = name.toLowerCase()
      const providers = llm.listProviders()
      const match = providers.find(provider => provider.id.toLowerCase() === lowered)
        ?? providers.find(provider => provider.name.toLowerCase() === lowered)
      if (match === undefined) {
        return {
          kind: 'error',
          text: `unknown provider: ${name} (registered: ${providers.map(provider => provider.id).join(', ')})`,
        }
      }
      return openModelPicker(signal, match.id)
    }
    if (argument !== '') {
      return { kind: 'error', text: 'usage: /provider [list | switch <name> | add]' }
    }
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: 'provider picker is unavailable: the Blue screen is not mounted' }
    }
    // The pane lists the configured routes only — dormant catalog vendors
    // live behind the Add wizard's known-provider branch. The trailing CTA
    // row routes to the wizard (the shared list panel's uniform row shape,
    // S24b: the CTA windows and wraps like any other row).
    const selection = readSelection(reader, actions)
    const currentProvider = 'error' in selection ? '' : selection.read.provider
    const rows: SelectRow[] = llm.listProviders().map(provider => ({
      value: provider.id,
      label: provider.name.length > 0 ? provider.name : provider.id,
      ...(provider.id === currentProvider ? { badge: CURRENT_MARK } : {}),
    }))
    rows.push({ value: ADD_PROVIDER, label: '+ Add provider' })
    const panel = new CanonicalSelectController({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      rows,
      title: 'Providers',
      onSelect: row => {
        restore()
        void (async () => {
          const text = row.value === ADD_PROVIDER
            ? await runProviderAdd(ctx, display, pickModels)
            : await runProviderEdit(ctx, display, row.value)
          /* v8 ignore next -- cordis disposal kills the continuation on a
             dead context before the notice could fire */
          if (!unloaded) getSharedEditor(ctx)?.notice?.(paintFlowOutcome(display, text))
        })()
      },
      onCancel: () => {
        restore()
      },
    })
    const restore = mountEditorReplacement(ctx, panel)
    return { kind: 'success' }
  }

  const model = ctx.commands.register({
    name: 'model',
    description: 'Switch the session model (no argument opens the picker)',
    input: { hint: '[name]' },
    handler: invocation => switchModel(invocation.rawInput, invocation.signal),
  })
  const effort = ctx.commands.register({
    name: 'effort',
    description: 'Switch the thinking effort of the current model',
    input: { hint: '[level]' },
    handler: invocation => switchEffort(invocation.rawInput, invocation.signal),
  })
  const provider = ctx.commands.register({
    name: 'provider',
    description: 'List providers, switch the route, or add one',
    input: { hint: '[list | switch <provider> | add]' },
    handler: invocation => manageProvider(invocation.rawInput, invocation.signal),
  })
  // The kimi alias: `/thinking` is not a separate registration — the input
  // layer rewrites it to `/effort` before `ctx.commands.execute`.
  const effortAliases = ctx.blueInteractionState.aliases.register('effort', ['thinking'])
  return () => {
    model()
    effort()
    provider()
    effortAliases()
    stopUnloaded()
  }
}
