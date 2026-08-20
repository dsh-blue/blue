/**
 * The model-family commands: `/model` (picker over the llm catalog with the
 * footer thinking-segment control, or a direct id switch), `/effort`
 * (horizontal segment selector or a direct level switch), and the shared
 * commit path they both funnel into — write `blueSession.modelRef.current`
 * (the next step's route) plus, unless session-only, persist the new
 * default through `agentDefaultModel.saveSelection`. The S23 seam supplies
 * the handle; this module never injects a display or harness service, it
 * resolves everything through `ctx.get` (the `/theme` fiber-dispose trap).
 *
 * @module @dsh-blue/blue-interaction/model-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
// Empty type imports carry the `llm` and `agentDefaultModel` Context merges
// plus the app-owned `blueSession` merge this module reads.
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { BlueModelSelectionRef } from '@dsh-blue/blue-app'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { registerCommandAliases } from './command-meta.ts'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { EffortPanel, ModelPanel, type ModelPanelItem } from './model-panel.ts'

/** Render one failure reason for an error result. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The live-session reads every model command starts from. */
interface SelectionRead {
  readonly agent: Agent
  readonly modelRef: BlueModelSelectionRef
}

/**
 * Read the live session and its model-selection handle.
 * @param ctx - plugin context.
 * @returns the agent plus handle, or the guard's error text.
 */
function readSelection(ctx: Context): { read: SelectionRead } | { error: string } {
  const session = ctx.get('blueSession')
  const agent = session?.current
  if (session === undefined || agent === undefined || agent === null) {
    return { error: 'no session is live yet' }
  }
  const modelRef = session.modelRef
  if (modelRef === undefined) {
    return { error: 'model selection is unavailable for this session' }
  }
  return { read: { agent, modelRef } }
}

/**
 * Whether two selections agree on every field.
 * @param a - one selection.
 * @param b - the other selection.
 * @returns `true` when provider, model, and effort all match.
 */
function sameSelection(a: ModelSelection, b: ModelSelection): boolean {
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
  previous: ModelSelection,
  next: ModelSelection,
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
 * Commit one selection: route the next step through `modelRef.current` and,
 * unless session-only, persist the new default.
 * @param ctx - plugin context (`agentDefaultModel` resolved lazily).
 * @param modelRef - the live session's selection handle.
 * @param next - the selection to commit.
 * @param persist - `false` for the Alt+S session-only channel.
 * @returns the notice text describing the outcome.
 */
async function commitModelSelection(
  ctx: Context,
  modelRef: BlueModelSelectionRef,
  next: ModelSelection,
  persist: boolean,
): Promise<string> {
  const previous = modelRef.current
  modelRef.current = next
  if (!persist) return modelSwitchNotice(previous, next, 'session-only')
  const defaults = ctx.get('agentDefaultModel')
  if (defaults === undefined) return modelSwitchNotice(previous, next, 'unavailable')
  if (sameSelection(next, defaults.currentSelection())) {
    return modelSwitchNotice(previous, next, 'skipped')
  }
  try {
    await defaults.saveSelection(next)
    return modelSwitchNotice(previous, next, 'saved')
  } catch (error) {
    return modelSwitchNotice(previous, next, 'failed', describe(error))
  }
}

/** The catalog rows with their resolved metadata, or the guard's error text. */
type CatalogResult = { items: ModelPanelItem[] } | { error: string }

/**
 * Collect the advertised models across the configured providers, attaching
 * each row's resolved context window and reasoning efforts. A provider
 * whose catalog listing fails is skipped (the catalog is advisory); a
 * metadata lookup that fails leaves the row without suffixes.
 * @param ctx - plugin context (`llm` resolved lazily).
 * @param signal - the dispatching UI request's cancellation signal.
 * @returns the rows, or the guard's error text.
 */
async function catalogRows(ctx: Context, signal: AbortSignal): Promise<CatalogResult> {
  const llm = ctx.get('llm')
  if (llm === undefined) return { error: 'the llm service is unavailable' }
  const rows: { provider: string, id: string, name: string }[] = []
  for (const provider of llm.listProviders()) {
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
      ...(info?.context?.contextWindow !== undefined
        ? { contextWindow: info.context.contextWindow }
        : {}),
      ...(efforts !== undefined ? { efforts } : {}),
      ...(reasoning?.defaultEffort !== undefined
        ? { defaultEffort: String(reasoning.defaultEffort) }
        : {}),
    } satisfies ModelPanelItem
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
   * The `/model` handler: no argument opens the picker over the catalog
   * with each row's context metadata and the footer thinking control; an
   * argument switches straight to that model id (the live provider's match
   * wins an ambiguity).
   * @param rawInput - the command's argument text.
   * @param signal - the dispatching UI request's cancellation signal.
   * @returns the command outcome.
   */
  async function switchModel(rawInput: string, signal: AbortSignal): Promise<CommandResult> {
    const selection = readSelection(ctx)
    if ('error' in selection) return { kind: 'error', text: selection.error }
    const { agent, modelRef } = selection.read
    const catalog = await catalogRows(ctx, signal)
    if ('error' in catalog) return { kind: 'error', text: catalog.error }
    if (unloaded) return { kind: 'success' }
    const argument = rawInput.trim()
    const current = modelRef.current
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
        modelRef,
        { provider: chosen.provider, model: chosen.id },
        true,
      )
      return { kind: 'success', text }
    }
    if (catalog.items.length === 0) {
      return { kind: 'success', text: 'no models advertised for the configured providers' }
    }
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: 'model picker is unavailable: the Blue screen is not mounted' }
    }
    const applySwitch = (item: ModelPanelItem, effort: string | undefined, persist: boolean): void => {
      void (async () => {
        const text = await commitModelSelection(
          ctx,
          modelRef,
          {
            provider: item.provider,
            model: item.id,
            ...(effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) }),
          },
          persist,
        )
        if (!unloaded) getSharedEditor()?.notice?.(text)
      })()
    }
    const panel = new ModelPanel({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      items: catalog.items.map(item => ({
        ...item,
        current: item.provider === current.provider && item.id === current.model,
      })),
      ...(current.reasoningEffort !== undefined
        ? { currentEffort: String(current.reasoningEffort) }
        : {}),
      ...(agent.session.requestHeader() !== undefined
        ? { warning: 'switching models starts a fresh prompt cache' }
        : {}),
      onSelect: (item, effort) => {
        restore()
        applySwitch(item, effort, true)
      },
      onSessionOnlySelect: (item, effort) => {
        restore()
        applySwitch(item, effort, false)
      },
      onCancel: () => {
        restore()
      },
    })
    // The kimi dialog mount (D30): the panel replaces the editor in its
    // dock slot, so below it only the footer remains.
    const restore = mountEditorReplacement(panel)
    return { kind: 'success' }
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
    const selection = readSelection(ctx)
    if ('error' in selection) return { kind: 'error', text: selection.error }
    const { modelRef } = selection.read
    const llm = ctx.get('llm')
    if (llm === undefined) return { kind: 'error', text: 'the llm service is unavailable' }
    const current = modelRef.current
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
      const activeIndex = Math.max(0, segments.findIndex(segment => segment.id === currentId))
      const applyEffort = (id: string, persist: boolean): void => {
        void (async () => {
          const text = await commitModelSelection(
            ctx,
            modelRef,
            {
              provider: current.provider,
              model: current.model,
              ...(id === 'default' ? {} : { reasoningEffort: ReasoningEffortId(id) }),
            },
            persist,
          )
          if (!unloaded) getSharedEditor()?.notice?.(text)
        })()
      }
      const panel = new EffortPanel({
        keymap: display.keymap,
        theme: display.theme,
        segments,
        activeIndex,
        onSelect: (id) => {
          restore()
          applyEffort(id, true)
        },
        onSessionOnlySelect: (id) => {
          restore()
          applyEffort(id, false)
        },
        onCancel: () => {
          restore()
        },
      })
      const restore = mountEditorReplacement(panel)
      return { kind: 'success' }
    }
    if (argument === 'default') {
      const text = await commitModelSelection(
        ctx,
        modelRef,
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
      modelRef,
      {
        provider: current.provider,
        model: current.model,
        reasoningEffort: ReasoningEffortId(String(match.id)),
      },
      true,
    )
    return { kind: 'success', text }
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
  // The kimi alias: `/thinking` is not a separate registration — the input
  // layer rewrites it to `/effort` before `ctx.commands.execute`.
  const effortAliases = registerCommandAliases('effort', ['thinking'])
  return () => {
    model()
    effort()
    effortAliases()
    stopUnloaded()
  }
}
