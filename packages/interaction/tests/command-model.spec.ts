import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CommandModelService } from '../src/command-model.ts'

const agent = { id: 'agent' } as never

describe('CommandModelService', () => {
  it('projects Harness descriptors and reacts to registry changes', () => {
    const ctx = new Context(); const commands = { list: () => [{ name: 'status', description: 'Show status', input: { hint: 'filter' } }, { name: 'version', description: 'Version' }] }; ctx.reflect.provide('commands', commands); const service = new CommandModelService(ctx); expect(service.list()).toEqual([]); const models = service.list(agent); expect(models).toHaveLength(2); expect(models[0]).toMatchObject({ id: 'command.status', label: '/status', enabled: true, action: { kind: 'command.execute', name: 'status' } }); expect(Object.isFrozen(models[0])).toBe(true); let updates = 0; const off = service.subscribe(() => { updates += 1 }); ctx.emit('commands/change'); expect(updates).toBe(1); off(); off(); service.dispose()
  })

  it('handles a missing command service without pending the tree', () => {
    const service = new CommandModelService(new Context()); expect(service.list(agent)).toEqual([]); service.dispose()
  })

  it('executes structured actions through the official command runtime', async () => {
    const execute = vi.fn(async () => ({ commandId: 'command-1', result: { kind: 'success' as const, text: 'done' } }))
    const ctx = new Context(); ctx.reflect.provide('commands', { list: () => [], execute }); const service = new CommandModelService(ctx)
    await expect(service.execute(agent, { kind: 'command.execute', name: 'status', input: 'brief' })).resolves.toMatchObject({ result: { text: 'done' } })
    expect(execute).toHaveBeenCalledWith(agent, '/status brief', [], expect.any(AbortSignal))
    await expect(service.execute(agent, { kind: 'command.execute', name: 'status', input: ' --json' })).resolves.toBeDefined()
    expect(execute.mock.calls[1]![1]).toBe('/status --json')
    await expect(service.execute(undefined, { kind: 'command.execute', name: 'status' })).resolves.toBeUndefined()
    await expect(service.execute(agent, { kind: 'other' })).resolves.toBeUndefined()
    await expect(service.execute(agent, { kind: 'command.execute', name: 1 })).resolves.toBeUndefined()
    await expect(service.execute(agent, { kind: 'command.execute', name: 'status', input: 1 })).resolves.toBeUndefined()
    service.dispose(); service.dispose(); expect(service.list(agent)).toEqual([])
  })

  it('aborts active command actions and drops their late result on unload', async () => {
    const execute = vi.fn(async (_agent: unknown, _line: string, _images: readonly never[], signal: AbortSignal) => new Promise<never>(resolve => signal.addEventListener('abort', () => resolve({ commandId: 'late', result: { kind: 'error', text: 'aborted' } } as never), { once: true })))
    const ctx = new Context(); ctx.reflect.provide('commands', { list: () => [], execute }); const service = new CommandModelService(ctx)
    const pending = service.execute(agent, { kind: 'command.execute', name: 'status' }); await Promise.resolve(); service.dispose(); await expect(pending).resolves.toBeUndefined()
    const absent = new CommandModelService(new Context()); await expect(absent.execute(agent, { kind: 'command.execute', name: 'status' })).resolves.toBeUndefined(); absent.dispose()
  })

  it('forwards live and pre-existing abort signals to command execution', async () => {
    const seen: AbortSignal[] = []
    const execute = vi.fn(async (_agent: unknown, _line: string, _images: readonly never[], signal: AbortSignal) => {
      seen.push(signal)
      if (signal.aborted) return undefined
      return new Promise<never>(resolve => signal.addEventListener('abort', () => resolve(undefined as never), { once: true }))
    })
    const ctx = new Context()
    ctx.reflect.provide('commands', { list: () => [], execute })
    const service = new CommandModelService(ctx)
    const live = new AbortController()
    const pending = service.execute(agent, { kind: 'command.execute', name: 'status' }, live.signal)
    await Promise.resolve()
    live.abort('live')
    await expect(pending).resolves.toBeUndefined()
    expect(seen[0]).toMatchObject({ aborted: true, reason: 'live' })
    const early = new AbortController()
    early.abort('early')
    await expect(service.execute(agent, { kind: 'command.execute', name: 'status' }, early.signal)).resolves.toBeUndefined()
    expect(seen[1]).toMatchObject({ aborted: true, reason: 'early' })
    service.dispose()
  })
})
