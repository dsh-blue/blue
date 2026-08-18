/**
 * `blue-status-basic` plugin: the baseline `{model} · {status}` entry.
 * Covers the model-source preference order (request header → options.model →
 * options.provider → 'no model'), the no-session empty render, `agent/status`
 * filtering, session-change rebinding, and the `session/event` re-derivation
 * that picks up the first request header.
 */

import { describe, expect, it } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import * as basic from '../src/status-basic.ts'
import { userEvent } from './helpers.ts'
import { asAgent, bootStatusPlugin, fakeAgent } from './status-fakes.ts'

describe('blue-status-basic', () => {
  it('renders nothing without an attached agent', async () => {
    const harness = await bootStatusPlugin(basic)
    expect(harness.entry.render(80)).toBe('')
    expect(harness.entry.id).toBe('blue.status.basic')
    expect(harness.entry.priority).toBe(0)
    // Events arriving before any session attaches leave the entry empty.
    const stray = fakeAgent([])
    harness.ctx.emit('session/event', stray.session as unknown as Session, userEvent('early'))
    expect(harness.entry.render(80)).toBe('')
    await harness.dispose()
  })

  it('prefers the request header model over agent options', async () => {
    const agent = fakeAgent([], { model: 'options-model', headerModel: 'header-model' })
    const harness = await bootStatusPlugin(basic, agent)
    expect(harness.entry.render(80)).toBe('header-model · idle')
    await harness.dispose()
  })

  it('falls back to options.model, then provider, then the placeholder', async () => {
    const fromModel = await bootStatusPlugin(basic, fakeAgent([], { model: 'deepseek-chat' }))
    expect(fromModel.entry.render(80)).toBe('deepseek-chat · idle')
    await fromModel.dispose()

    const fromProvider = await bootStatusPlugin(basic, fakeAgent([], { provider: 'deepseek' }))
    expect(fromProvider.entry.render(80)).toBe('deepseek · idle')
    await fromProvider.dispose()

    const placeholder = await bootStatusPlugin(basic, fakeAgent([]))
    expect(placeholder.entry.render(80)).toBe('no model · idle')
    await placeholder.dispose()
  })

  it('flips the status on agent/status and requests a render', async () => {
    const agent = fakeAgent([], { model: 'deepseek-chat' })
    const { ctx, screen, entry, dispose } = await bootStatusPlugin(basic, agent)
    const baseline = screen.renderRequests.length

    // A status event for another agent is ignored.
    const other = fakeAgent([])
    other.status = 'running'
    ctx.emit('agent/status', { agent: asAgent(other), status: 'running' })
    expect(entry.render(80)).toBe('deepseek-chat · idle')
    expect(screen.renderRequests.length).toBe(baseline)

    agent.status = 'running'
    ctx.emit('agent/status', { agent: asAgent(agent), status: 'running' })
    expect(entry.render(80)).toBe('deepseek-chat · running')
    expect(screen.renderRequests.length).toBe(baseline + 1)

    // A restated status re-derives the same text: no redraw is requested.
    ctx.emit('agent/status', { agent: asAgent(agent), status: 'running' })
    expect(screen.renderRequests.length).toBe(baseline + 1)
    await dispose()
  })

  it('rebinds on blue/session-changed and ignores the old agent afterwards', async () => {
    const first = fakeAgent([], { model: 'first-model' })
    const { ctx, entry, dispose } = await bootStatusPlugin(basic, first)
    expect(entry.render(80)).toBe('first-model · idle')

    const second = fakeAgent([], { model: 'second-model' })
    second.status = 'running'
    ctx.emit('blue/session-changed', asAgent(second))
    expect(entry.render(80)).toBe('second-model · running')

    first.status = 'running'
    ctx.emit('agent/status', { agent: asAgent(first), status: 'running' })
    expect(entry.render(80)).toBe('second-model · running')
    await dispose()
  })

  it('re-derives the model when the first request header lands', async () => {
    const agent = fakeAgent([], { model: 'boot-model' })
    const { ctx, entry, dispose } = await bootStatusPlugin(basic, agent)
    expect(entry.render(80)).toBe('boot-model · idle')

    // An event on another session does not touch the entry.
    const other = fakeAgent([])
    ctx.emit('session/event', other.session as unknown as Session, userEvent('foreign'))
    expect(entry.render(80)).toBe('boot-model · idle')

    // The loop logs the first request/header snapshot inside its step; the
    // next session event re-derives the model from it.
    agent.session.requestHeader = () => ({ config: { model: 'header-model' } })
    ctx.emit('session/event', agent.session as unknown as Session, userEvent('hi'))
    expect(entry.render(80)).toBe('header-model · idle')
    await dispose()
  })

  it('truncates to the offered width budget', async () => {
    const agent = fakeAgent([], { model: 'a-very-long-model-name' })
    const harness = await bootStatusPlugin(basic, agent)
    expect(harness.entry.render(10)).toBe('a-very-...')
    await harness.dispose()
  })

  it('unregisters the entry when the fiber unloads', async () => {
    const harness = await bootStatusPlugin(basic, fakeAgent([], { model: 'm' }))
    expect(harness.registry.entries).toHaveLength(1)
    await harness.dispose()
    expect(harness.registry.entries).toHaveLength(0)
  })
})
