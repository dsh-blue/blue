/** Direct-service API package tests.
 * @module @dsh-blue/blue-api/tests/api
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, BLUE_API_VERSION, BLUE_VERSION } from '../src/index.ts'

const packageDir = dirname(fileURLToPath(import.meta.url))

describe('@dsh-blue/blue-api', () => {
  it('provides direct Fiber-owned UI registries', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin({ name: 'api-test', apply })
    expect(ctx.bluePanes).toBeDefined()
    expect(ctx.blueStatus).toBeDefined()
    expect(ctx.blueOverlays).toBeDefined()
    expect(ctx.blueEditorExtensions).toBeDefined()
    await fiber.dispose()
  })

  it('exports the breaking direct-service version owners', () => {
    expect(BLUE_API_VERSION).toBe('2.0.0')
    expect(BLUE_VERSION).toBe('0.2.0-alpha.1')
  })

  it('publishes only the direct runtime and invariant entries', () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, '..', 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
      files: string[]
    }
    expect(Object.keys(manifest.exports)).toEqual(['.', './invariant', './package.json'])
    expect(manifest.files).toEqual(['lib/**/*'])
  })

  it('binds pane registrations to the calling Fiber', async () => {
    const ctx = new Context()
    const owner = await ctx.plugin({ name: 'api-owner', apply })
    const consumer = await ctx.plugin({
      name: 'pane-consumer',
      inject: ['bluePanes'],
      apply(pluginCtx: Context) {
        pluginCtx.bluePanes.register({ id: 'test.pane', placement: 'bottom', render: () => ({ kind: 'text', content: 'ok' }) })
      },
    })
    expect(ctx.bluePanes.list()).toHaveLength(1)
    await consumer.dispose()
    expect(ctx.bluePanes.list()).toEqual([])
    await owner.dispose()
  })

  it('refreshes direct entries and rejects duplicate ids', async () => {
    const ctx = new Context()
    const owner = await ctx.plugin({ name: 'api-owner', apply })
    const listener = vi.fn()
    const off = ctx.bluePanes.subscribe(listener)
    const handle = ctx.bluePanes.register({ id: 'test.pane', placement: 'bottom', render: () => ({ kind: 'text', content: 'ok' }) })
    expect(() => ctx.bluePanes.register({ id: 'test.pane', placement: 'right', render: () => null })).toThrow('already registered')
    handle.refresh()
    handle.setHidden(true)
    expect(ctx.bluePanes.list()[0]).toMatchObject({ hidden: true, revision: 2 })
    expect(listener).toHaveBeenCalledTimes(4)
    off()
    await owner.dispose()
  })

  it('opens and closes overlays without admission tokens', async () => {
    const ctx = new Context()
    const owner = await ctx.plugin({ name: 'api-owner', apply })
    const handle = ctx.blueOverlays.open({ id: 'test.overlay', capturing: true, render: () => ({ kind: 'text', content: 'open' }) })
    expect(ctx.blueOverlays.list()).toHaveLength(1)
    expect(ctx.blueOverlays.close('test.overlay')).toBe(true)
    expect(handle.closed).toBe(true)
    expect(ctx.blueOverlays.close('test.overlay')).toBe(false)
    await owner.dispose()
  })

  it('validates pane and overlay definitions and keeps handles idempotent', async () => {
    const ctx = new Context()
    const owner = await ctx.plugin({ name: 'api-owner', apply })
    expect(() => ctx.bluePanes.register({ id: 'Bad Pane', placement: 'bottom', render: () => null })).toThrow('invalid')
    expect(() => ctx.bluePanes.register({ id: 'missing.render', placement: 'bottom' } as never)).toThrow('needs a render function')
    const pane = ctx.bluePanes.register({ id: 'valid.pane', placement: 'bottom', render: () => null })
    pane.setHidden(false)
    pane.dispose()
    pane.dispose()
    pane.refresh()
    pane.setHidden(true)
    expect(ctx.bluePanes.list()).toEqual([])

    expect(() => ctx.blueOverlays.open({ id: 'Bad Overlay', render: () => null })).toThrow('invalid')
    expect(() => ctx.blueOverlays.open({ id: 'missing.render' } as never)).toThrow('needs a render function')
    const snapshots = vi.fn()
    const off = ctx.blueOverlays.subscribe(snapshots)
    const later = ctx.blueOverlays.open({ id: 'overlay.later', render: () => null })
    const earlier = ctx.blueOverlays.open({ id: 'overlay.earlier', render: () => null })
    expect(() => ctx.blueOverlays.open({ id: 'overlay.later', render: () => null })).toThrow('already open')
    later.refresh()
    expect(ctx.blueOverlays.list().map(entry => entry.id)).toEqual(['overlay.later', 'overlay.earlier'])
    later.close()
    later.close()
    earlier.close()
    off()
    expect(snapshots).toHaveBeenCalled()
    await owner.dispose()
  })

  it('serves dynamic status entries with sorting, absence, and plain failure fallback', async () => {
    const ctx = new Context()
    const owner = await ctx.plugin({ name: 'api-owner', apply })
    expect(() => ctx.blueStatus.register(() => null)).toThrow('initial entry')
    expect(() => ctx.blueStatus.register({ id: 'Bad Status', visible: true, node: { kind: 'text', content: 'bad' } })).toThrow('invalid')
    const listener = vi.fn()
    const off = ctx.blueStatus.subscribe(listener)
    let mode: 'value' | 'absent' | 'failure' = 'value'
    const dynamic = ctx.blueStatus.register(() => {
      if (mode === 'absent') return null
      if (mode === 'failure') throw new Error('status failed')
      return { id: 'status.dynamic', priority: 20, visible: true, node: { kind: 'text', content: 'dynamic' } }
    })
    const alpha = ctx.blueStatus.register({ id: 'status.alpha', priority: 10, visible: true, node: { kind: 'text', content: 'alpha' } })
    const beta = ctx.blueStatus.register({ id: 'status.beta', priority: 10, visible: true, node: { kind: 'text', content: 'beta' } })
    const plainBeta = ctx.blueStatus.register({ id: 'status.plain-beta', visible: true, node: { kind: 'text', content: 'plain beta' } })
    const plainAlpha = ctx.blueStatus.register({ id: 'status.plain-alpha', visible: true, node: { kind: 'text', content: 'plain alpha' } })
    expect(() => ctx.blueStatus.register({ id: 'status.alpha', visible: true, node: { kind: 'text', content: 'duplicate' } })).toThrow('already registered')
    expect(ctx.blueStatus.list().map(entry => entry.id)).toEqual(['status.plain-alpha', 'status.plain-beta', 'status.alpha', 'status.beta', 'status.dynamic'])
    mode = 'absent'
    expect(ctx.blueStatus.list().map(entry => entry.id)).toEqual(['status.plain-alpha', 'status.plain-beta', 'status.alpha', 'status.beta'])
    mode = 'failure'
    expect(ctx.blueStatus.list().find(entry => entry.id === 'status.dynamic')?.node).toMatchObject({ content: 'Status status.dynamic failed', tone: 'danger' })
    ctx.blueStatus.refresh('missing')
    dynamic.refresh()
    dynamic.dispose()
    dynamic.dispose()
    alpha.dispose()
    beta.dispose()
    plainAlpha.dispose()
    plainBeta.dispose()
    off()
    expect(listener).toHaveBeenCalled()
    await owner.dispose()
  })

  it('orders editor extensions and refreshes subscriptions through Fiber cleanup', async () => {
    const ctx = new Context()
    const owner = await ctx.plugin({ name: 'api-owner', apply })
    expect(() => ctx.blueEditorExtensions.register({ id: 'Bad Extension' })).toThrow('invalid')
    const listener = vi.fn()
    const off = ctx.blueEditorExtensions.subscribe(listener)
    const later = ctx.blueEditorExtensions.register({ id: 'extension.later', priority: 20 })
    const beta = ctx.blueEditorExtensions.register({ id: 'extension.beta', priority: 10 })
    const alpha = ctx.blueEditorExtensions.register({ id: 'extension.alpha', priority: 10 })
    const plainBeta = ctx.blueEditorExtensions.register({ id: 'extension.plain-beta' })
    const plainAlpha = ctx.blueEditorExtensions.register({ id: 'extension.plain-alpha' })
    expect(() => ctx.blueEditorExtensions.register({ id: 'extension.alpha' })).toThrow('already registered')
    expect(ctx.blueEditorExtensions.list().map(entry => entry.id)).toEqual(['extension.plain-alpha', 'extension.plain-beta', 'extension.alpha', 'extension.beta', 'extension.later'])
    later.refresh()
    later.dispose()
    later.dispose()
    beta.dispose()
    alpha.dispose()
    plainBeta.dispose()
    plainAlpha.dispose()
    off()
    expect(listener).toHaveBeenCalled()
    await owner.dispose()
  })
})
