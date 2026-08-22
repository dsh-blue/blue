/**
 * Tests for the swap executor (D52): the success path end to end, the
 * failure classifications, every rollback shape (rolled back, reinstall
 * failed, smoke still failing, the rc.1 floor refusal), the boot
 * smoke's marker/degraded/quit-ladder judgments, and the patch-entry
 * extraction — all driven through the io seam with a real temp profile
 * under the default fs seams.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempTracked } from '../../core/tests/temp-dir.ts'
import type { InteractiveChild, SpawnOutcome } from '../src/updater/io.ts'
import { updaterInternals } from '../src/updater/io.ts'
import {
  bootSmoke,
  classifyInstallFailure,
  importSweepSmoke,
  patchEntrySpecs,
  performSwap,
  type SwapOutcome,
  type SwapProgress,
} from '../src/updater/swap.ts'

/** The real seams, restored after every test. */
const REAL = { ...updaterInternals }

afterEach(() => {
  Object.assign(updaterInternals, REAL)
})

/** A successful spawn outcome. */
function ok(): SpawnOutcome {
  return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false }
}

/** A failed spawn outcome with the given output. */
function fail(output: string): SpawnOutcome {
  return { code: 1, signal: null, stdout: '', stderr: output, timedOut: false }
}

/** A scripted interactive child for the boot smoke. */
class FakeChild implements InteractiveChild {
  private text: string
  private exitedValue: SpawnOutcome | undefined
  private resolveExit: (outcome: SpawnOutcome) => void = () => {}
  private readonly exitedPromise: Promise<SpawnOutcome>
  private readonly onWrite: (data: string, self: FakeChild) => void

  constructor(options: {
    output?: string
    preExit?: SpawnOutcome
    onWrite?: (data: string, self: FakeChild) => void
  }) {
    this.text = options.output ?? ''
    this.onWrite = options.onWrite ?? (() => {})
    this.exitedPromise = new Promise(resolve => {
      this.resolveExit = resolve
    })
    if (options.preExit !== undefined) {
      this.exitedValue = options.preExit
      this.resolveExit(options.preExit)
    }
  }

  write(data: string): void {
    this.onWrite(data, this)
  }

  output(): string {
    return this.text
  }

  get exited(): Promise<SpawnOutcome> {
    return this.exitedPromise
  }

  kill(): void {
    if (this.exitedValue === undefined) {
      this.exitedValue = { code: null, signal: 'SIGTERM', stdout: '', stderr: '', timedOut: true }
      this.resolveExit(this.exitedValue)
    }
  }

  /** Resolve the exit promise with a clean exit. */
  exitOk(): void {
    this.exitWith(ok())
  }

  /** Resolve the exit promise with an arbitrary outcome. */
  exitWith(outcome: SpawnOutcome): void {
    if (this.exitedValue === undefined) {
      this.exitedValue = outcome
      this.resolveExit(this.exitedValue)
    }
  }
}

/** One scripted world: a temp profile at fromVersion plus fake spawns. */
function makeWorld(fromVersion = '0.1.0-rc.2') {
  const root = mkdtempTracked('blue-updater-swap-')
  const bundleDir = join(root, 'node_modules', '@dsh-blue', 'blue')
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(join(bundleDir, 'cordis.patch.yml'), [
    "- id: blue-api-host",
    "  name: '@dsh-blue/blue-api'",
    "- id: blue-core",
    "  name: '@dsh-blue/blue-core'",
    "- id: blue-theme-dark",
    "  name: '@dsh-blue/blue-core/theme-dark'",
    // The real bundle's inserted row — overlaps RUNTIME_DEPS on purpose.
    "- id: agent-presets",
    "  name: '@deepseek-ai/dsh-agent-presets'",
    '',
  ].join('\n'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'profile', dependencies: { '@dsh-blue/blue': fromVersion } }))
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  const installAt = (version: string): void => {
    for (const name of version.endsWith('rc.3') ? RC3_NAMES : RC2_NAMES) {
      const dir = join(root, 'node_modules', name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }))
    }
  }
  installAt(fromVersion)

  /** Spawn calls the executor made, for assertions. */
  const spawns: Array<{ cmd: string; args: string[] }> = []
  /** What the next `plugin add` install does. */
  let installBehavior: (specs: string[]) => SpawnOutcome = () => ok()
  /** What the next import sweep returns (and whether it also installs). */
  let sweepBehavior: () => SpawnOutcome = () => ok()
  /** The next interactive child the boot smoke gets. */
  let bootChildFactory: () => InteractiveChild = () =>
    new FakeChild({
      output: 'deepseek-chat marker',
      onWrite: (data, self) => {
        if (data.includes('/quit')) self.exitOk()
      },
    })

  updaterInternals.spawnOnce = ((cmd: string, args: readonly string[], opts?: { cwd?: string; timeoutMs?: number }) => {
    spawns.push({ cmd, args: [...args] })
    expect(opts?.timeoutMs).toBeGreaterThan(0)
    if (cmd === process.execPath) return Promise.resolve(sweepBehavior())
    if (args[0] === 'plugin') {
      const specs = args.filter(arg => arg.startsWith('@dsh-blue/'))
      return Promise.resolve(installBehavior(specs))
    }
    return Promise.resolve(ok())
  }) as typeof updaterInternals.spawnOnce
  updaterInternals.spawnInteractive = (() => bootChildFactory()) as typeof updaterInternals.spawnInteractive
  updaterInternals.sleep = () => Promise.resolve()
  let clock = 1_000_000_000_000
  updaterInternals.now = () => {
    clock += 250
    return clock
  }

  return {
    root,
    spawns,
    installAt,
    onInstall(behavior: (specs: string[]) => SpawnOutcome): void {
      installBehavior = behavior
    },
    onSweep(behavior: () => SpawnOutcome): void {
      sweepBehavior = behavior
    },
    onBoot(factory: () => InteractiveChild): void {
      bootChildFactory = factory
    },
  }
}

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

/** The standard swap input against a world. */
function swapInput(world: ReturnType<typeof makeWorld>, overrides: Partial<Parameters<typeof performSwap>[0]> = {}) {
  return {
    root: world.root,
    profile: 'blue',
    dshBin: '/usr/bin/dsh',
    fromVersion: '0.1.0-rc.2',
    toVersion: '0.1.0-rc.3',
    packageNames: RC3_NAMES,
    bootMarker: 'deepseek-chat marker',
    ...overrides,
  }
}

describe('updater/swap classifyInstallFailure', () => {
  it('translates each failure class', () => {
    expect(classifyInstallFailure('ERR_PNPM minimumReleaseAge: 1440 minutes')).toContain('cooldown window')
    expect(classifyInstallFailure('fetch failed: ENOTFOUND registry.npmjs.org')).toContain('unreachable')
    expect(classifyInstallFailure('404 Not Found: @dsh-blue/blue@9.9.9')).toContain('does not serve this version')
    expect(classifyInstallFailure('EACCES: permission denied')).toContain('not writable')
    expect(classifyInstallFailure('boom\nlast line stands')).toContain('last line stands')
    expect(classifyInstallFailure('   \n')).toBe('the install failed')
  })
})

describe('updater/swap patchEntrySpecs', () => {
  it('extracts the @dsh-blue name rows with dedupe, skipping host rows', () => {
    const world = makeWorld()
    // A repeated Blue row proves the dedupe; the runtime dsh row (its
    // peers come from the host at boot) stays out of the sweep.
    const patch = join(world.root, 'node_modules', '@dsh-blue', 'blue', 'cordis.patch.yml')
    writeFileSync(patch, `${readFileSync(patch, 'utf8')}- id: blue-core-again\n  name: '@dsh-blue/blue-core'\n`)
    expect(patchEntrySpecs(world.root)).toEqual([
      '@dsh-blue/blue-api',
      '@dsh-blue/blue-core',
      '@dsh-blue/blue-core/theme-dark',
    ])
  })

  it('falls back to an empty list when the patch file is missing', () => {
    const world = makeWorld()
    writeFileSync(join(world.root, 'node_modules', '@dsh-blue', 'blue', 'cordis.patch.yml'), 'no entries here\n')
    expect(patchEntrySpecs(world.root)).toEqual([])
    rmSync(join(world.root, 'node_modules', '@dsh-blue', 'blue', 'cordis.patch.yml'))
    expect(patchEntrySpecs(world.root)).toEqual([])
  })
})

describe('updater/swap importSweepSmoke', () => {
  it('passes on a zero exit and fails otherwise, logging the output', async () => {
    const world = makeWorld()
    world.onSweep(() => ok())
    await expect(importSweepSmoke(world.root)).resolves.toBe(true)
    world.onSweep(() => fail('ERR_MODULE_NOT_FOUND: chunk-abc'))
    await expect(importSweepSmoke(world.root)).resolves.toBe(false)
    const log = readFileSync(join(world.root, '.blue-update-backup', 'update.log'), 'utf8')
    expect(log).toContain('ERR_MODULE_NOT_FOUND')
  })

  it('runs the sweep with module input against the profile cwd', async () => {
    const world = makeWorld()
    world.onSweep(() => ok())
    await importSweepSmoke(world.root)
    const sweep = world.spawns.find(call => call.cmd === process.execPath)
    expect(sweep?.args).toContain('--input-type=module')
  })
})

describe('updater/swap bootSmoke', () => {
  it('passes when the marker appears and /quit exits 0', async () => {
    const world = makeWorld()
    await expect(bootSmoke(swapInput(world))).resolves.toBe(true)
  })

  it('fails when the boot exits early', async () => {
    const world = makeWorld()
    world.onBoot(() => new FakeChild({ preExit: fail('ERR_MODULE_NOT_FOUND') }))
    await expect(bootSmoke(swapInput(world))).resolves.toBe(false)
    const log = readFileSync(join(world.root, '.blue-update-backup', 'update.log'), 'utf8')
    expect(log).toContain('boot exited early')
  })

  it('reports a signal-only early exit', async () => {
    const world = makeWorld()
    world.onBoot(() =>
      new FakeChild({ preExit: { code: null, signal: 'SIGKILL', stdout: '', stderr: '', timedOut: false } }),
    )
    await expect(bootSmoke(swapInput(world))).resolves.toBe(false)
    const log = readFileSync(join(world.root, '.blue-update-backup', 'update.log'), 'utf8')
    expect(log).toContain('code null signal SIGKILL')
  })

  it('fails when the marker never appears', async () => {
    const world = makeWorld()
    world.onBoot(() => new FakeChild({ output: 'silence' }))
    await expect(bootSmoke(swapInput(world))).resolves.toBe(false)
    const log = readFileSync(join(world.root, '.blue-update-backup', 'update.log'), 'utf8')
    expect(log).toContain('marker never appeared')
  })

  it('degrades to alive-without-crash when no marker was provided', async () => {
    const world = makeWorld()
    world.onBoot(() =>
      new FakeChild({
        output: '',
        onWrite: (data, self) => {
          if (data.includes('/quit')) self.exitOk()
        },
      }),
    )
    await expect(bootSmoke(swapInput(world, { bootMarker: undefined }))).resolves.toBe(true)
    const log = readFileSync(join(world.root, '.blue-update-backup', 'update.log'), 'utf8')
    expect(log).toContain('degraded judgment')
  })

  it('falls back to the double Ctrl-C when /quit is ignored', async () => {
    const world = makeWorld()
    let interrupts = 0
    world.onBoot(() =>
      new FakeChild({
        output: 'deepseek-chat marker',
        onWrite: (data, self) => {
          if (data === '\x03') {
            interrupts += 1
            if (interrupts === 2) self.exitOk()
          }
        },
      }),
    )
    await expect(bootSmoke(swapInput(world))).resolves.toBe(true)
    expect(interrupts).toBe(2)
  })

  it('fails and kills when the quit ladder never lands', async () => {
    const world = makeWorld()
    world.onBoot(() => new FakeChild({ output: 'deepseek-chat marker' }))
    await expect(bootSmoke(swapInput(world))).resolves.toBe(false)
    const log = readFileSync(join(world.root, '.blue-update-backup', 'update.log'), 'utf8')
    expect(log).toContain('never exited after the quit ladder')
  })

  it('fails when the quit exits nonzero', async () => {
    const world = makeWorld()
    world.onBoot(() =>
      new FakeChild({
        output: 'deepseek-chat marker',
        onWrite: (data, self) => {
          if (data.includes('/quit')) self.exitWith(fail('crash'))
        },
      }),
    )
    await expect(bootSmoke(swapInput(world))).resolves.toBe(false)
    const log = readFileSync(join(world.root, '.blue-update-backup', 'update.log'), 'utf8')
    expect(log).toContain('boot quit with code 1')
  })
})

describe('updater/swap performSwap', () => {
  it('succeeds end to end: snapshot, install, verify, both smokes', async () => {
    const world = makeWorld()
    world.onInstall(() => {
      world.installAt('0.1.0-rc.3')
      return ok()
    })
    const events: SwapProgress[] = []
    const outcome = await performSwap(swapInput(world, { onProgress: event => events.push(event) }))
    expect(outcome.kind).toBe('success')
    expect(outcome.message).toContain('restart dsh to apply')
    // The install is one exact-version transaction.
    const install = world.spawns.find(call => call.args[0] === 'plugin')
    expect(install?.args).toEqual(['plugin', '--profile', 'blue', 'add', '@dsh-blue/blue@0.1.0-rc.3'])
    // The snapshot recorded the intent with the files it preserved.
    const snapshot = readFileSync(join(world.root, '.blue-update-backup', 'manifest.json'), 'utf8')
    expect(snapshot).toContain('"fromVersion": "0.1.0-rc.2"')
    expect(snapshot).toContain('"pnpm-lock.yaml"')
    // The step ladder ran in order.
    expect(events.map(event => event.step)).toEqual([
      'snapshot', 'snapshot',
      'install', 'install',
      'verify', 'verify',
      'smoke-imports', 'smoke-imports',
      'smoke-boot', 'smoke-boot',
      'done',
    ])
    expect(events.every(event => event.state !== 'fail')).toBe(true)
    const log = readFileSync(join(world.root, '.blue-update-backup', 'update.log'), 'utf8')
    expect(log).toContain('=== success')
  })

  it('classifies a cooldown install failure and rolls the full set back', async () => {
    const world = makeWorld()
    world.onInstall(specs => {
      if (specs.some(spec => spec.includes('@0.1.0-rc.3'))) {
        return fail('ERR_PNPM minimumReleaseAge: version too recently published')
      }
      world.installAt('0.1.0-rc.2')
      return ok()
    })
    const outcome = await performSwap(swapInput(world))
    expectRollback(outcome, 'cooldown window')
    const rollback = world.spawns.filter(call => call.args[0] === 'plugin').pop()
    expect(rollback?.args.slice(0, 4)).toEqual(['plugin', '--profile', 'blue', 'add'])
    for (const name of RC3_NAMES) {
      expect(rollback?.args).toContain(`${name}@0.1.0-rc.2`)
    }
    // The snapshot's package.json was restored before the reinstall.
    const manifest = readFileSync(join(world.root, 'package.json'), 'utf8')
    expect(manifest).toContain('0.1.0-rc.2')
  })

  it('rolls back when the post-install set is not one version', async () => {
    const world = makeWorld()
    world.onInstall(() => ok())
    const outcome = await performSwap(swapInput(world))
    expectRollback(outcome, 'set check failed')
  })

  it('rolls back when the import smoke fails', async () => {
    const world = makeWorld()
    world.onInstall(specs => {
      // The forward install lands rc.3; the rollback reinstall lands rc.2.
      const target = specs[0]?.endsWith('@0.1.0-rc.3') === true ? '0.1.0-rc.3' : '0.1.0-rc.2'
      world.installAt(target)
      return ok()
    })
    let sweeps = 0
    world.onSweep(() => {
      sweeps += 1
      // The post-install sweep fails; the post-rollback sweep passes.
      return sweeps === 1 ? fail('ERR_MODULE_NOT_FOUND: chunk-xyz') : ok()
    })
    const outcome = await performSwap(swapInput(world))
    expectRollback(outcome, 'import smoke failed')
  })

  it('rolls back when the boot smoke fails', async () => {
    const world = makeWorld()
    world.onInstall(() => {
      world.installAt('0.1.0-rc.3')
      return ok()
    })
    world.onBoot(() => new FakeChild({ preExit: fail('boot crash') }))
    const outcome = await performSwap(swapInput(world))
    expectRollback(outcome, 'boot smoke failed')
  })

  it('refuses to roll back onto a pre-floor version and hands the recipe', async () => {
    const world = makeWorld('0.1.0-rc.1')
    world.onInstall(() => fail('ERR_PNPM anything'))
    const outcome = await performSwap(swapInput(world, { fromVersion: '0.1.0-rc.1' }))
    expect(outcome.kind).toBe('failed-no-rollback')
    expect(outcome.message).toContain('repair:')
    expect(outcome.message).toContain('0.1.0-rc.2')
    // No reinstall was attempted.
    expect(world.spawns.filter(call => call.args[0] === 'plugin')).toHaveLength(1)
  })

  it('reports an incomplete rollback when the reinstall fails', async () => {
    const world = makeWorld()
    world.onInstall(() => fail('ERR_PNPM nope'))
    const outcome = await performSwap(swapInput(world))
    expect(outcome.kind).toBe('rollback-incomplete')
    expect(outcome.message).toContain('manual repair')
  })

  it('reports an incomplete rollback when the post-rollback smoke fails', async () => {
    const world = makeWorld()
    world.onInstall(specs => {
      // The forward install fails; the rollback reinstall succeeds.
      if (specs[0]?.endsWith('@0.1.0-rc.3') === true) return fail('ERR_PNPM nope')
      world.installAt('0.1.0-rc.2')
      return ok()
    })
    world.onSweep(() => fail('still broken'))
    const outcome = await performSwap(swapInput(world))
    expect(outcome.kind).toBe('rollback-incomplete')
    expect(outcome.message).toContain('rolled back but the import smoke still fails')
  })
})

/** Assert the common shape of a rolled-back outcome. */
function expectRollback(outcome: SwapOutcome, messagePart: string): void {
  expect(outcome.kind).toBe('rolled-back')
  expect(outcome.message).toContain(messagePart)
  expect(outcome.message).toContain('rolled back to 0.1.0-rc.2')
}
