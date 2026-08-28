import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { BlueSessionCommand } from '@dsh-blue/blue-app'
import { CommandModelService } from '../src/command-model.ts'
import { BlueLocaleService } from '@dsh-blue/blue-frontend'
import { registerInteractionLocale } from '../src/locale.ts'

function fixture(options: {
  commands?: readonly BlueSessionCommand[]
  execute?: (line: string, signal: AbortSignal) => Promise<{ result: { kind: 'success' | 'error', text?: string } } | undefined>
  services?: boolean
} = {}) {
  const ctx = new Context()
  let sessionChanged: (() => void) | undefined
  if (options.services !== false) {
    ctx.provide('blueSessionReader', {
      current: () => ({ id: 'agent', cwd: '/repo', status: 'idle', mode: 'normal' }),
      subscribe: (listener: () => void) => {
        sessionChanged = listener
        listener()
        let disposed = false
        return {
          get disposed() { return disposed },
          dispose() { disposed = true },
        }
      },
      request: async () => ({ ok: true, value: undefined }),
    })
    ctx.provide('blueSessionActions', {
      commands: () => options.commands ?? [],
      executeCommand: options.execute ?? (async () => undefined),
    } as never)
  }
  return { ctx, notify: () => sessionChanged?.() }
}

describe('CommandModelService', () => {
  it('projects app-owned descriptors and reacts to session/runtime changes', () => {
    const test = fixture({ commands: [
      { name: 'status', description: 'Show status', inputHint: 'filter' },
      { name: 'version', description: 'Version' },
      { name: 'plain' },
    ] })
    const service = new CommandModelService(test.ctx)
    const models = service.list()
    expect(models).toHaveLength(3)
    expect(models[0]).toMatchObject({
      id: 'command.status', label: '/status', enabled: true,
      action: { kind: 'command.execute', name: 'status' },
    })
    expect(Object.isFrozen(models[0])).toBe(true)
    expect(models[2]).not.toHaveProperty('description')
    let updates = 0
    const off = service.subscribe(() => { updates += 1 })
    test.notify()
    expect(updates).toBe(1)
    off()
    off()
    service.dispose()
  })

  it('reprojects translated descriptions after a locale switch', () => {
    const test = fixture({ commands: [{ name: 'quit', description: 'Exit Blue' }] })
    const locale = new BlueLocaleService(test.ctx, { systemLocale: 'en' })
    registerInteractionLocale(test.ctx)
    const service = new CommandModelService(test.ctx)
    let updates = 0
    service.subscribe(() => { updates += 1 })
    expect(service.list()[0]?.description).toBe('Exit Blue')
    locale.setPreference('zh')
    expect(updates).toBe(1)
    expect(service.list()[0]?.description).toBe('退出 Blue')
    service.dispose(); locale.dispose()
  })

  it('projects the acceptance command family as structured actions', async () => {
    const names = ['context', 'sessions', 'model', 'help'] as const
    const execute = vi.fn(async () => ({ result: { kind: 'success' as const } }))
    const test = fixture({ commands: names.map(name => ({ name, description: `Show ${name}` })), execute })
    const service = new CommandModelService(test.ctx)
    const models = service.list()
    expect(models.map(model => model.label)).toEqual(['/context', '/sessions', '/model', '/help'])
    expect(models.map(model => model.action)).toEqual(names.map(name => ({ kind: 'command.execute', name })))
    for (const model of models) await service.execute(model.action)
    expect(execute.mock.calls.map(call => call[0])).toEqual(['/context', '/sessions', '/model', '/help'])
    service.dispose()
  })

  it('handles missing app services without pending the tree', async () => {
    const service = new CommandModelService(fixture({ services: false }).ctx)
    expect(service.list()).toEqual([])
    await expect(service.execute({ kind: 'command.execute', name: 'status' })).resolves.toBeUndefined()
    service.dispose()
  })

  it('executes structured actions through the app action boundary', async () => {
    const execute = vi.fn(async () => ({ result: { kind: 'success' as const, text: 'done' } }))
    const service = new CommandModelService(fixture({ execute }).ctx)
    await expect(service.execute({ kind: 'command.execute', name: 'status', input: 'brief' })).resolves.toMatchObject({ result: { text: 'done' } })
    expect(execute).toHaveBeenCalledWith('/status brief', expect.any(AbortSignal))
    await expect(service.execute({ kind: 'command.execute', name: 'status', input: ' --json' })).resolves.toBeDefined()
    expect(execute.mock.calls[1]![0]).toBe('/status --json')
    await expect(service.execute(undefined)).resolves.toBeUndefined()
    await expect(service.execute({ kind: 'other' })).resolves.toBeUndefined()
    await expect(service.execute({ kind: 'command.execute', name: 1 })).resolves.toBeUndefined()
    await expect(service.execute({ kind: 'command.execute', name: 'status', input: 1 })).resolves.toBeUndefined()
    service.dispose()
    service.dispose()
    expect(service.list()).toEqual([])
  })

  it('aborts active command actions and drops their late result on unload', async () => {
    const execute = vi.fn(async (_line: string, signal: AbortSignal) => new Promise<never>(resolve =>
      signal.addEventListener('abort', () => resolve({ result: { kind: 'error', text: 'aborted' } } as never), { once: true })))
    const service = new CommandModelService(fixture({ execute }).ctx)
    const pending = service.execute({ kind: 'command.execute', name: 'status' })
    await Promise.resolve()
    service.dispose()
    await expect(pending).resolves.toBeUndefined()
  })

  it('forwards live and pre-existing abort signals to command execution', async () => {
    const seen: AbortSignal[] = []
    const execute = vi.fn(async (_line: string, signal: AbortSignal) => {
      seen.push(signal)
      if (signal.aborted) return undefined
      return new Promise<never>(resolve => signal.addEventListener('abort', () => resolve(undefined as never), { once: true }))
    })
    const service = new CommandModelService(fixture({ execute }).ctx)
    const live = new AbortController()
    const pending = service.execute({ kind: 'command.execute', name: 'status' }, live.signal)
    await Promise.resolve()
    live.abort('live')
    await expect(pending).resolves.toBeUndefined()
    expect(seen[0]).toMatchObject({ aborted: true, reason: 'live' })
    const early = new AbortController()
    early.abort('early')
    await expect(service.execute({ kind: 'command.execute', name: 'status' }, early.signal)).resolves.toBeUndefined()
    expect(seen[1]).toMatchObject({ aborted: true, reason: 'early' })
    service.dispose()
  })
})
