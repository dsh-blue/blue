/**
 * `blue-update-check` plugin (D52): the boot-time registry check. After
 * the whole tree settles (the loader await — the check never competes
 * with boot), it reads one packument — npm view first for the user's
 * npmrc mirrors, the registry API as fallback — at most once per 24h,
 * silently, and when the channel tag outranks the running version it
 * appends the two-row update notice to the scroll area and flashes the
 * editor hint line. A recorded offer (`lastOffer` in the state) re-mounts
 * the notice on every cache-window boot without a network read, and a
 * FAILED read never stamps the cache window, so the next boot retries. A
 * `link:`/`file:`-installed dev profile never sees the offer notice (it
 * would invite the `dsh plugin add` that half-overwrites the links), and
 * a leftover swap `pending.json` marker mounts the interrupted-update
 * warning instead. The read is metadata, not remote content (the kimi
 * remote-banner decline stands): one GET, a local timestamp, nothing
 * sent, and `blue.updateCheck: false` in `~/.dsh/settings.yaml` makes
 * Blue fully offline.
 *
 * Everything goes through the io seam, so the per-file gate drives the
 * retry ladder and cache from specs; the async body is fire-and-forget
 * with the fiber's unload flag gating every continuation (the
 * commands-plugin discipline).
 *
 * @module @dsh-blue/blue-interaction/updater/check
 */

import type { Context } from '@deepseek-ai/cordis'
// Empty type import carries the loader Context merge for the settlement
// await (the app driver's own discipline).
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { BLUE_VERSION } from '@dsh-blue/blue-api'
import { join } from 'node:path'
import { getSharedEditor } from '../editor-instance.ts'
import type { InterruptedNoticeContent } from '../update-notice.ts'
import { interruptedNoticeRows, UpdateNoticeComponent, updateNoticeRows } from '../update-notice.ts'
import { updaterInternals } from './io.ts'
import { backupDir, dshHome, profileNameFromArgv, profileRoot, readProfileFacts } from './profile.ts'
import { resolveOffer } from './preflight.ts'
import { fetchPackument, publishedAt } from './registry.ts'
import { compareVersions } from './version.ts'

/** How often the boot check re-queries the registry. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000

/** The check's persisted state, under `$DSH_HOME/storages/blue-update/`. */
export interface UpdateCheckState {
  /** Wall clock of the last SUCCESSFUL registry read, epoch ms (a failed check never stamps it — the next boot retries). */
  readonly lastCheckAt: number
  /** The newest version the check last notified about, when it did. */
  readonly lastNotifiedVersion?: string
  /** The last offer seen, so a cache-window boot can re-mount the notice without a network read. */
  readonly lastOffer?: { readonly version: string, readonly publishedAt?: number }
  /** The last failure class, for offline diagnosis. */
  readonly lastError?: string
}

/** The user-tunable update settings (the `blue` settings namespace). */
export interface UpdateSettings {
  /** Whether the boot check runs at all; `false` is the offline switch. */
  readonly updateCheck: boolean
  /** The dist-tag the check follows (`rc` today; `latest` once a stable
   * line exists). */
  readonly updateChannel: string
}

/** The settings schema; defaults double as the composition base. */
export const Config: z<UpdateSettings> = z.object({
  updateCheck: z.boolean().default(true),
  updateChannel: z.string().default('rc'),
})

/** The resolved defaults, used until a settings service layers overrides. */
export const DEFAULT_SETTINGS: UpdateSettings = { updateCheck: true, updateChannel: 'rc' }

/** Stable Cordis plugin name. */
export const name = 'blue-update-check'

/** The state file's path under the plugin storage convention. */
export function updateCheckStatePath(): string {
  return join(dshHome(), 'storages', 'blue-update', 'state.json')
}

/**
 * Read the persisted check state; absent or foreign shapes read as
 * "never checked". All failures are silent — the check never surfaces.
 * @returns the state, or `undefined`.
 */
export function readUpdateCheckState(): UpdateCheckState | undefined {
  const text = updaterInternals.readTextFile(updateCheckStatePath())
  if (text === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as Record<string, unknown>
    const lastCheckAt = record.lastCheckAt
    if (typeof lastCheckAt !== 'number') return undefined
    const lastNotifiedVersion = record.lastNotifiedVersion
    const lastError = record.lastError
    const lastOffer = record.lastOffer
    return {
      lastCheckAt,
      ...(typeof lastNotifiedVersion === 'string' ? { lastNotifiedVersion } : {}),
      ...(typeof lastError === 'string' ? { lastError } : {}),
      ...(isOfferShape(lastOffer) ? { lastOffer } : {}),
    }
  } catch {
    return undefined
  }
}

/** Tolerant read of the persisted offer shape. */
function isOfferShape(value: unknown): value is { version: string, publishedAt?: number } {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.version !== 'string') return false
  return record.publishedAt === undefined || typeof record.publishedAt === 'number'
}

/**
 * Persist the check state, creating the storage directory.
 * @param state - the state to write.
 */
export function writeUpdateCheckState(state: UpdateCheckState): void {
  updaterInternals.writeTextFile(updateCheckStatePath(), `${JSON.stringify(state, null, 2)}\n`)
}

/**
 * Run one boot check: settle, consult the cache, read the registry,
 * resolve the channel offer, and notify when it outranks the running
 * version. Never throws — every failure writes `lastError` and returns.
 * @param ctx - plugin context (for the loader settle and the notice mount).
 * @param settings - thunk reading the current settings (the settings
 * section's source seam).
 * @param isUnloaded - the fiber's unload flag; every continuation re-checks.
 */
export async function runUpdateCheck(
  ctx: Context,
  settings: () => UpdateSettings,
  isUnloaded: () => boolean,
): Promise<void> {
  // The whole tree first — the check never competes with boot.
  await ctx.get('loader')?.await()
  if (isUnloaded()) return
  // A killed swap left its marker behind: warn (read-only — never an
  // auto-restore). This is a local read, so it runs even when the
  // registry check is switched off. No await intervenes after the unload
  // check, so the flag cannot flip in between.
  const pending = pendingSwapMarker()
  if (pending !== undefined) mountInterruptedNotice(ctx, pending)
  if (!settings().updateCheck) return
  const now = updaterInternals.now()
  const previous = readUpdateCheckState()
  if (previous !== undefined && now - previous.lastCheckAt < CHECK_INTERVAL_MS) {
    // Inside the cache window the registry is not re-read, but a recorded
    // offer that still outranks the running version re-mounts its notice
    // from the cache — otherwise only the first boot of 24h ever showed it.
    const offer = previous.lastOffer
    if (offer !== undefined && compareVersions(offer.version, BLUE_VERSION) > 0) {
      mountNotice(ctx, offer.version)
    }
    return
  }
  const result = await fetchPackument()
  if (isUnloaded()) return
  if (!result.ok) {
    // A failed read must NOT stamp lastCheckAt — the next boot retries
    // instead of burning the 24h window on a transient error.
    writeUpdateCheckState({
      lastCheckAt: previous?.lastCheckAt ?? 0,
      ...(previous?.lastNotifiedVersion !== undefined ? { lastNotifiedVersion: previous.lastNotifiedVersion } : {}),
      ...(previous?.lastOffer !== undefined ? { lastOffer: previous.lastOffer } : {}),
      lastError: result.reason,
    })
    return
  }
  const offer = resolveOffer(result.packument, settings().updateChannel, BLUE_VERSION)
  if (offer.kind !== 'offer') {
    // Up to date (or the channel is broken): a clean read clears the
    // error, the notified marker, and any recorded offer.
    writeUpdateCheckState({ lastCheckAt: now })
    return
  }
  const published = publishedAt(result.packument, offer.target)
  writeUpdateCheckState({
    lastCheckAt: now,
    lastNotifiedVersion: offer.target,
    lastOffer: { version: offer.target, ...(published === undefined ? {} : { publishedAt: published }) },
  })
  if (isUnloaded()) return
  mountNotice(ctx, offer.target)
}

/**
 * Append the update notice to the scroll area and flash the editor hint
 * line. The mount is effect-bound (unloading the fiber removes it); the
 * plain component carries no theme dependency, so it survives `/theme`.
 * A `link:`/`file:`-installed dev profile never sees the notice: it would
 * invite `dsh plugin add`, the exact command that half-overwrites the
 * links (and `/update` refuses those profiles by design).
 * @param ctx - plugin context.
 * @param target - the offered version.
 */
function mountNotice(ctx: Context, target: string): void {
  const screen = ctx.get('blueScreen')
  const components = ctx.get('blueComponents')
  if (screen === undefined || components === undefined) return
  const profile = profileNameFromArgv(process.argv)
  if (readProfileFacts(profileRoot(profile)).linked.length > 0) return
  const notice = new UpdateNoticeComponent(
    (text, width) => components.truncateToWidth(text, width),
    updateNoticeRows({
      current: BLUE_VERSION,
      target,
      command: `dsh plugin --profile ${profile} add @dsh-blue/blue@${target}`,
    }),
  )
  ctx.effect(() => screen.addChild(notice))
  screen.requestRender()
  getSharedEditor()?.notice?.(`Blue v${target} available — /update to upgrade`)
}

/**
 * Read the swap's pending marker from the profile's backup dir; `undefined`
 * when no swap is recorded as in-flight. The marker's presence is the
 * signal — even an unparseable body still warns.
 * @returns the marker facts, or `undefined`.
 */
function pendingSwapMarker(): InterruptedNoticeContent | undefined {
  const backup = backupDir(profileRoot(profileNameFromArgv(process.argv)))
  const text = updaterInternals.readTextFile(join(backup, 'pending.json'))
  if (text === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    const to = typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>).to
      : undefined
    return { backupPath: backup, ...(typeof to === 'string' ? { target: to } : {}) }
  } catch {
    return { backupPath: backup }
  }
}

/**
 * Mount the interrupted-update warning row (the killed-swap recovery
 * path): the profile may be mixed, the backup path is the repair, and the
 * notice never auto-restores. Same mount discipline as the offer notice.
 * @param ctx - plugin context.
 * @param content - the marker facts.
 */
function mountInterruptedNotice(ctx: Context, content: InterruptedNoticeContent): void {
  const screen = ctx.get('blueScreen')
  const components = ctx.get('blueComponents')
  if (screen === undefined || components === undefined) return
  const notice = new UpdateNoticeComponent(
    (text, width) => components.truncateToWidth(text, width),
    interruptedNoticeRows(content),
  )
  ctx.effect(() => screen.addChild(notice))
  screen.requestRender()
}

/**
 * Mount the boot check: wire the `blue` settings section (defaults until
 * a settings service layers user overrides) and fire the check body.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  let unloaded = false
  ctx.effect(() => () => {
    unloaded = true
  })
  let source: () => UpdateSettings = () => DEFAULT_SETTINGS
  installSettingsSection(ctx, settingsNamespace('blue'), Config, DEFAULT_SETTINGS, {
    setSource: next => {
      source = next
    },
    onChange: () => {},
  })
  /* v8 ignore next 1 -- the defensive catch; runUpdateCheck never rejects */
  void runUpdateCheck(ctx, source, () => unloaded).catch(() => {})
}

