/**
 * Unit tests for the `/skills` command: the pure section builder (the
 * source-layer folding, the per-skill rows, the `user-only` marker) and the
 * command over the real runtime — the panel mount against a fake `skills`
 * service, its Escape close, and the no-session / empty-catalog guards.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as commandsPlugin from '../src/commands-plugin.ts'
import type { InfoPanel } from '../src/info-panel.ts'
import { buildSkillsSections } from '../src/skills-command.ts'
import { fakeBlueContext, type FakeScreen } from './fakes.ts'

/** One summary double. */
function skill(name: string, options: {
  source?: SkillSummary['source']
  whenToUse?: string
  modelInvocable?: boolean
} = {}): SkillSummary {
  return {
    name,
    description: `The ${name} skill`,
    ...(options.whenToUse !== undefined ? { whenToUse: options.whenToUse } : {}),
    invocation: { modelInvocable: options.modelInvocable ?? true, userInvocable: true },
    source: options.source ?? 'custom',
    provider: 'spec',
  }
}

/** Strip SGR and the fake palette's marker characters so assertions read visible text. */
function plain(rows: readonly string[]): readonly string[] {
  return rows.map(row => row.replace(/\x1b\[[0-9;]*m/g, '').replace(/[~^#]/g, ''))
}

describe('buildSkillsSections', () => {
  it('folds the source layers into ordered sections', () => {
    const sections = buildSkillsSections([
      skill('user-tool', { source: 'user-dsh' }),
      skill('custom-tool', { source: 'custom' }),
      skill('bundled-tool', { source: 'bundled' }),
      skill('project-tool', { source: 'project-agents' }),
    ])
    expect(sections.map(section => section.heading)).toEqual(['Project', 'User', 'custom', 'bundled'])
    expect(sections[0]!.rows[0]!.label).toBe('project-tool')
    expect(sections[1]!.rows[0]!.label).toBe('user-tool')
  })

  it('lists each skill as its name row, description, and whenToUse', () => {
    const sections = buildSkillsSections([
      skill('deploy-check', { whenToUse: 'Before every release' }),
      skill('summarize'),
    ])
    expect(sections[0]!.rows).toEqual([
      { label: 'deploy-check', segments: [] },
      { label: '', segments: [{ text: 'The deploy-check skill', style: 'muted' }] },
      { label: '', segments: [{ text: 'Before every release', style: 'textMuted' }] },
      { label: 'summarize', segments: [] },
      { label: '', segments: [{ text: 'The summarize skill', style: 'muted' }] },
    ])
  })

  it('marks model-only-unavailable skills with the user-only badge', () => {
    const sections = buildSkillsSections([skill('deploy-check', { modelInvocable: false })])
    expect(sections[0]!.rows[0]).toEqual({
      label: 'deploy-check',
      segments: [{ text: 'user-only', style: 'muted' }],
    })
  })
})

async function mount(options: {
  withAgent?: boolean
  display?: boolean
  skills?: readonly SkillSummary[]
} = {}): Promise<{ ctx: Context, screen: FakeScreen | undefined, agent: Agent }> {
  const base = fakeBlueContext({ display: options.display })
  const { ctx } = base
  const screen = base.screen
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('skills-spec'))
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  if (options.withAgent !== false) {
    ctx.provide('testSession', { current: agent, modelRef: undefined })
  }
  if (options.skills !== undefined) {
    ctx.provide('skills', {
      snapshot: () => Promise.resolve({ skills: options.skills!, complete: true }),
    })
  }
  ctx.emit('test/session-changed', agent)
  await ctx.plugin(commandsPlugin)
  return { ctx, screen, agent }
}

async function run(ctx: Context, agent: Agent) {
  const execution = await ctx.commands.execute(agent, '/skills', [], new AbortController().signal)
  return execution?.result
}

describe('registerSkillsCommand', () => {
  it('registers the command on the runtime', async () => {
    const { ctx } = await mount()
    expect(ctx.commands.list().map(command => command.name)).toContain('skills')
  })

  it('mounts the read-only panel over the live catalog and closes on Escape', async () => {
    const { ctx, screen, agent } = await mount({
      skills: [
        skill('deploy-check', { source: 'project-dsh', whenToUse: 'Before every release' }),
        skill('summarize', { source: 'custom', modelInvocable: false }),
      ],
    })
    const result = await run(ctx, agent)
    expect(result).toEqual({ kind: 'success' })
    const overlay = screen.overlays.at(-1)!
    expect(overlay.hidden).toBe(false)
    const rows = plain((overlay.component as InfoPanel).render(80))
    expect(rows.some(row => row.includes('skills'))).toBe(true)
    expect(rows.some(row => row.includes('Project'))).toBe(true)
    expect(rows.some(row => row.includes('deploy-check'))).toBe(true)
    expect(rows.some(row => row.includes('The deploy-check skill'))).toBe(true)
    expect(rows.some(row => row.includes('Before every release'))).toBe(true)
    expect(rows.some(row => row.includes('custom'))).toBe(true)
    expect(rows.some(row => row.includes('user-only'))).toBe(true)
    overlay.component.handleInput?.('\x1b')
    expect(overlay.hidden).toBe(true)
  })

  it('answers with a notice when the catalog is empty', async () => {
    const { ctx, agent } = await mount({ skills: [] })
    await expect(run(ctx, agent)).resolves.toEqual({ kind: 'success', text: 'no skills' })
  })

  it('answers with a notice when no skills service is composed', async () => {
    const { ctx, agent } = await mount()
    await expect(run(ctx, agent)).resolves.toEqual({ kind: 'success', text: 'no skills' })
  })

  it('guards with an error when no session is attached', async () => {
    const { ctx, agent } = await mount({ withAgent: false, skills: [skill('deploy-check')] })
    await expect(run(ctx, agent)).resolves.toEqual({ kind: 'error', text: 'no active session' })
  })

  it('guards with an error when the Blue screen is not mounted', async () => {
    const { ctx, agent } = await mount({ display: false, skills: [skill('deploy-check')] })
    await expect(run(ctx, agent)).resolves.toEqual({
      kind: 'error',
      text: 'skills panel is unavailable: the Blue screen is not mounted',
    })
  })
})
