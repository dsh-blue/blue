/**
 * `/update` (D52): the in-app safe upgrade. The flow is the ADR's whole
 * spine — busy guard (plus a frontend-tree in-flight guard against a
 * second concurrent run), registry read (metadata, never dist-tag
 * resolution) with progress notices in the editor hint line, the
 * pre-flight gates, a typed `y` confirm, then the
 * swap executor behind a step panel (`check ✓ / snapshot ✓ / installing…
 * / verify ✓ / smoke: imports ✓ / smoke: boot…`) where Escape is ignored
 * while the install or smoke is in flight (closing mid-swap is the one
 * dangerous action) and the settled panel carries the outcome, the
 * rollback rows, and the log path. Bare `/update` doubles as the
 * read-only check: an up-to-date tree answers without touching
 * anything; `/update <version>` pins an explicit target.
 *
 * @module @dsh-blue/blue-interaction/update-command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { BLUE_VERSION } from '@dsh-blue/blue-api'
import type { BlueComponents, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import type { PanelModel, View } from '@dsh-blue/blue-frontend'
import { join } from 'node:path'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { FormPanel } from './form-panel.ts'
import { FrontendPanel } from './frontend-panel.ts'
import type { UpdateSettings } from './updater/check.ts'
import { writeUpdateCheckState } from './updater/check.ts'
import { updaterInternals } from './updater/io.ts'
import { backupDir, findDshBin, profileNameFromArgv, profileRoot, readProfileFacts } from './updater/profile.ts'
import {
  BUNDLE_PACKAGE,
  fetchPackument,
  publishedAt,
  releaseFacts,
} from './updater/registry.ts'
import { resolveOffer, runPreflight } from './updater/preflight.ts'
import { performSwap, type SwapOutcome, type SwapProgress, type SwapStep } from './updater/swap.ts'
import { isVersion } from './updater/version.ts'
import type {} from '@dsh-blue/blue-app'

/** The step rows the panel renders, in execution order. */
const STEP_ROWS: readonly { step: SwapStep, label: string }[] = [
  { step: 'snapshot', label: 'snapshot' },
  { step: 'install', label: 'install' },
  { step: 'verify', label: 'verify versions' },
  { step: 'smoke-imports', label: 'smoke: imports' },
  { step: 'smoke-boot', label: 'smoke: boot' },
  { step: 'rollback', label: 'rollback' },
]

/** Renderer-neutral state behind the generic update panel model. */
export interface UpdateProgressState {
  readonly steps: Map<SwapStep, 'start' | 'ok' | 'fail'>
  outcome?: SwapOutcome
  blockedMessage?: string
}

/** Create empty progress state for one update attempt. */
export function createUpdateProgressState(): UpdateProgressState {
  return { steps: new Map() }
}

/** Fold one swap progress fact into the model state. */
export function applyUpdateProgress(state: UpdateProgressState, progress: SwapProgress): void {
  state.steps.set(progress.step, progress.state)
}

/** Project update progress and outcome into the shared panel vocabulary. */
export function updatePanelModel(
  state: UpdateProgressState,
  fromVersion: string,
  toVersion: string,
): PanelModel {
  const settled = state.outcome !== undefined || state.blockedMessage !== undefined
  const stepItems = STEP_ROWS.flatMap(row => {
    const value = state.steps.get(row.step)
    if (value === undefined && row.step === 'rollback') return []
    const mark = value === 'ok' ? '✓' : value === 'fail' ? '✗' : value === 'start' ? '…' : '·'
    return [{ id: row.step, label: `${mark} ${row.label}`, disabled: true }]
  })
  const sections: Array<{ title: string, body: View }> = [{
    title: `v${fromVersion} → v${toVersion}`,
    body: { kind: 'list', items: stepItems },
  }]
  if (state.outcome !== undefined) {
    sections.push({
      title: state.outcome.kind === 'success' ? 'Complete' : 'Failed',
      body: { kind: 'sections', sections: [
        { title: 'Message', body: { kind: 'text', text: state.outcome.message } },
        { title: 'Log', body: { kind: 'text', text: `log: ${state.outcome.logPath}`, tone: 'muted' } },
      ] },
    })
  }
  if (state.blockedMessage !== undefined) {
    sections.push({
      title: 'Blocked',
      body: { kind: 'sections', sections: [
        { title: 'Reason', body: { kind: 'text', text: state.blockedMessage, tone: 'danger' } },
        { title: 'Status', body: { kind: 'text', text: 'nothing was changed', tone: 'muted' } },
      ] },
    })
  }
  return {
    kind: 'panel',
    mode: !settled ? 'loading' : state.outcome?.kind === 'success' ? 'info' : 'error',
    title: 'Update Blue',
    view: { kind: 'sections', sections },
    dismissible: settled,
  }
}

/** One-line notice emitted when the settled panel closes. */
export function updatePanelSummary(state: UpdateProgressState): string {
  const outcome = state.outcome
  if (outcome === undefined) return state.blockedMessage === undefined ? 'update panel closed' : 'update blocked — nothing was changed'
  return outcome.kind === 'success'
    ? `updated to v${outcome.toVersion} — restart dsh to apply`
    : `update did not complete (${outcome.kind}) — log: ${outcome.logPath}`
}

/** The display services slice the confirm form needs. */
interface Display {
  readonly theme: BlueTheme
  readonly components: BlueComponents
  readonly keymap: BlueKeymap
}

/**
 * Mount the typed-`y` confirm form (the provider-delete precedent) and
 * await the answer.
 * @param display - the display services.
 * @param fromVersion - the running version.
 * @param toVersion - the target version.
 * @param detail - the subtitle detail line (publish age, host line).
 * @returns whether the user confirmed.
 */
function confirmUpdate(ctx: Context, display: Display, fromVersion: string, toVersion: string, detail: string): Promise<boolean> {
  // A second resolve is a Promise no-op, and a second slot restore is
  // idempotent, so submit and cancel racing needs no guard.
  return new Promise(resolve => {
    const done = (value: boolean): void => {
      restore()
      resolve(value)
    }
    const panel = new FormPanel({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      title: 'Update Blue',
      subtitle: [`v${fromVersion} → v${toVersion}`, detail].join(' · ').replace(/ · $/, ''),
      fields: [
        {
          id: 'yes',
          label: `Update to v${toVersion}?`,
          required: true,
          hint: 'type y to update · esc cancels · a boot smoke runs before the change is kept',
          validate: value => value.toLowerCase() === 'y' ? undefined : 'type y to confirm, or Esc to cancel',
        },
      ],
      onSubmit: values => done(String(values.yes).toLowerCase() === 'y'),
      onCancel: () => done(false),
    })
    const restore = mountEditorReplacement(ctx, panel)
  })
}

/**
 * Mount the progress panel and run the swap behind it; resolves when the
 * swap settles (the panel stays readable until the user closes it).
 * @param ctx - plugin context (for the default-model boot marker).
 * @param display - the display services.
 * @param input - the swap parameters.
 * @returns the swap outcome.
 */
async function runSwapPanel(
  ctx: Context,
  display: NonNullable<ReturnType<typeof displayServices>>,
  input: {
    readonly root: string
    readonly profile: string
    readonly dshBin: string
    readonly fromVersion: string
    readonly toVersion: string
    readonly packageNames: readonly string[]
    readonly rollbackNames: readonly string[]
  },
): Promise<SwapOutcome> {
  const bootMarker = ctx.get('agentDefaultModel')?.currentSelection().model
  const state = createUpdateProgressState()
  let restore: () => void
  const panel = new FrontendPanel({
    ...display,
    model: () => updatePanelModel(state, input.fromVersion, input.toVersion),
    onAction: () => undefined,
    onClose: () => {
      restore()
      getSharedEditor(ctx)?.notice?.(updatePanelSummary(state))
    },
  })
  restore = mountEditorReplacement(ctx, panel)
  // A throw out of the executor (ENOSPC mid-rename, a crashed spawn
  // wrapper) must still settle the panel — an unsettled panel refuses to
  // close and would strand the editor replacement forever.
  let outcome: SwapOutcome
  try {
    outcome = await performSwap({
      ...input,
      ...(bootMarker !== undefined ? { bootMarker } : {}),
      onProgress: progress => {
        applyUpdateProgress(state, progress)
        display.screen.requestRender()
      },
    })
  } catch (error) {
    outcome = {
      kind: 'failed-no-rollback',
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      message: `the swap crashed: ${error instanceof Error ? error.message : String(error)}\nthe profile may be in a mixed state — the snapshot is at ${backupDir(input.root)}`,
      logPath: join(backupDir(input.root), 'update.log'),
    }
  }
  state.outcome = outcome
  display.screen.requestRender()
  return outcome
}

/** The channel the command follows: the `blue` settings section's value. */
function updateChannelOf(ctx: Context): string {
  const value = ctx.get('settings')?.get(settingsNamespace('blue')) as Partial<UpdateSettings> | undefined
  return typeof value?.updateChannel === 'string' && value.updateChannel !== ''
    ? value.updateChannel
    : 'rc'
}

/** Probe the installed dsh CLI's version output; `undefined` when unreadable. */
async function probeHostVersion(dshBin: string): Promise<string | undefined> {
  const outcome = await updaterInternals.spawnOnce(dshBin, ['--version'], { timeoutMs: 10_000 })
  if (outcome.spawnError !== undefined || outcome.code !== 0) return undefined
  return outcome.stdout
}

/**
 * Probe pnpm's `minimumReleaseAge` in minutes inside the profile; an
 * unset or unparsable value reads as `undefined` (the pnpm 11 default
 * applies downstream).
 */
async function probeCooldownMinutes(root: string): Promise<number | undefined> {
  const outcome = await updaterInternals.spawnOnce('pnpm', ['config', 'get', 'minimumReleaseAge'], {
    cwd: root,
    timeoutMs: 10_000,
  })
  if (outcome.spawnError !== undefined || outcome.code !== 0) return undefined
  const parsed = Number.parseInt(outcome.stdout.trim(), 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

/** Format the publish age for the confirm subtitle. */
function publishAgeDetail(published: number | undefined, now: number): string {
  if (published === undefined) return ''
  const hours = Math.max(0, Math.round((now - published) / 3_600_000))
  return hours >= 48 ? `published ${Math.round(hours / 24)}d ago` : `published ${hours}h ago`
}

/**
 * Register `/update`.
 * @param ctx - plugin context.
 * @returns the disposer removing the command.
 */
export function registerUpdateCommand(ctx: Context): () => void {
  const dispose = ctx.commands.register({
    name: 'update',
    description: 'Safely update Blue (preflight, snapshot, smoke, auto-rollback)',
    input: { hint: '[<version>]' },
    handler: invocation => runUpdateCommand(ctx, invocation.rawInput.trim()),
  })
  return dispose
}

/**
 * The `/update` handler entry: refuses a second concurrent run, then
 * delegates to {@link runUpdateFlow}. The flag releases in a `finally`
 * so a crashed swap cannot wedge the command for the session.
 * @param ctx - plugin context.
 * @param requested - the raw argument: empty (follow the channel) or an
 * exact version.
 * @returns the command outcome.
 */
async function runUpdateCommand(ctx: Context, requested: string): Promise<CommandResult> {
  const state = ctx.blueInteractionState
  if (state.updateInFlight) {
    return { kind: 'error', text: 'an update is already in progress' }
  }
  state.updateInFlight = true
  try {
    return await runUpdateFlow(ctx, requested)
  } finally {
    state.updateInFlight = false
  }
}

/**
 * The `/update` handler body: guards, registry read, pre-flight, confirm,
 * swap. Every blocking verdict returns as an error result with its exact
 * recipe; an up-to-date tree answers with a plain success.
 * @param ctx - plugin context.
 * @param requested - the raw argument: empty (follow the channel) or an
 * exact version.
 * @returns the command outcome.
 */
async function runUpdateFlow(ctx: Context, requested: string): Promise<CommandResult> {
  const current = ctx.get('blueSessionReader')?.current() ?? null
  if (current !== null && current.status !== 'idle') {
    return { kind: 'error', text: 'the agent is running — wait for the current turn to finish before updating' }
  }
  const display = displayServices(ctx)
  if (display === undefined) {
    return { kind: 'error', text: 'update is unavailable: the Blue screen is not mounted' }
  }
  getSharedEditor(ctx)?.notice?.(`checking the registry for ${BUNDLE_PACKAGE} updates…`)
  const registry = await fetchPackument({
    onRetry: (attempt, total) =>
      getSharedEditor(ctx)?.notice?.(`registry unreachable, retrying (${attempt}/${total})…`),
  })
  if (!registry.ok) {
    const detail = registry.reason === 'network'
      ? 'unreachable — check the network or the npmrc mirror and retry'
      : registry.reason === 'not-found'
        ? 'the registry answers E404 for @dsh-blue/blue — check the npmrc registry/mirror configuration'
        : 'unparseable answer — check the npmrc mirror and retry'
    return { kind: 'error', text: `could not read the registry (${detail})` }
  }
  const packument = registry.packument

  let target: string
  if (requested !== '') {
    if (!isVersion(requested)) {
      return { kind: 'error', text: `"${requested}" is not a version (try /update 0.1.0-rc.3)` }
    }
    target = requested
  } else {
    const channel = updateChannelOf(ctx)
    const offer = resolveOffer(packument, channel, BLUE_VERSION)
    if (offer.kind === 'no-tag') {
      return { kind: 'error', text: `the registry carries no "${channel}" tag for @dsh-blue/blue — pick a version with /update <version>` }
    }
    if (offer.kind === 'target-unparsable') {
      return { kind: 'error', text: `the "${channel}" tag points at "${offer.target}", which does not parse as a version` }
    }
    if (offer.kind === 'up-to-date') {
      return { kind: 'success', text: `up to date (v${BLUE_VERSION}; ${channel} tag: ${offer.target})` }
    }
    // `offer` and `target-below-floor` both carry a target; the version
    // floor gate below refuses the below-floor shape with its own recipe.
    target = offer.target
  }

  const profile = profileNameFromArgv(process.argv)
  const root = profileRoot(profile)
  const facts = readProfileFacts(root)
  const dshBin = await findDshBin()
  if (dshBin === undefined) {
    return { kind: 'error', text: 'cannot find the dsh CLI — set DSH_BIN or put dsh on PATH' }
  }
  const [hostOutput, cooldownMinutes, release] = await Promise.all([
    probeHostVersion(dshBin),
    probeCooldownMinutes(root),
    releaseFacts(packument, target),
  ])
  const packageNames = release.names
  const verdicts = runPreflight({
    facts,
    currentVersion: BLUE_VERSION,
    target,
    packument,
    packageNames,
    host: { hostVersion: hostOutput, requiredLine: release.harnessLine },
    cooldown: { publishedAt: publishedAt(packument, target), cooldownMinutes, now: updaterInternals.now() },
  })
  const installedVersion = facts.installed['@dsh-blue/blue']
  const blocking = verdicts.find(verdict => verdict.blocking)
  if (blocking !== undefined) {
    // The verdict's multi-line repair recipe is the payload; a one-line
    // command result would truncate it away, so the panel carries it.
    mountBlockedPanel(ctx, display, installedVersion ?? BLUE_VERSION, target, blocking.message)
    return { kind: 'success' }
  }
  const warnings = verdicts.filter(verdict => !verdict.blocking && verdict.message !== undefined)
  // The set-consistency gate has already refused a profile whose bundle
  // install is missing, so the lookup cannot miss here.
  const fromVersion = installedVersion!
  // The rollback set is the from-release's own membership: the set GROWS
  // across releases (blue-api joined at rc.3), so rolling an old profile
  // back with the target set would request packages that never existed →
  // ETARGET. When the old release's registry answer carries just the
  // bundle itself, fall back to the installed set this profile actually
  // carries.
  const fromRelease = await releaseFacts(packument, fromVersion)
  const rollbackNames = fromRelease.names.length > 1
    ? fromRelease.names
    : Object.keys(facts.installed).filter(name => facts.installed[name] !== undefined)

  const hostLine = hostOutput?.trim()
  const detailParts = [
    publishAgeDetail(publishedAt(packument, target), updaterInternals.now()),
    hostLine === undefined ? '' : `dsh ${hostLine}`,
    ...warnings.map(verdict => verdict.message!),
  ].filter(part => part !== '')
  const confirmed = await confirmUpdate(ctx, display, fromVersion, target, detailParts.join(' · '))
  if (!confirmed) {
    return { kind: 'success', text: 'update cancelled' }
  }

  const outcome = await runSwapPanel(ctx, display, { root, profile, dshBin, fromVersion, toVersion: target, packageNames, rollbackNames })
  if (outcome.kind === 'success') {
    // The boot check stops offering what this session just installed.
    writeUpdateCheckState({ lastCheckAt: updaterInternals.now(), lastNotifiedVersion: target })
    return { kind: 'success', text: outcome.message }
  }
  // The panel already shows the full multi-line outcome; the result line
  // stays a short summary so the transcript never truncates mid-recipe.
  return {
    kind: 'error',
    text: outcome.kind === 'rolled-back'
      ? `update failed — rolled back to v${outcome.fromVersion}`
      : 'update failed — the repair recipe is in the update panel',
  }
}

/**
 * Mount the panel in blocked mode for a pre-flight verdict: nothing ran,
 * nothing changed, the recipe is readable.
 * @param display - the display services.
 * @param fromVersion - the installed version (for the from→to row).
 * @param target - the refused target.
 * @param message - the verdict's full multi-line message.
 */
function mountBlockedPanel(
  ctx: Context,
  display: NonNullable<ReturnType<typeof displayServices>>,
  fromVersion: string,
  target: string,
  message: string,
): void {
  const state = createUpdateProgressState()
  state.blockedMessage = message
  let restore: () => void
  const panel = new FrontendPanel({
    ...display,
    model: () => updatePanelModel(state, fromVersion, target),
    onAction: () => undefined,
    onClose: () => {
      restore()
      getSharedEditor(ctx)?.notice?.(updatePanelSummary(state))
    },
  })
  restore = mountEditorReplacement(ctx, panel)
}
