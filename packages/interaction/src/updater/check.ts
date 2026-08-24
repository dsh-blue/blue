/**
 * `blue-update-check` plugin (D52): the boot-time registry check. After
 * the whole tree settles (the loader await — the check never competes
 * with boot), it reads one packument — npm view first for the user's
 * npmrc mirrors, the registry API as fallback — at most once per 24h,
 * silently, and when the channel tag outranks the running version it
 * appends the two-row update notice to the scroll area and flashes the
 * editor hint line. The read is metadata, not remote content (the kimi
 * remote-banner decline stands): one GET, a local timestamp, nothing
 * sent, and `blue.updateCheck: false` in `~/.dsh/settings.yaml` makes
 * Blue fully offline.
 *
 * Everything goes through the io seam, so the per-file gate drives the
 * retry ladder and cache from specs; the async body is fire-and-forget
 * with the fiber's unload flag gating every continuation (the
 * commands-plugin discipline). The `blue` namespace itself is registered
 * once by `../settings.ts` (`blue-settings`); this plugin only reads the
 * shared thunk.
 *
 * @module @dsh-blue/blue-interaction/updater/check
 */

import type { Context } from '@deepseek-ai/cordis'
// Empty type import carries the loader Context merge for the settlement
// await (the app driver's own discipline).
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { BLUE_VERSION } from '@dsh-blue/blue-api'
import { join } from 'node:path'
import { getSharedEditor } from '../editor-instance.ts'
import { currentBlueSettings, type BlueSettings } from '../settings.ts'
import { UpdateNoticeComponent } from '../update-notice.ts'
import { updaterInternals } from './io.ts'
import { dshHome, profileNameFromArgv } from './profile.ts'
import { resolveOffer } from './preflight.ts'
import { fetchPackument } from './registry.ts'

/** How often the boot check re-queries the registry. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000

/** The check's persisted state, under `$DSH_HOME/storages/blue-update/`. */
export interface UpdateCheckState {
  /** Wall clock of the last registry read, epoch ms. */
  readonly lastCheckAt: number
  /** The newest version the check last notified about, when it did. */
  readonly lastNotifiedVersion?: string
  /** The last failure class, for offline diagnosis. */
  readonly lastError?: string
}

/**
 * The user-tunable update settings: a view of the shared `blue` namespace
 * (`../settings.ts` owns the schema and the one registration).
 */
export type UpdateSettings = Pick<BlueSettings, 'updateCheck' | 'updateChannel'>

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
    return {
      lastCheckAt,
      ...(typeof lastNotifiedVersion === 'string' ? { lastNotifiedVersion } : {}),
      ...(typeof lastError === 'string' ? { lastError } : {}),
    }
  } catch {
    return undefined
  }
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
  if (!settings().updateCheck) return
  const now = updaterInternals.now()
  const previous = readUpdateCheckState()
  if (previous !== undefined && now - previous.lastCheckAt < CHECK_INTERVAL_MS) return
  const result = await fetchPackument()
  if (isUnloaded()) return
  if (!result.ok) {
    writeUpdateCheckState({
      lastCheckAt: now,
      ...(previous?.lastNotifiedVersion !== undefined ? { lastNotifiedVersion: previous.lastNotifiedVersion } : {}),
      lastError: result.reason,
    })
    return
  }
  const offer = resolveOffer(result.packument, settings().updateChannel, BLUE_VERSION)
  if (offer.kind !== 'offer') {
    // Up to date (or the channel is broken): a clean read clears the
    // error and the notified marker.
    writeUpdateCheckState({ lastCheckAt: now })
    return
  }
  writeUpdateCheckState({ lastCheckAt: now, lastNotifiedVersion: offer.target })
  if (isUnloaded()) return
  mountNotice(ctx, offer.target)
}

/**
 * Append the update notice to the scroll area and flash the editor hint
 * line. The mount is effect-bound (unloading the fiber removes it); the
 * plain component carries no theme dependency, so it survives `/theme`.
 * @param ctx - plugin context.
 * @param target - the offered version.
 */
function mountNotice(ctx: Context, target: string): void {
  const screen = ctx.get('blueScreen')
  const components = ctx.get('blueComponents')
  if (screen === undefined || components === undefined) return
  const profile = profileNameFromArgv(process.argv)
  const notice = new UpdateNoticeComponent(
    (text, width) => components.truncateToWidth(text, width),
    {
      current: BLUE_VERSION,
      target,
      command: `dsh plugin --profile ${profile} add @dsh-blue/blue@${target}`,
    },
  )
  ctx.effect(() => screen.addChild(notice))
  screen.requestRender()
  getSharedEditor()?.notice?.(`Blue v${target} available — /update to upgrade`)
}

/**
 * Mount the boot check: fire the check body against the shared `blue`
 * settings thunk (defaults until a settings service layers overrides).
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  let unloaded = false
  ctx.effect(() => () => {
    unloaded = true
  })
  /* v8 ignore next 1 -- the defensive catch; runUpdateCheck never rejects */
  void runUpdateCheck(ctx, currentBlueSettings, () => unloaded).catch(() => {})
}
