/** Native dsh projection and command-backed mode cycling tests.
 * @module @dsh-blue/blue-interaction/tests/mode-commands
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { cycleMode, sessionModeSnapshot } from '../src/mode-commands.ts'
import { setSharedEditor } from '../src/editor-instance.ts'
import type { PermissionPresetsService } from '../src/permission-panel.ts'
import { fakeBlueContext } from './fakes.ts'

let notices: string[] = []

afterEach(() => { notices = [] })

interface PlanState { active: boolean, pending: boolean }
interface MountOptions {
  readonly attached?: boolean
  readonly plan?: false | Partial<PlanState>
  readonly presets?: false | readonly { readonly name: string, readonly sandbox: string, readonly approval: string }[]
  readonly currentPreset?: string
  readonly registerPlan?: boolean
  readonly registerPermission?: boolean
  readonly resultFor?: (line: string) => { kind: 'success' | 'error', text?: string }
  readonly throws?: unknown
}

async function mount(options: MountOptions = {}) {
  const { ctx } = fakeBlueContext()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('mode-spec'))
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  ctx.provide('testSession', { current: options.attached === false ? null : agent })
  const plan = options.plan === false ? undefined : { active: options.plan?.active === true, pending: options.plan?.pending === true }
  vi.spyOn(ctx.sessionProjections, 'snapshot').mockImplementation(() => ({
    asOfSeq: session.events.length - 1,
    values: plan === undefined ? {} : { plan: { ...plan } },
  }))

  const presetRows = options.presets === false
    ? undefined
    : options.presets ?? [
      { name: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' },
      { name: 'danger-full-access', sandbox: 'danger-full-access', approval: 'never' },
    ]
  let currentPreset = options.currentPreset ?? 'workspace-write'
  if (presetRows !== undefined) {
    ctx.provide('permissionPresets', {
      names: presetRows.map(row => row.name),
      current: () => currentPreset,
      resolve: name => {
        const row = presetRows.find(entry => entry.name === name)
        if (row === undefined) throw new Error(`missing preset ${name}`)
        return row
      },
      optionOf: name => ({ value: name, name }),
    } satisfies PermissionPresetsService as never)
  }

  const runs: string[] = []
  const execute = (line: string) => {
    runs.push(line)
    if (options.throws !== undefined) throw options.throws
    const result = options.resultFor?.(line) ?? { kind: 'success' as const, text: `ran ${line}` }
    if (result.kind === 'success') {
      if (line === '/plan' && plan !== undefined) { plan.active = true; plan.pending = false }
      if (line === '/plan off' && plan !== undefined) { plan.active = false; plan.pending = false }
      if (line.startsWith('/permission ')) currentPreset = line.slice('/permission '.length)
    }
    return result
  }
  if (options.registerPlan !== false) {
    ctx.commands.register({
      name: 'plan', description: 'Toggle plan mode',
      handler: invocation => execute(`/plan${invocation.rawInput}`),
    })
  }
  if (options.registerPermission !== false) {
    ctx.commands.register({
      name: 'permission', description: 'Switch permission preset',
      handler: invocation => execute(`/permission${invocation.rawInput}`),
    })
  }
  setSharedEditor(ctx, {
    editor: { focused: false, render: () => [], invalidate: () => {} } as never,
    submitPrompt: () => {},
    notice: text => { notices.push(text) },
  })
  return { ctx, agent, plan, runs, currentPreset: () => currentPreset }
}

describe('cycleMode', () => {
  it('cycles normal -> plan -> yolo -> normal through native commands', async () => {
    const world = await mount()
    expect(sessionModeSnapshot(world.ctx, world.agent).mode).toBe('normal')

    await cycleMode(world.ctx)
    expect(world.runs).toEqual(['/plan'])
    expect(sessionModeSnapshot(world.ctx, world.agent).mode).toBe('plan')

    await cycleMode(world.ctx)
    expect(world.runs).toEqual(['/plan', '/plan off', '/permission danger-full-access'])
    expect(world.currentPreset()).toBe('danger-full-access')
    expect(sessionModeSnapshot(world.ctx, world.agent).mode).toBe('yolo')

    await cycleMode(world.ctx)
    expect(world.runs).toEqual(['/plan', '/plan off', '/permission danger-full-access', '/permission workspace-write'])
    expect(world.currentPreset()).toBe('workspace-write')
    expect(sessionModeSnapshot(world.ctx, world.agent).mode).toBe('normal')
    expect(notices).toEqual(['ran /plan', 'ran /permission danger-full-access', 'ran /permission workspace-write'])
  })

  it('turns off a concurrent plan selection when leaving yolo', async () => {
    const world = await mount({ plan: { active: true }, currentPreset: 'danger-full-access' })
    expect(sessionModeSnapshot(world.ctx, world.agent).mode).toBe('yolo')
    await cycleMode(world.ctx)
    expect(world.runs).toEqual(['/plan off', '/permission workspace-write'])
  })

  it('degrades to the available native axis', async () => {
    const permissionsOnly = await mount({ plan: false })
    await cycleMode(permissionsOnly.ctx)
    expect(permissionsOnly.runs).toEqual(['/permission danger-full-access'])

    notices = []
    const planOnly = await mount({ plan: { active: true }, presets: false })
    await cycleMode(planOnly.ctx)
    expect(planOnly.runs).toEqual(['/plan off'])

    notices = []
    const absent = await mount({ plan: false, presets: false })
    await cycleMode(absent.ctx)
    expect(notices).toEqual(['mode switching is unavailable'])
  })

  it('reports a yolo table that has no normal preset', async () => {
    const world = await mount({
      plan: false,
      currentPreset: 'unconfined',
      presets: [{ name: 'unconfined', sandbox: 'danger-full-access', approval: 'never' }],
    })
    await cycleMode(world.ctx)
    expect(world.runs).toEqual([])
    expect(notices).toEqual(['normal mode is unavailable: no workspace-write/ask permission preset'])
  })

  it('publishes the last success, paints errors, and keeps textless success quiet', async () => {
    const failed = await mount({
      plan: { active: true },
      resultFor: line => line === '/plan off'
        ? { kind: 'success', text: 'left plan' }
        : { kind: 'error', text: 'denied' },
    })
    await cycleMode(failed.ctx)
    expect(failed.runs).toEqual(['/plan off', '/permission danger-full-access'])
    expect(notices).toEqual(['!denied!'])

    notices = []
    const textless = await mount({ resultFor: () => ({ kind: 'success' }) })
    await cycleMode(textless.ctx)
    expect(notices).toEqual([])
  })

  it('guards detached sessions and missing native commands', async () => {
    const detached = await mount({ attached: false })
    await cycleMode(detached.ctx)
    expect(notices).toEqual(['no session is live yet'])

    notices = []
    const missing = await mount({ registerPlan: false })
    await cycleMode(missing.ctx)
    expect(notices).toEqual(['mode command is unavailable: /plan'])
  })

  it('contains command dispatch failures in the logger', async () => {
    const world = await mount({ throws: new Error('dispatch failed') })
    const warn = vi.spyOn(world.ctx.logger, 'warn').mockImplementation(() => {})
    await cycleMode(world.ctx)
    expect(warn).toHaveBeenCalledWith('mode cycle dispatch failed: dispatch failed')

    const bare = await mount({ throws: 'bare failure' })
    const bareWarn = vi.spyOn(bare.ctx.logger, 'warn').mockImplementation(() => {})
    await cycleMode(bare.ctx)
    expect(bareWarn).toHaveBeenCalledWith('mode cycle dispatch failed: bare failure')
  })
})
