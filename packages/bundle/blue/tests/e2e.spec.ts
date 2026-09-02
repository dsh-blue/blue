/** Whole-tree direct Cordis composition tests.
 * @module @dsh-blue/blue/tests/e2e
 */

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { waitForRender } from '../../../core/tests/fake-terminal.ts'
import {
  bootDirectBlue,
  currentAgent,
  executeDirectOverlay,
  resetDirectBlue,
} from './e2e-boot.ts'

afterEach(async () => { await resetDirectBlue() })

async function waitForSelections(count: number, tree: Awaited<ReturnType<typeof bootDirectBlue>>): Promise<void> {
  for (let turn = 0; turn < 100; turn += 1) {
    if (tree.observations.selectedAgents.length >= count) return
    await Promise.resolve()
  }
  throw new Error(`expected ${String(count)} Agent selections`)
}

describe('Blue direct-service whole tree', () => {
  it('boots actual API, app, theme, and core rows through the real Loader', async () => {
    const tree = await bootDirectBlue()
    const agent = await currentAgent(tree)
    expect(tree.exits).toEqual([])
    expect(tree.ctx.get('bluePanes')).toBeDefined()
    expect(tree.ctx.get('blueStatus')).toBeDefined()
    expect(tree.ctx.get('blueOverlays')).toBeDefined()
    expect(tree.ctx.get('blueEditorExtensions')).toBeDefined()
    expect(tree.ctx.get('blueCurrentAgent')).toBeDefined()
    expect(tree.observations.selectedAgents).toEqual([agent])
  })

  it('gives an ordinary sibling native dsh services and Blue UI seams directly', async () => {
    const tree = await bootDirectBlue()
    const agent = await currentAgent(tree)
    expect(tree.observations.serviceVisibility).toMatchObject({
      commands: true,
      sessionProjections: true,
      tools: true,
      jobs: true,
      subagents: true,
      sessions: true,
      blueCurrentAgent: true,
      bluePanes: true,
      blueStatus: true,
      blueOverlays: true,
      blueEditorExtensions: true,
    })
    expect(tree.projections.calls.at(-1)).toEqual({ session: agent.session, keys: ['blueConversation'] })
    expect(tree.tools.scopes.at(-1)).toBe(agent)
  })

  it('renders a direct canonical pane and exposes direct status/editor state', async () => {
    const tree = await bootDirectBlue()
    await currentAgent(tree)
    expect(tree.ctx.bluePanes.list().map(entry => entry.id)).toEqual(['e2e.direct-pane'])
    expect(tree.ctx.blueStatus.list().map(entry => entry.id)).toEqual(['e2e.direct-status'])
    expect(tree.ctx.blueEditorExtensions.list().map(entry => entry.id)).toEqual(['e2e.direct-editor'])
    tree.ctx.blueScreen.requestRender(true)
    await waitForRender()
    expect(tree.terminal.output).toContain('native dsh + Blue seam')
  })

  it('opens a capturing overlay from a native command without a gesture token', async () => {
    const tree = await bootDirectBlue()
    await currentAgent(tree)
    await expect(executeDirectOverlay(tree)).resolves.toEqual({ kind: 'success' })
    expect(tree.ctx.blueOverlays.list().map(entry => entry.id)).toEqual(['e2e.direct-overlay'])
    tree.ctx.blueScreen.requestRender(true)
    await waitForRender()
    expect(tree.terminal.output).toContain('Direct overlay')
    expect(tree.terminal.output).toContain('opened through the direct Blue service')
  })

  it('removes every direct contribution when the sibling Fiber unloads', async () => {
    const tree = await bootDirectBlue()
    await currentAgent(tree)
    await executeDirectOverlay(tree)
    const entry = [...tree.ctx.loader.entries()].find(candidate => candidate.options.id === 'direct-sibling')
    expect(entry).toBeDefined()
    await tree.ctx.loader.update(entry!.id, { disabled: true })
    await tree.ctx.loader.await()
    expect(tree.ctx.bluePanes.list()).toEqual([])
    expect(tree.ctx.blueStatus.list()).toEqual([])
    expect(tree.ctx.blueOverlays.list()).toEqual([])
    expect(tree.ctx.blueEditorExtensions.list()).toEqual([])
    expect(tree.commands.find('direct-overlay')).toBeUndefined()
  })

  it('replays registry state after a core renderer gap without a host buffer', async () => {
    const tree = await bootDirectBlue()
    await currentAgent(tree)
    tree.ctx.bluePanes.register({
      id: 'e2e.renderer-independent',
      placement: 'bottom',
      render: () => ({ kind: 'text', content: 'registry survives renderer gaps' }),
    })
    const entry = [...tree.ctx.loader.entries()].find(candidate => candidate.options.id === 'blue-core')
    expect(entry).toBeDefined()
    await tree.ctx.loader.update(entry!.id, { disabled: true })
    await tree.ctx.loader.await()
    expect(tree.ctx.get('blueScreen')).toBeUndefined()
    expect(tree.ctx.bluePanes.list().map(pane => pane.id)).toEqual(['e2e.renderer-independent'])
    await tree.ctx.loader.update(entry!.id, { disabled: false })
    await tree.ctx.loader.await()
    tree.ctx.blueScreen.requestRender(true)
    await waitForRender()
    expect(tree.ctx.bluePanes.list().map(pane => pane.id)).toContain('e2e.renderer-independent')
    expect(tree.terminal.output).toContain('registry survives renderer gaps')
  })

  it('passes every newly selected exact Agent to native scoped services', async () => {
    const tree = await bootDirectBlue()
    const initial = await currentAgent(tree)
    tree.ctx.emit('blue/request-new')
    await waitForSelections(2, tree)
    const fresh = tree.observations.selectedAgents.at(-1)!
    expect(fresh).not.toBe(initial)
    expect(tree.tools.scopes.at(-1)).toBe(fresh)
    expect(tree.projections.calls.at(-1)?.session).toBe(fresh.session)

    tree.ctx.emit('blue/request-fork')
    await waitForSelections(3, tree)
    const forked = tree.observations.selectedAgents.at(-1)!
    expect(tree.controller.forks.at(-1)).toEqual({ sessionId: fresh.id })
    expect(tree.tools.scopes.at(-1)).toBe(forked)

    tree.ctx.emit('blue/request-rewind', String(forked.id), 7)
    await waitForSelections(4, tree)
    expect(tree.controller.forks.at(-1)).toEqual({ sessionId: forked.id, atSeq: 7 })
    expect(tree.projections.calls.at(-1)?.session).toBe(tree.observations.selectedAgents.at(-1)!.session)
  })

  it('keeps the shipped bundle flat with direct service owners', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch).not.toMatch(/group:\s*true|isolate:/u)
    expect(patch).toContain('- id: blue-api')
    expect(patch).toContain('- id: blue-core')
    expect(patch).toContain('- id: blue-app')
    expect(patch).toContain('- id: blue-interaction')
  })
})
