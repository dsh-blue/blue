/**
 * `/update` (D52): the in-app safe upgrade. The flow is the ADR's whole
 * spine — busy guard, registry read (metadata, never dist-tag
 * resolution), the six pre-flight gates, a typed `y` confirm, then the
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
import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { FormPanel } from './form-panel.ts'
import { ACTION_CANCEL } from './keys.ts'
import type { UpdateSettings } from './updater/check.ts'
import { writeUpdateCheckState } from './updater/check.ts'
import { updaterInternals } from './updater/io.ts'
import { findDshBin, profileNameFromArgv, profileRoot, readProfileFacts } from './updater/profile.ts'
import {
  harnessLineOf,
  fetchPackument,
  publishedAt,
} from './updater/registry.ts'
import { resolveOffer, runPreflight } from './updater/preflight.ts'
import { performSwap, type SwapOutcome, type SwapProgress, type SwapStep } from './updater/swap.ts'
import { isVersion } from './updater/version.ts'

/** The step rows the panel renders, in execution order. */
const STEP_ROWS: readonly { step: SwapStep, label: string }[] = [
  { step: 'snapshot', label: 'snapshot' },
  { step: 'install', label: 'install' },
  { step: 'verify', label: 'verify versions' },
  { step: 'smoke-imports', label: 'smoke: imports' },
  { step: 'smoke-boot', label: 'smoke: boot' },
  { step: 'rollback', label: 'rollback' },
]

/**
 * The update progress panel: the step ladder while the swap runs, the
 * outcome rows once it settles. Escape (and Enter/q) close only after
 * the outcome arrived — closing mid-swap is the one dangerous action,
 * so the panel refuses.
 */
export class UpdatePanel implements BlueFocusable {
  /** Whether the panel currently holds focus. Managed by the screen. */
  focused = false

  private readonly states = new Map<SwapStep, 'start' | 'ok' | 'fail'>()
  private outcome: SwapOutcome | undefined
  private onClose: (() => void) | undefined

  /**
   * @param options - see {@link UpdatePanelOptions}.
   */
  constructor(private readonly options: UpdatePanelOptions) {}

  /** Point the close path at the slot restore. */
  bindClose(onClose: () => void): void {
    this.onClose = onClose
  }

  /** Record one progress event and repaint. */
  applyProgress(progress: SwapProgress): void {
    this.states.set(progress.step, progress.state)
    this.options.requestRender()
  }

  /** Record the final outcome and repaint. */
  settle(outcome: SwapOutcome): void {
    this.outcome = outcome
    this.options.requestRender()
  }

  /** The one-line summary for the editor notice when the panel closes. */
  settledSummary(): string {
    const outcome = this.outcome
    if (outcome === undefined) return 'update panel closed'
    return outcome.kind === 'success'
      ? `updated to v${outcome.toVersion} — restart dsh to apply`
      : `update did not complete (${outcome.kind}) — log: ${outcome.logPath}`
  }

  /**
   * Dispatch one input sequence: close keys work only once settled.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    if (this.outcome === undefined) return
    if (this.options.keymap.matches(data, ACTION_CANCEL) || data === '\r' || data === 'q' || data === 'Q') {
      this.onClose?.()
    }
  }

  /** No cached render state. */
  invalidate(): void {}

  /**
   * Render the framed panel: the from→to line, the step ladder, and —
   * once settled — the outcome message rows and log path.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const { theme, components, fromVersion, toVersion } = this.options
    const colors = theme.colors
    const budget = Math.max(1, width - 4)
    const line = (text: string): string => `  ${components.truncateToWidth(text, budget)}`
    const body: string[] = [line(`v${fromVersion} → v${toVersion}`), '']
    for (const row of STEP_ROWS) {
      const state = this.states.get(row.step)
      if (state === undefined && row.step === 'rollback') continue
      const mark = state === 'ok' ? colors.success('✓')
        : state === 'fail' ? colors.error('✗')
          : state === 'start' ? colors.textMuted('…')
            : colors.textMuted('·')
      body.push(line(`  ${mark} ${row.label}`))
    }
    const outcome = this.outcome
    if (outcome !== undefined) {
      body.push('')
      for (const text of outcome.message.split('\n')) {
        body.push(line(colors.textStrong(text)))
      }
      body.push(line(colors.textMuted(`log: ${outcome.logPath}`)))
    }
    return framePanel(body, width, {
      title: 'Update Blue',
      titlePaint: colors.primary,
      titleHint: outcome === undefined ? '· updating — do not close' : '· Esc to close',
      hintPaint: colors.textMuted,
      rulePaint: colors.primary,
    })
  }
}

/** Construction options for {@link UpdatePanel}. */
export interface UpdatePanelOptions {
  /** Theme supplying the frame and row colors. */
  readonly theme: BlueTheme
  /** Component factory supplying the width helpers. */
  readonly components: BlueComponents
  /** Keymap resolving the close keys. */
  readonly keymap: BlueKeymap
  /** Repaint request (the screen's `requestRender`). */
  readonly requestRender: () => void
  /** The version the profile runs. */
  readonly fromVersion: string
  /** The version being installed. */
  readonly toVersion: string
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
function confirmUpdate(display: Display, fromVersion: string, toVersion: string, detail: string): Promise<boolean> {
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
    const restore = mountEditorReplacement(panel)
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
  },
): Promise<SwapOutcome> {
  const bootMarker = ctx.get('agentDefaultModel')?.currentSelection().model
  const panel = new UpdatePanel({
    theme: display.theme,
    components: display.components,
    keymap: display.keymap,
    requestRender: () => display.screen.requestRender(),
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
  })
  const restore = mountEditorReplacement(panel)
  panel.bindClose(() => {
    restore()
    getSharedEditor()?.notice?.(panel.settledSummary())
  })
  const outcome = await performSwap({
    ...input,
    ...(bootMarker !== undefined ? { bootMarker } : {}),
    onProgress: progress => panel.applyProgress(progress),
  })
  panel.settle(outcome)
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
 * The `/update` handler body: guards, registry read, pre-flight, confirm,
 * swap. Every blocking verdict returns as an error result with its exact
 * recipe; an up-to-date tree answers with a plain success.
 * @param ctx - plugin context.
 * @param requested - the raw argument: empty (follow the channel) or an
 * exact version.
 * @returns the command outcome.
 */
async function runUpdateCommand(ctx: Context, requested: string): Promise<CommandResult> {
  const current = ctx.get('blueSession')?.current
  if (current !== undefined && current !== null && current.status !== 'idle') {
    return { kind: 'error', text: 'the agent is running — wait for the current turn to finish before updating' }
  }
  const display = displayServices(ctx)
  if (display === undefined) {
    return { kind: 'error', text: 'update is unavailable: the Blue screen is not mounted' }
  }
  const registry = await fetchPackument()
  if (!registry.ok) {
    return { kind: 'error', text: `could not read the registry (${registry.reason === 'network' ? 'unreachable' : 'unparseable answer'}) — check the network or the npmrc mirror and retry` }
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
  const [hostOutput, cooldownMinutes] = await Promise.all([probeHostVersion(dshBin), probeCooldownMinutes(root)])
  const verdicts = runPreflight({
    facts,
    currentVersion: BLUE_VERSION,
    target,
    packument,
    host: { hostVersion: hostOutput, requiredLine: harnessLineOf(packument, target) },
    cooldown: { publishedAt: publishedAt(packument, target), cooldownMinutes, now: updaterInternals.now() },
  })
  const blocking = verdicts.find(verdict => verdict.blocking)
  if (blocking !== undefined) {
    return { kind: 'error', text: blocking.message }
  }
  const warnings = verdicts.filter(verdict => !verdict.blocking && verdict.message !== undefined)
  // The set-consistency gate has already refused a profile whose bundle
  // install is missing, so the lookup cannot miss here.
  const fromVersion = facts.installed['@dsh-blue/blue']!

  const hostLine = hostOutput?.trim()
  const detailParts = [
    publishAgeDetail(publishedAt(packument, target), updaterInternals.now()),
    hostLine === undefined ? '' : `dsh ${hostLine}`,
    ...warnings.map(verdict => verdict.message!),
  ].filter(part => part !== '')
  const confirmed = await confirmUpdate(display, fromVersion, target, detailParts.join(' · '))
  if (!confirmed) {
    return { kind: 'success', text: 'update cancelled' }
  }

  const outcome = await runSwapPanel(ctx, display, { root, profile, dshBin, fromVersion, toVersion: target })
  if (outcome.kind === 'success') {
    // The boot check stops offering what this session just installed.
    writeUpdateCheckState({ lastCheckAt: updaterInternals.now(), lastNotifiedVersion: target })
    return { kind: 'success', text: outcome.message }
  }
  return { kind: 'error', text: outcome.message }
}
