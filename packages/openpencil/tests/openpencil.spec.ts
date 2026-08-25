/**
 * Official-result and lifecycle coverage for the OpenPencil adapter.
 *
 * @module @dsh-blue/blue-openpencil/tests
 */
import { describe, expect, it, vi } from 'vitest'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { NotificationModel, ToolPresentationModel } from '@dsh-blue/blue-frontend'
import { OPENPENCIL_RETENTION, OPENPENCIL_TOOL_NAMES, OpenPencilAdapter, apply, inject, name, type OpenPencilToolSource } from '../src/index.ts'
import * as invariant from '../src/invariant.ts'

function execution(callId: string, toolName = 'openpencil_render'): Readonly<ToolExecution> {
  return { callId, rootCallId: callId, name: toolName, arguments: { path: 'design.op' }, signal: new AbortController().signal } as unknown as Readonly<ToolExecution>
}

function result(isError = false, text = 'rendered', meta?: unknown): Readonly<ToolExecutionResult> {
  return { isError, ...(isError ? { error: { code: 'FAILED', message: text } } : { value: { ok: true } }), content: [{ type: 'text', text }], ...(meta === undefined ? {} : { meta }) } as unknown as Readonly<ToolExecutionResult>
}

function setup(retention = 2) {
  const models = new Map<string, ToolPresentationModel>()
  const notifications = new Map<string, NotificationModel>()
  const adapter = new OpenPencilAdapter({
    tools: { register: model => { models.set(model.id, model); return () => { models.delete(model.id) } } },
    notifications: { push: model => { notifications.set(model.id, model); return () => { notifications.delete(model.id) } } },
  }, { retention })
  return { adapter, models, notifications }
}

describe('OpenPencilAdapter', () => {
  it('uses official presentation callbacks but strips signed result metadata', () => {
    const fixture = setup()
    const presentResult = vi.fn((_args, outcome) => {
      expect(outcome).not.toHaveProperty('meta')
      return { card: 'diff' as const, title: 'Design', diffs: [{ path: 'design.op', oldText: '{}', newText: '{"ok":true}' }] }
    })
    const source = { get: () => ({ presentCall: () => ({ card: 'generic' as const, title: 'Render design.op' }), presentResult }) }
    fixture.adapter.observe(source, execution('call-1'), result(false, 'ok', { embeddedGrant: 'secret' }))
    expect(fixture.models.get('call-1')).toMatchObject({ name: 'openpencil_render', call: { kind: 'sections' }, result: { kind: 'sections', sections: [{ body: { kind: 'diff' } }] } })
    expect(JSON.stringify(fixture.models.get('call-1'))).not.toContain('secret')
    expect(presentResult).toHaveBeenCalledOnce()
  })

  it('keeps plain fallback, deduplicates ids, caps retention, and reports failures', () => {
    const fixture = setup(2)
    const source = { get: () => undefined }
    fixture.adapter.observe(source, execution('one'), result(true, 'render failed'))
    fixture.adapter.observe(source, execution('one'), result(true, 'duplicate'))
    fixture.adapter.observe(source, execution('two', 'openpencil_new'), result())
    fixture.adapter.observe(source, execution('three', 'openpencil_edit'), result())
    fixture.adapter.observe(source, execution('ignored', 'bash'), result())
    expect([...fixture.models.keys()]).toEqual(['two', 'three'])
    expect(fixture.notifications.size).toBe(0)
    expect(OPENPENCIL_TOOL_NAMES).toHaveLength(5)
    expect(OPENPENCIL_RETENTION).toBe(100)
  })

  it('falls back when presentation callbacks throw and uses a generic error message', () => {
    const fixture = setup()
    const source = { get: () => ({ presentCall: () => { throw new Error('bad call') }, presentResult: () => { throw new Error('bad result') } }) }
    const empty = { ...result(true), content: [] } as unknown as Readonly<ToolExecutionResult>
    fixture.adapter.observe(source, execution('bad'), empty)
    expect(fixture.models.get('bad')).toMatchObject({ call: { kind: 'text', text: 'openpencil_render' }, result: { kind: 'text', tone: 'danger' } })
    expect(fixture.notifications.get('openpencil.error.bad')?.message).toBe('openpencil_render failed')
    fixture.adapter.dispose()
    expect(fixture.models.size).toBe(0)
    expect(fixture.notifications.size).toBe(0)
  })

  it('replaces subscriptions and rejects late results after unload', () => {
    const fixture = setup()
    let listener: Parameters<OpenPencilToolSource['onResult']>[0] | undefined
    let stops = 0
    const source: OpenPencilToolSource = { get: () => undefined, onResult: next => { listener = next; return () => { stops += 1 } } }
    fixture.adapter.start(source)
    fixture.adapter.start(source)
    listener?.(execution('live'), result())
    expect(fixture.models.has('live')).toBe(true)
    fixture.adapter.dispose()
    listener?.(execution('late'), result())
    fixture.adapter.start(source)
    fixture.adapter.dispose()
    expect(stops).toBe(2)
    expect(fixture.models.size).toBe(0)
  })
})

describe('OpenPencil plugin entries', () => {
  it('owns the adapter through one Fiber effect', () => {
    let observed: Parameters<OpenPencilToolSource['onResult']>[0] | undefined
    const cleanups: (() => void)[] = []
    const ctx = {
      tools: { get: () => undefined },
      blueToolModels: { register: () => () => undefined },
      blueNotifications: { push: () => () => undefined },
      on: (_event: string, listener: Parameters<OpenPencilToolSource['onResult']>[0]) => { observed = listener; return () => { observed = undefined } },
      effect: (effect: () => () => void) => { cleanups.push(effect()) },
    } as never
    apply(ctx)
    observed?.(execution('plugin'), result())
    for (const cleanup of cleanups) cleanup()
    expect(name).toBe('blue-openpencil')
    expect(inject).toEqual(['tools', 'blueToolModels', 'blueNotifications'])
    expect(observed).toBeUndefined()
  })

  it('ships an inert invariant companion', () => {
    expect(invariant.name).toBe('blue-openpencil-invariant')
    expect(() => invariant.apply({} as never)).not.toThrow()
  })
})
