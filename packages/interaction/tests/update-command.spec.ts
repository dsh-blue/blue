/**
 * Tests for `/update` (D52) over the real command runtime: the busy,
 * screen, and in-flight guards, every early-exit verdict (bad version,
 * missing tag, below-floor tag, up to date, link pollution, stale host,
 * cooldown window), the registry failure classes (network, E404,
 * unparseable) with the hint-line progress and retry notices, the
 * typed-y confirm and its Esc cancel, the full success path (swap,
 * panel, boot-check cache write), the rollback outcomes (including the
 * installed-set fallback when the registry does not know the old
 * release), the downgrade full-set transaction, a thrown swap settling
 * the panel, and the progress panel's own rendering and close
 * discipline.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SettingsProvider, { settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'

registerTempDirCleanup()
import { BLUE_VERSION } from '../../api/src/index.ts'
import * as updateCheck from '../src/updater/check.ts'
import { updaterInternals, type InteractiveChild, type SpawnOutcome } from '../src/updater/io.ts'
import { setSharedEditor } from '../src/editor-instance.ts'
import {
  applyUpdateProgress,
  createUpdateProgressState,
  registerUpdateCommand,
  updatePanelModel,
  updatePanelSummary,
} from '../src/update-command.ts'
import { CanonicalDocumentController } from '../src/frontend-panel.ts'
import * as settingsPlugin from '../src/settings.ts'
import { fakeBlueContext, KEY, type FakeScreen } from './fakes.ts'
import { InteractionStateService } from '../src/runtime-state.ts'

/** The real seams, restored after every test. */
const REAL = { ...updaterInternals }

afterEach(() => {
  Object.assign(updaterInternals, REAL)
})

/** The rc.2 release set (five packages — blue-api joins with rc.3). */
const RC2_NAMES = [
  '@dsh-blue/blue',
  '@dsh-blue/blue-core',
  '@dsh-blue/blue-interaction',
  '@dsh-blue/blue-transcript',
  '@dsh-blue/blue-app',
]

/** The rc.3 release set (six packages — blue-api joins). */
const RC3_NAMES = ['@dsh-blue/blue-api', ...RC2_NAMES]

/** Version roles used by the update scenarios across release bumps. */
const CURRENT_VERSION = BLUE_VERSION
const TARGET_VERSION = '0.1.1-rc.1'

/** A spawn success. */
function ok(): SpawnOutcome {
  return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false }
}

/** A scripted interactive child that echoes and quits on demand. */
class FakeChild implements InteractiveChild {
  private exitedValue: SpawnOutcome | undefined
  private readonly resolveExit: (outcome: SpawnOutcome) => void
  readonly exited: Promise<SpawnOutcome>

  constructor() {
    this.exited = new Promise(resolve => {
      this.resolveExit = resolve
    })
  }

  write(data: string): void {
    if (data.includes('/quit')) {
      this.exitedValue ??= ok()
      this.resolveExit(this.exitedValue)
    }
  }

  output(): string {
    return 'deepseek-chat marker'
  }

  kill(): void {
    this.exitedValue ??= { code: null, signal: 'SIGTERM', stdout: '', stderr: '', timedOut: true }
    this.resolveExit(this.exitedValue)
  }
}

/** The registry document variants the tests switch between. */
function packumentJson(options: { rcTag?: string; time?: Record<string, string> } = {}): string {
  // The dependency blocks mirror the real registry: rc.2 shipped the
  // four-package set, rc.3 adds blue-api (bundleSetNames derives from
  // these).
  const dshDeps = { '@deepseek-ai/dsh-agent-presets': '0.1.1-rc.2' }
  const rc2Deps = {
    ...dshDeps,
    '@dsh-blue/blue-core': '^0.1.0-rc.6',
    '@dsh-blue/blue-interaction': '^0.1.0-rc.6',
    '@dsh-blue/blue-transcript': '^0.1.0-rc.6',
    '@dsh-blue/blue-app': '^0.1.0-rc.6',
  }
  return JSON.stringify({
    'dist-tags': { ...(options.rcTag === undefined ? {} : { rc: options.rcTag }), latest: '0.1.0-rc.6' },
    versions: {
      '0.1.0-rc.1': { dependencies: { '@deepseek-ai/dsh-agent-presets': '0.1.1-rc.1' } },
      '0.1.0-rc.6': { dependencies: rc2Deps },
      '0.1.0-rc.7': { dependencies: { ...rc2Deps, '@dsh-blue/blue-api': '^0.1.0-rc.7' } },
      [CURRENT_VERSION]: { dependencies: { ...rc2Deps, '@dsh-blue/blue-api': `^${CURRENT_VERSION}` } },
      [TARGET_VERSION]: { dependencies: { ...rc2Deps, '@dsh-blue/blue-api': `^${TARGET_VERSION}` } },
    },
    time: {
      '0.1.0-rc.6': '2026-08-20T00:00:00.000Z',
      '0.1.0-rc.7': '2026-08-22T00:00:00.000Z',
      [CURRENT_VERSION]: '2026-08-22T00:00:00.000Z',
      [TARGET_VERSION]: '2026-08-23T00:00:00.000Z',
      ...options.time,
    },
  })
}

/** One command world: temp profile at rc.2, scripted spawns, mounted command. */
async function mountWorld(options: {
  packument?: string
  hostVersion?: string
  cooldownProbe?: string
  installBehavior?: (specs: string[]) => SpawnOutcome
  agentStatus?: 'idle' | 'running'
  withScreen?: boolean
  sessionCurrent?: 'agent' | 'null'
} = {}) {
  const home = mkdtempTracked('blue-updater-cmd-')
  const root = join(home, '.dsh', 'profiles', 'blue')
  mkdirSync(join(root, 'node_modules', '@dsh-blue', 'blue'), { recursive: true })
  writeFileSync(join(root, 'node_modules', '@dsh-blue', 'blue', 'cordis.patch.yml'), "rows:\n")
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'profile', dependencies: { '@dsh-blue/blue': '0.1.0-rc.6' } }))
  const installAt = (version: string): void => {
    // rc.2 shipped the five-package set; rc.3 and everything after carry six.
    for (const name of version === '0.1.0-rc.2' ? RC2_NAMES : RC3_NAMES) {
      const dir = join(root, 'node_modules', name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }))
    }
  }
  installAt('0.1.0-rc.6')

  const now = Date.parse('2026-08-25T00:00:00.000Z')
  let clock = now
  const spawns: Array<{ cmd: string; args: string[] }> = []
  updaterInternals.env = { DSH_HOME: join(home, '.dsh'), DSH_BIN: '/usr/bin/dsh' }
  updaterInternals.homedir = () => home
  // A stepping clock: the boot smoke's degraded window polls `now()`, and
  // a frozen clock with instant sleeps would spin forever.
  updaterInternals.now = () => {
    clock += 250
    return clock
  }
  updaterInternals.sleep = () => Promise.resolve()
  updaterInternals.spawnOnce = ((cmd: string, args: readonly string[], opts?: { cwd?: string; timeoutMs?: number }) => {
    spawns.push({ cmd, args: [...args] })
    void opts
    if (cmd === 'npm') return Promise.resolve({ ...ok(), stdout: options.packument ?? packumentJson({ rcTag: TARGET_VERSION }) })
    if (args[0] === '--version') {
      return Promise.resolve({ ...ok(), stdout: `${options.hostVersion ?? 'dsh 0.1.1-rc.2 (node v24)'}\n` })
    }
    if (cmd === 'pnpm') {
      if (options.cooldownProbe === 'missing') {
        return Promise.resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: false, spawnError: 'ENOENT' })
      }
      if (options.cooldownProbe === 'fail') {
        return Promise.resolve({ code: 1, signal: null, stdout: '', stderr: 'not a pnpm project', timedOut: false })
      }
      if (options.cooldownProbe === 'blank') {
        return Promise.resolve({ ...ok(), stdout: '\n' })
      }
      return Promise.resolve({ ...ok(), stdout: `${options.cooldownProbe ?? '1440'}\n` })
    }
    if (args[0] === 'plugin') {
      const specs = args.filter(arg => arg.startsWith('@dsh-blue/'))
      const behavior = options.installBehavior ?? (targetSpecs => {
        installAt(targetSpecs[0]?.endsWith(`@${TARGET_VERSION}`) === true ? TARGET_VERSION : '0.1.0-rc.6')
        return ok()
      })
      return Promise.resolve(behavior(specs))
    }
    if (cmd === process.execPath) return Promise.resolve(ok())
    return Promise.resolve(ok())
  }) as typeof updaterInternals.spawnOnce
  updaterInternals.spawnInteractive = (() => new FakeChild()) as typeof updaterInternals.spawnInteractive

  const blue = options.withScreen === false ? undefined : fakeBlueContext()
  const ctx = blue?.ctx ?? new Context()
  if (blue === undefined) new InteractionStateService(ctx, settingsPlugin.DEFAULT_SETTINGS)
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('update-spec'))
  const agent = { id: session.id, session, status: options.agentStatus ?? 'idle' } as unknown as Agent
  ctx.provide('testSession', { current: options.sessionCurrent === 'null' ? null : agent, modelRef: undefined })
  const dispose = registerUpdateCommand(ctx)
  return {
    ctx,
    screen: blue?.screen as FakeScreen,
    agent,
    root,
    home,
    now,
    spawns,
    installAt,
    dispose,
    /** Execute /update and return its result. */
    run: async (line = '/update') => {
      const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
      return execution?.result
    },
    /** Wait for the first dialog overlay and return its component. */
    waitOverlay: async (): Promise<unknown> => {
      for (let i = 0; i < 100; i += 1) {
        const overlay = (blue?.screen as FakeScreen | undefined)?.overlays.at(-1)?.component
        if (overlay !== undefined) return overlay
        await new Promise(resolve => setTimeout(resolve, 2))
      }
      throw new Error('no overlay mounted')
    },
  }
}

describe('/update guards', () => {
  it('refuses while the agent is running', async () => {
    const world = await mountWorld({ agentStatus: 'running' })
    const result = await world.run()
    expect(result).toEqual({ kind: 'error', text: 'the agent is running — wait for the current turn to finish before updating' })
    world.dispose()
  })

  it('refuses without the Blue screen', async () => {
    const world = await mountWorld({ withScreen: false })
    const result = await world.run()
    expect(result?.kind).toBe('error')
    if (result?.kind === 'error') expect(result.text).toContain('not mounted')
    world.dispose()
  })

  it('refuses when the dsh CLI cannot be found', async () => {
    const world = await mountWorld()
    updaterInternals.env = { DSH_HOME: join(world.home, '.dsh') }
    updaterInternals.spawnOnce = ((cmd: string) => {
      if (cmd === 'sh') {
        return Promise.resolve({ code: 1, signal: null, stdout: '', stderr: 'not found', timedOut: false })
      }
      if (cmd === 'npm') return Promise.resolve({ ...ok(), stdout: packumentJson({ rcTag: TARGET_VERSION }) })
      return Promise.resolve(ok())
    }) as typeof updaterInternals.spawnOnce
    const result = await world.run()
    if (result?.kind === 'error') expect(result.text).toContain('cannot find the dsh CLI')
    else throw new Error('expected error')
    world.dispose()
  })

  it('reports an unreachable registry', async () => {
    const world = await mountWorld()
    updaterInternals.spawnOnce = () =>
      Promise.resolve({ code: 1, signal: null, stdout: '', stderr: 'ETIMEDOUT', timedOut: false })
    const result = await world.run()
    if (result?.kind === 'error') expect(result.text).toContain('could not read the registry')
    else throw new Error('expected error')
    world.dispose()
  })

  it('reports an E404 registry answer as a mirror misconfiguration', async () => {
    const world = await mountWorld()
    updaterInternals.spawnOnce = () =>
      Promise.resolve({ code: 1, signal: null, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found', timedOut: false })
    const result = await world.run()
    if (result?.kind === 'error') {
      expect(result.text).toContain('could not read the registry')
      expect(result.text).toContain('E404')
      expect(result.text).toContain('npmrc registry/mirror')
    } else throw new Error('expected error')
    world.dispose()
  })

  it('reports an unparseable registry answer', async () => {
    const world = await mountWorld()
    updaterInternals.spawnOnce = () =>
      Promise.resolve({ ...ok(), stdout: '<html>maintenance</html>' })
    const result = await world.run()
    if (result?.kind === 'error') expect(result.text).toContain('unparseable answer')
    else throw new Error('expected error')
    world.dispose()
  })
})

describe('/update early verdicts', () => {
  it('rejects a malformed version argument', async () => {
    const world = await mountWorld()
    const result = await world.run('/update banana')
    if (result?.kind === 'error') expect(result.text).toContain('not a version')
    else throw new Error('expected error')
    world.dispose()
  })

  it('answers up to date without touching the profile', async () => {
    const world = await mountWorld({ packument: packumentJson({ rcTag: '0.1.0-rc.6' }) })
    const result = await world.run()
    expect(result).toEqual({ kind: 'success', text: `up to date (v${CURRENT_VERSION}; rc tag: 0.1.0-rc.6)` })
    expect(world.spawns.some(call => call.args[0] === 'plugin')).toBe(false)
    world.dispose()
  })

  it('rejects a missing channel tag', async () => {
    const world = await mountWorld({ packument: packumentJson({ rcTag: '0.1.0-rc.6' }) })
    const result = await world.run('/update 0.9.9')
    expect(result).toEqual({ kind: 'success' })
    expect(overlayRows(world.screen)).toContain('is not published')
    world.dispose()
  })

  it('refuses a target below the D51 floor', async () => {
    const world = await mountWorld()
    const result = await world.run('/update 0.1.0-rc.1')
    expect(result).toEqual({ kind: 'success' })
    expect(overlayRows(world.screen)).toContain('D51')
    world.dispose()
  })

  it('refuses a channel tag that does not parse as a version', async () => {
    const world = await mountWorld({ packument: JSON.stringify({
      'dist-tags': { rc: 'banana' },
      versions: { banana: {} },
      time: {},
    }) })
    const result = await world.run()
    if (result?.kind === 'error') expect(result.text).toContain('does not parse')
    else throw new Error('expected error')
    world.dispose()
  })

  it('blocks on a missing-package profile with the repair recipe', async () => {
    // A half-missing tree: the set-consistency gate blocks, and with the
    // bundle install itself gone the panel header falls back to the
    // running version for its from→to row.
    const world = await mountWorld()
    const { rmSync } = await import('node:fs')
    rmSync(join(world.root, 'node_modules', '@dsh-blue', 'blue', 'package.json'))
    rmSync(join(world.root, 'node_modules', '@dsh-blue', 'blue-app', 'package.json'))
    const result = await world.run(`/update ${CURRENT_VERSION}`)
    expect(result).toEqual({ kind: 'success' })
    const rows = overlayRows(world.screen)
    expect(rows).toContain('the @dsh-blue/blue bundle itself is not installed')
    expect(rows).toContain('repair: dsh plugin')
    expect(rows).toContain(`v${CURRENT_VERSION} → v${CURRENT_VERSION}`)
    world.dispose()
  })

  it('answers up to date when the channel tag points below the running version', async () => {
    // The tag-below-floor shape only bites once the floor rises above the
    // running version; for a current tree it reads as plain up-to-date.
    const world = await mountWorld({ packument: packumentJson({ rcTag: '0.1.0-rc.3' }) })
    const result = await world.run()
    expect(result).toEqual({ kind: 'success', text: `up to date (v${CURRENT_VERSION}; rc tag: 0.1.0-rc.3)` })
    world.dispose()
  })

  it('blocks a link-polluted profile on the panel with the repair recipe', async () => {
    const world = await mountWorld()
    const manifest = JSON.parse(String(updaterInternals.readTextFile(join(world.root, 'package.json')))) as Record<string, unknown>
    manifest.dependencies = { '@dsh-blue/blue': 'link:../../blue/packages/bundle/blue' }
    updaterInternals.writeTextFile(join(world.root, 'package.json'), JSON.stringify(manifest))
    const result = await world.run()
    // The verdict speaks through the panel (a result line would truncate
    // the recipe); the command itself resolves success-no-text.
    expect(result).toEqual({ kind: 'success' })
    const rows = overlayRows(world.screen)
    expect(rows).toContain('the profile mixes link/file specs (@dsh-blue/blue)')
    expect(rows).toContain('repair: dsh plugin')
    expect(rows).toContain('nothing was changed')
    // Esc closes the blocked panel through the bound restore path.
    const component = world.screen.overlays.at(-1)?.component as { handleInput(data: string): void } | undefined
    dispatchUnknownPanelAction(component)
    expect(() => component?.handleInput(KEY.escape)).not.toThrow()
    world.dispose()
  })

  it('blocks on a stale host with the exact upgrade command on the panel', async () => {
    const world = await mountWorld({ hostVersion: 'dsh 0.1.1-rc.1' })
    const result = await world.run()
    expect(result).toEqual({ kind: 'success' })
    expect(overlayRows(world.screen)).toContain('npm i -g @deepseek-ai/dsh@0.1.1-rc.2')
    world.dispose()
  })

  it('blocks inside the cooldown window with the ETA on the panel', async () => {
    const world = await mountWorld({
      packument: packumentJson({ rcTag: TARGET_VERSION, time: { [TARGET_VERSION]: '2026-08-24T23:00:00.000Z' } }),
    })
    const result = await world.run()
    expect(result).toEqual({ kind: 'success' })
    const rows = overlayRows(world.screen)
    expect(rows).toContain('minimumReleaseAge')
    expect(rows).toContain('2026-08-25 23:00')
    world.dispose()
  })

  it('follows the settings channel when one is configured', async () => {
    const world = await mountWorld()
    class MemorySettings extends SettingsProvider {
      readonly writable = true
      private doc: Record<string, unknown> = {}
      protected async load(): Promise<Record<string, unknown>> {
        return this.doc
      }
      protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
        this.doc[String(ns)] = section
      }
    }
    const settings = new MemorySettings(world.ctx)
    settingsPlugin.apply(world.ctx)
    updateCheck.apply(world.ctx)
    await new Promise(resolve => setTimeout(resolve, 5))
    await settings.update(settingsNamespace('blue'), { updateChannel: 'beta' })
    await new Promise(resolve => setTimeout(resolve, 5))
    const result = await world.run()
    if (result?.kind === 'error') expect(result.text).toContain('no "beta" tag')
    else throw new Error('expected error')
    world.dispose()
  })
})

describe('/update confirm and swap', () => {
  it('updates end to end after the typed-y confirm', async () => {
    const world = await mountWorld()
    // A default-model service gives the boot smoke its marker (the
    // degraded no-marker path is the swap spec's territory).
    world.ctx.provide('agentDefaultModel', { currentSelection: () => ({ model: 'deepseek-chat marker', provider: 'x' }) })
    const pending = world.ctx.commands.execute(world.agent, '/update', [], new AbortController().signal)
    const overlay = await world.waitOverlay()
    const form = overlay as { handleInput(data: string): void, render(width: number): string[] }
    // The subtitle carries the publish age and host line.
    expect(form.render(100).join('\n')).toContain('published')
    form.handleInput('y')
    form.handleInput(KEY.enter)
    const execution = await pending
    expect(execution?.result?.kind).toBe('success')
    if (execution?.result?.kind === 'success') expect(execution.result.text).toContain('restart dsh to apply')
    // The install was one exact-version transaction.
    const install = world.spawns.find(call => call.args[0] === 'plugin')
    expect(install?.args).toEqual(['plugin', '--profile', 'blue', 'add', `@dsh-blue/blue@${TARGET_VERSION}`])
    // The boot check stops offering what this session installed.
    const state = updaterInternals.readTextFile(join(world.home, '.dsh', 'storages', 'blue-update', 'state.json'))
    expect(state).toContain(`"lastNotifiedVersion": "${TARGET_VERSION}"`)
    // The progress panel stays readable; Esc closes it through the bound
    // restore path.
    const panelOverlay = world.screen.overlays.at(-1)?.component as { handleInput(data: string): void } | undefined
    expect(panelOverlay).toBeDefined()
    dispatchUnknownPanelAction(panelOverlay)
    panelOverlay!.handleInput(KEY.escape)
    world.dispose()
  })

  it('cancels cleanly on Esc at the confirm form', async () => {
    const world = await mountWorld()
    const pending = world.ctx.commands.execute(world.agent, '/update', [], new AbortController().signal)
    const overlay = await world.waitOverlay()
    ;(overlay as { handleInput(data: string): void }).handleInput(KEY.escape)
    const execution = await pending
    expect(execution?.result).toEqual({ kind: 'success', text: 'update cancelled' })
    world.dispose()
  })

  it('shows the validation error on a wrong answer, then still cancels', async () => {
    const world = await mountWorld()
    const pending = world.ctx.commands.execute(world.agent, '/update', [], new AbortController().signal)
    const overlay = await world.waitOverlay()
    const form = overlay as { handleInput(data: string): void, render(width: number): string[] }
    form.handleInput('n')
    form.handleInput(KEY.enter)
    expect(form.render(100).join('\n')).toContain('type y to confirm')
    form.handleInput(KEY.escape)
    const execution = await pending
    expect(execution?.result).toEqual({ kind: 'success', text: 'update cancelled' })
    world.dispose()
  })

  it('returns the rollback outcome when the install fails', async () => {
    const world = await mountWorld({
      installBehavior: specs => {
        if (specs[0]?.endsWith(`@${TARGET_VERSION}`) === true) {
          return { code: 1, signal: null, stdout: '', stderr: 'ERR_PNPM minimumReleaseAge refused', timedOut: false }
        }
        world.installAt('0.1.0-rc.6')
        return ok()
      },
    })
    const pending = world.ctx.commands.execute(world.agent, '/update', [], new AbortController().signal)
    const overlay = await world.waitOverlay()
    const form = overlay as { handleInput(data: string): void }
    form.handleInput('y')
    form.handleInput(KEY.enter)
    const execution = await pending
    // The result line stays a short summary; the panel carries the recipe.
    expect(execution?.result).toEqual({ kind: 'error', text: 'update failed — rolled back to v0.1.0-rc.6' })
    const rows = overlayRows(world.screen)
    expect(rows).toContain('cooldown window')
    expect(rows).toContain('rolled back to 0.1.0-rc.6')
    world.dispose()
  })

  it('reports the recipe-in-panel summary when the rollback itself fails', async () => {
    const world = await mountWorld({
      installBehavior: () => ({ code: 1, signal: null, stdout: '', stderr: 'ERR_PNPM broken', timedOut: false }),
    })
    const pending = world.ctx.commands.execute(world.agent, '/update', [], new AbortController().signal)
    const overlay = await world.waitOverlay()
    const form = overlay as { handleInput(data: string): void }
    form.handleInput('y')
    form.handleInput(KEY.enter)
    const execution = await pending
    expect(execution?.result).toEqual({ kind: 'error', text: 'update failed — the repair recipe is in the update panel' })
    expect(overlayRows(world.screen)).toContain('manual repair')
    world.dispose()
  })

  it('shows the hours form of the publish age outside the window', async () => {
    const world = await mountWorld({
      packument: packumentJson({ rcTag: TARGET_VERSION, time: { [TARGET_VERSION]: '2026-08-24T19:00:00.000Z' } }),
      cooldownProbe: '60',
    })
    const pending = world.ctx.commands.execute(world.agent, '/update', [], new AbortController().signal)
    const overlay = await world.waitOverlay()
    const form = overlay as { handleInput(data: string): void, render(width: number): string[] }
    expect(form.render(100).join('\n')).toContain('published 5h ago')
    form.handleInput(KEY.escape)
    await pending
    world.dispose()
  })

  it('carries a newer-minor host warning into the confirm subtitle', async () => {
    const world = await mountWorld({
      hostVersion: 'dsh 0.2.0',
      cooldownProbe: '60',
    })
    const pending = world.ctx.commands.execute(world.agent, '/update', [], new AbortController().signal)
    const overlay = await world.waitOverlay()
    const form = overlay as { handleInput(data: string): void, render(width: number): string[] }
    const subtitle = form.render(120).join('\n')
    expect(subtitle).toContain('different major/minor')
    expect(subtitle).toContain('dsh 0.2.0')
    form.handleInput(KEY.escape)
    await pending
    world.dispose()
  })

  it('relays the unprobeable-host and unknown-publish-time warnings into the subtitle', async () => {
    // No publish time for the target and an unreadable host probe: both
    // gates warn instead of blocking, and the warnings ride the subtitle.
    const noTimePackument = JSON.stringify({
      'dist-tags': { rc: TARGET_VERSION },
      versions: {
        '0.1.0-rc.6': { dependencies: { '@deepseek-ai/dsh-agent-presets': '0.1.1-rc.2' } },
        '0.1.0-rc.7': { dependencies: { '@deepseek-ai/dsh-agent-presets': '0.1.1-rc.2' } },
        [TARGET_VERSION]: { dependencies: { '@deepseek-ai/dsh-agent-presets': '0.1.1-rc.2' } },
      },
      time: { '0.1.0-rc.6': '2026-08-20T00:00:00.000Z' },
    })
    const world = await mountWorld({ packument: noTimePackument })
    updaterInternals.spawnOnce = ((cmd: string, args: readonly string[]) => {
      if (args[0] === '--version') {
        return Promise.resolve({ code: 1, signal: null, stdout: '', stderr: '', timedOut: false })
      }
      if (cmd === 'npm') return Promise.resolve({ ...ok(), stdout: noTimePackument })
      if (cmd === 'pnpm') return Promise.resolve({ ...ok(), stdout: '60\n' })
      if (args[0] === 'plugin') {
        world.installAt('0.1.0-rc.6')
        return Promise.resolve(ok())
      }
      return Promise.resolve(ok())
    }) as typeof updaterInternals.spawnOnce
    const pending = world.ctx.commands.execute(world.agent, '/update', [], new AbortController().signal)
    const overlay = await world.waitOverlay()
    const form = overlay as { handleInput(data: string): void, render(width: number): string[] }
    // Both warnings ride the one subtitle line; render wide enough that
    // the panel does not truncate the second one away.
    const subtitle = form.render(240).join('\n')
    expect(subtitle).toContain(`v0.1.0-rc.6 → v${TARGET_VERSION}`)
    expect(subtitle).toContain('could not determine the installed dsh CLI version')
    expect(subtitle).toContain('publish time unknown')
    expect(subtitle).not.toContain('h ago')
    form.handleInput(KEY.escape)
    await pending
    world.dispose()
  })

  it('treats a missing pnpm probe as the default window', async () => {
    const world = await mountWorld({
      cooldownProbe: 'missing',
      packument: packumentJson({ rcTag: TARGET_VERSION, time: { [TARGET_VERSION]: '2026-08-24T23:00:00.000Z' } }),
    })
    const result = await world.run()
    expect(result).toEqual({ kind: 'success' })
    expect(overlayRows(world.screen)).toContain('minimumReleaseAge')
    world.dispose()
  })

  it('treats a failing or blank pnpm probe as the default window', async () => {
    for (const probe of ['fail', 'blank'] as const) {
      const world = await mountWorld({
        cooldownProbe: probe,
      packument: packumentJson({ rcTag: TARGET_VERSION, time: { [TARGET_VERSION]: '2026-08-24T23:00:00.000Z' } }),
      })
      const result = await world.run()
      expect(result, probe).toEqual({ kind: 'success' })
      expect(overlayRows(world.screen), probe).toContain('minimumReleaseAge')
      world.dispose()
    }
  })

  it('refuses a second concurrent run and releases the guard after settle', async () => {
    const world = await mountWorld()
    const pending = world.ctx.commands.execute(world.agent, '/update', [], new AbortController().signal)
    const overlay = await world.waitOverlay()
    // While the first run parks at the confirm form, a second /update is refused.
    const second = await world.run()
    expect(second).toEqual({ kind: 'error', text: 'an update is already in progress' })
    ;(overlay as { handleInput(data: string): void }).handleInput(KEY.escape)
    const execution = await pending
    expect(execution?.result).toEqual({ kind: 'success', text: 'update cancelled' })
    // The guard released with the settle: a third run reaches the confirm again.
    const overlaysBefore = world.screen.overlays.length
    const third = world.ctx.commands.execute(world.agent, '/update', [], new AbortController().signal)
    // waitOverlay returns overlays.at(-1), which is still the first run's
    // hidden form — wait for the NEW record before driving it.
    let thirdOverlay: unknown
    for (let i = 0; i < 100; i += 1) {
      if (world.screen.overlays.length > overlaysBefore) {
        thirdOverlay = world.screen.overlays.at(-1)!.component
        break
      }
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    expect(thirdOverlay).toBeDefined()
    ;(thirdOverlay as { handleInput(data: string): void }).handleInput(KEY.escape)
    const thirdExecution = await third
    expect(thirdExecution?.result).toEqual({ kind: 'success', text: 'update cancelled' })
    world.dispose()
  })

  it('settles the panel when the swap itself throws', async () => {
    const world = await mountWorld()
    // The snapshot's atomic rename dying (ENOSPC class) must not strand an
    // unsettled panel — it refuses to close mid-swap by design.
    updaterInternals.rename = () => {
      throw new Error('ENOSPC: no space left on device')
    }
    const pending = world.ctx.commands.execute(world.agent, '/update', [], new AbortController().signal)
    const overlay = await world.waitOverlay()
    const form = overlay as { handleInput(data: string): void }
    form.handleInput('y')
    form.handleInput(KEY.enter)
    const execution = await pending
    expect(execution?.result).toEqual({ kind: 'error', text: 'update failed — the repair recipe is in the update panel' })
    const rows = overlayRows(world.screen)
    expect(rows).toContain('the swap crashed')
    expect(rows).toContain('ENOSPC')
    expect(rows).toContain('the snapshot is at')
    const panelOverlay = world.screen.overlays.at(-1)?.component as { handleInput(data: string): void } | undefined
    expect(panelOverlay).toBeDefined()
    panelOverlay!.handleInput(KEY.escape)
    world.dispose()
  })

  it('settles the panel with a stringified message when the throw is not an Error', async () => {
    const world = await mountWorld()
    updaterInternals.rename = () => {
      throw 'disk full'
    }
    const pending = world.ctx.commands.execute(world.agent, '/update', [], new AbortController().signal)
    const overlay = await world.waitOverlay()
    const form = overlay as { handleInput(data: string): void }
    form.handleInput('y')
    form.handleInput(KEY.enter)
    const execution = await pending
    expect(execution?.result).toEqual({ kind: 'error', text: 'update failed — the repair recipe is in the update panel' })
    expect(overlayRows(world.screen)).toContain('the swap crashed: disk full')
    const panelOverlay = world.screen.overlays.at(-1)?.component as { handleInput(data: string): void } | undefined
    panelOverlay?.handleInput(KEY.escape)
    world.dispose()
  })

  it('flashes the registry-check progress and retry notices in the hint line', async () => {
    const world = await mountWorld()
    const notices: string[] = []
    setSharedEditor(world.ctx, {
      editor: world.ctx.get('blueComponents')!.createEditor(),
      submitPrompt: () => {},
      notice: text => notices.push(text),
    })
    const stub = updaterInternals.spawnOnce
    let npmFailures = 2
    updaterInternals.spawnOnce = ((cmd: string, args: readonly string[], opts?: { cwd?: string; timeoutMs?: number }) => {
      if (cmd === 'npm' && npmFailures > 0) {
        npmFailures -= 1
        return Promise.resolve({ code: 1, signal: null, stdout: '', stderr: 'ETIMEDOUT', timedOut: false })
      }
      return stub(cmd, args, opts)
    }) as typeof updaterInternals.spawnOnce
    const pending = world.ctx.commands.execute(world.agent, '/update', [], new AbortController().signal)
    const overlay = await world.waitOverlay()
    expect(notices).toContain('checking the registry for @dsh-blue/blue updates…')
    expect(notices).toContain('registry unreachable, retrying (2/3)…')
    expect(notices).toContain('registry unreachable, retrying (3/3)…')
    ;(overlay as { handleInput(data: string): void }).handleInput(KEY.escape)
    await pending
    world.dispose()
  })

  it('falls back to the rc channel when the settings channel is blank', async () => {
    const world = await mountWorld()
    class MemorySettings extends SettingsProvider {
      readonly writable = true
      private doc: Record<string, unknown> = {}
      protected async load(): Promise<Record<string, unknown>> {
        return this.doc
      }
      protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
        this.doc[String(ns)] = section
      }
    }
    const settings = new MemorySettings(world.ctx)
    // apply() registers the 'blue' settings namespace; the boot check's
    // notice mounts as a dock child, never an overlay, so it cannot race
    // the confirm form below.
    settingsPlugin.apply(world.ctx)
    updateCheck.apply(world.ctx)
    await new Promise(resolve => setTimeout(resolve, 5))
    await settings.update(settingsNamespace('blue'), { updateChannel: '' })
    await new Promise(resolve => setTimeout(resolve, 5))
    const pending = world.ctx.commands.execute(world.agent, '/update', [], new AbortController().signal)
    const overlay = await world.waitOverlay()
    ;(overlay as { handleInput(data: string): void }).handleInput(KEY.escape)
    const execution = await pending
    expect(execution?.result).toEqual({ kind: 'success', text: 'update cancelled' })
    world.dispose()
  })

  it('proceeds when no session is current', async () => {
    const world = await mountWorld({ sessionCurrent: 'null' })
    const pending = world.ctx.commands.execute(world.agent, '/update', [], new AbortController().signal)
    const overlay = await world.waitOverlay()
    ;(overlay as { handleInput(data: string): void }).handleInput(KEY.escape)
    const execution = await pending
    expect(execution?.result).toEqual({ kind: 'success', text: 'update cancelled' })
    world.dispose()
  })

  it('a downgrade target reinstalls the full target set in one transaction', async () => {
    const world = await mountWorld()
    // Move the profile to rc.7 (six packages) so rc.6 is a downgrade.
    rmSync(join(world.root, 'node_modules', '@dsh-blue'), { recursive: true, force: true })
    world.installAt('0.1.0-rc.7')
    const manifest = JSON.parse(String(updaterInternals.readTextFile(join(world.root, 'package.json')))) as Record<string, unknown>
    manifest.dependencies = { '@dsh-blue/blue': '0.1.0-rc.7' }
    updaterInternals.writeTextFile(join(world.root, 'package.json'), JSON.stringify(manifest))
    world.ctx.provide('agentDefaultModel', { currentSelection: () => ({ model: 'deepseek-chat marker', provider: 'x' }) })
    const pending = world.ctx.commands.execute(world.agent, '/update 0.1.0-rc.6', [], new AbortController().signal)
    const overlay = await world.waitOverlay()
    const form = overlay as { handleInput(data: string): void, render(width: number): string[] }
    // The downgrade warning rides the subtitle's tail; render wide enough
    // that the publish-age and host-line parts do not truncate it away.
    expect(form.render(260).join('\n')).toContain('downgrade reinstalls the full @dsh-blue set')
    form.handleInput('y')
    form.handleInput(KEY.enter)
    const execution = await pending
    expect(execution?.result?.kind).toBe('success')
    // The rc.6 release set has five members (blue-api joins later); a
    // bundle-only spec would leave the newer siblings behind.
    const install = world.spawns.find(call => call.args[0] === 'plugin')
    expect(install?.args).toEqual(['plugin', '--profile', 'blue', 'add', ...RC2_NAMES.map(name => `${name}@0.1.0-rc.6`)])
    const panelOverlay = world.screen.overlays.at(-1)?.component as { handleInput(data: string): void } | undefined
    panelOverlay?.handleInput(KEY.escape)
    world.dispose()
  })

  it('rolls back with the installed set when the registry does not know the old release', async () => {
    // The npm-view packument shape: versions are bare strings, so every
    // per-release deps block rides the targeted query — which here answers
    // nothing useful, leaving the from-release a one-member set and the
    // rollback set the discovered install.
    const npmViewPackument = JSON.stringify({
      'dist-tags': { rc: TARGET_VERSION },
      versions: ['0.1.0-rc.6', '0.1.0-rc.7', CURRENT_VERSION, TARGET_VERSION],
      time: { '0.1.0-rc.6': '2026-08-20T00:00:00.000Z', [TARGET_VERSION]: '2026-08-23T00:00:00.000Z' },
    })
    const world = await mountWorld({
      packument: npmViewPackument,
      installBehavior: specs => {
        if (specs[0]?.endsWith(`@${TARGET_VERSION}`) === true) {
          return { code: 1, signal: null, stdout: '', stderr: 'ERR_PNPM broken', timedOut: false }
        }
        world.installAt('0.1.0-rc.6')
        return ok()
      },
    })
    world.ctx.provide('agentDefaultModel', { currentSelection: () => ({ model: 'deepseek-chat marker', provider: 'x' }) })
    const pending = world.ctx.commands.execute(world.agent, '/update', [], new AbortController().signal)
    const overlay = await world.waitOverlay()
    const form = overlay as { handleInput(data: string): void }
    form.handleInput('y')
    form.handleInput(KEY.enter)
    const execution = await pending
    expect(execution?.result).toEqual({ kind: 'error', text: 'update failed — rolled back to v0.1.0-rc.6' })
    const reinstall = world.spawns.filter(call => call.args[0] === 'plugin').at(-1)
    expect(reinstall?.args.slice(4).sort()).toEqual(RC3_NAMES.map(name => `${name}@0.1.0-rc.6`).sort())
    world.dispose()
  })
})

/** Strip the fake theme's paint markers and any ANSI for row asserts. */
const plain = (rows: readonly string[]): string =>
  rows.join('\n').replace(/[\^_!]/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

/** The last overlay's rendered rows, cleaned, if one is mounted. */
function overlayRows(screen: FakeScreen): string {
  const component = screen.overlays.at(-1)?.component as { render(width: number): string[] } | undefined
  return plain(component?.render(120) ?? [])
}

/** Dispatch a deliberately unknown action through a mounted generic panel. */
function dispatchUnknownPanelAction(component: unknown): void {
  ;(component as { options: { onAction(action: { readonly kind: string }): void } })
    .options.onAction({ kind: 'fixture.unknown' })
}

describe('update panel model', () => {
  function mount(state = createUpdateProgressState()) {
    const display = fakeBlueContext()
    const closed = vi.fn()
    const panel = new CanonicalDocumentController({
      ...display,
      model: () => updatePanelModel(state, '0.1.0-rc.6', '0.1.0-rc.7'),
      onAction: vi.fn(),
      onClose: closed,
    })
    return { state, panel, closed }
  }

  it('renders the step ladder, refuses close mid-swap, and closes after settle', () => {
    const { state, panel, closed } = mount()
    expect(updatePanelSummary(state)).toBe('update panel closed')
    applyUpdateProgress(state, { step: 'snapshot', state: 'ok' })
    applyUpdateProgress(state, { step: 'install', state: 'start' })
    panel.handleInput(KEY.escape)
    panel.handleInput(KEY.enter)
    expect(closed).not.toHaveBeenCalled()
    let rows = plain(panel.render(80))
    expect(rows).toContain('v0.1.0-rc.6 → v0.1.0-rc.7')
    expect(rows).toContain('✓ snapshot')
    expect(rows).toContain('… install')
    expect(rows).not.toContain('rollback')
    expect(rows).toContain('updating - do not close')
    state.outcome = {
      kind: 'success', fromVersion: '0.1.0-rc.6', toVersion: '0.1.0-rc.7',
      message: 'updated — restart dsh to apply', logPath: '/tmp/update.log',
    }
    panel.invalidate()
    rows = plain(panel.render(80))
    expect(rows).toContain('restart dsh to apply')
    expect(rows).toContain('log: /tmp/update.log')
    panel.handleInput('\r')
    expect(closed).toHaveBeenCalledOnce()
    expect(updatePanelSummary(state)).toContain('restart dsh to apply')
  })

  it('renders blocked and rollback outcomes and summarizes failures', () => {
    const blocked = createUpdateProgressState()
    blocked.blockedMessage = 'the profile mixes link/file specs (@dsh-blue/blue)\nrepair the profile'
    expect(updatePanelModel(blocked, 'old', 'new')).toMatchObject({ mode: 'error', dismissible: true })
    expect(updatePanelSummary(blocked)).toContain('update blocked')

    const { state, panel, closed } = mount()
    applyUpdateProgress(state, { step: 'smoke-boot', state: 'fail' })
    applyUpdateProgress(state, { step: 'rollback', state: 'ok' })
    state.outcome = {
      kind: 'rolled-back', fromVersion: '0.1.0-rc.6', toVersion: '0.1.0-rc.7',
      message: 'boot smoke failed; rolled back', logPath: '/tmp/update.log',
    }
    const rows = plain(panel.render(80))
    expect(rows).toContain('✗ smoke: boot')
    expect(rows).toContain('✓ rollback')
    expect(updatePanelSummary(state)).toContain('did not complete')
    panel.handleInput('x')
    expect(closed).not.toHaveBeenCalled()
    panel.handleInput('q')
    panel.handleInput('Q')
    expect(closed).toHaveBeenCalledTimes(2)
  })
})
