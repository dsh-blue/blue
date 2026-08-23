import { describe, expect, it } from 'vitest'
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
})
