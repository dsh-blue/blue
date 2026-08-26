/**
 * Owner bridge tests for additive command and notification projection.
 *
 * @module @dsh-blue/blue-interaction/tests/plugin-host-bridge
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { BluePluginHostService } from '../../api/src/host.ts'
import type { BluePluginManifest } from '../../api/src/manifest.ts'
import type { BlueSemanticColors } from '@dsh-blue/blue-core'
import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
import { clearSharedEditor, EditorHostService, setSharedEditor } from '../src/editor-instance.ts'
import { apply } from '../src/plugin-host-bridge.ts'

const colors = new Proxy({}, { get: (_target, role: string) => (text: string) => `<${role}>${text}</${role}>` }) as BlueSemanticColors

function consumer() {
  const cleanups: (() => void)[] = []
  return {
    effect(callback: () => void | (() => void)): void {
      const cleanup = callback()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    dispose(): void { for (const cleanup of cleanups.splice(0)) cleanup() },
  }
}

describe('plugin host interaction bridge', () => {
  it('protects owner commands, executes plugin commands, publishes notices, and unloads cleanly', async () => {
    const root = new Context()
    const host = new BluePluginHostService(root)
    const editorHost = new EditorHostService(root)
    const definitions = new Map<string, CommandDefinition>([['trace', { name: 'trace', description: 'owner', handler: () => ({ kind: 'success' }) }]])
    const effects: (() => void)[] = []
    const ctx = {
      bluePluginHost: host,
      blueEditorHost: editorHost,
      blueTheme: { colors },
      commands: {
        register(definition: CommandDefinition): () => void {
          if (definitions.has(definition.name)) throw new Error(`command "${definition.name}" is already registered`)
          definitions.set(definition.name, definition)
          return () => { definitions.delete(definition.name) }
        },
      },
      effect(callback: () => void | (() => void)): void {
        const cleanup = callback()
        if (typeof cleanup === 'function') effects.push(cleanup)
      },
    } as unknown as Context
    apply(ctx)

    const owner = consumer()
    const manifest: BluePluginManifest = { id: '@acme/interaction', api: '^1.0.0', capabilities: ['commands', 'notifications'] }
    const opened = host.open(owner, manifest)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.commands!.register({ id: 'trace', label: 'replace trace', execute: async () => ({ ok: true, value: undefined }) })).toMatchObject({ ok: false, code: 'BLUE_DUPLICATE_ID' })

    let received: { args: readonly string[], rawInput?: string } | undefined
    const registered = opened.value.commands!.register({
      id: 'spark',
      label: 'Run spark',
      execute: async (args, options) => {
        received = { args, ...(options?.rawInput === undefined ? {} : { rawInput: options.rawInput }) }
        return args[0] === 'fail'
          ? { ok: false, code: 'BLUE_ACTION_REJECTED', message: '' }
          : { ok: true, value: undefined }
      },
    })
    expect(registered.ok).toBe(true)
    const invocation = { rawInput: '  one   two ', signal: new AbortController().signal } as CommandInvocation
    await expect(definitions.get('spark')!.handler(invocation)).resolves.toEqual({ kind: 'success' })
    expect(received).toEqual({ args: ['one', 'two'], rawInput: '  one   two ' })
    await expect(definitions.get('spark')!.handler({ ...invocation, rawInput: 'fail' })).resolves.toEqual({ kind: 'error', text: 'BLUE_ACTION_REJECTED' })
    await expect(definitions.get('spark')!.handler({ ...invocation, rawInput: '' })).resolves.toEqual({ kind: 'success' })

    const thrown = opened.value.commands!.register({ id: 'explode', label: 'Explode', execute: async () => { throw new Error('boom') } })
    const thrownValue = opened.value.commands!.register({ id: 'odd', label: 'Odd', execute: async () => { throw 'bad' } })
    expect(thrown.ok && thrownValue.ok).toBe(true)
    await expect(definitions.get('explode')!.handler(invocation)).resolves.toEqual({ kind: 'error', text: 'plugin command failed: boom' })
    await expect(definitions.get('odd')!.handler(invocation)).resolves.toEqual({ kind: 'error', text: 'plugin command failed: bad' })

    const notices: string[] = []
    setSharedEditor(ctx, { notice: text => notices.push(text) } as never)
    expect(opened.value.notifications!.publish({ id: 'ready', tone: 'success', view: { kind: 'text', content: 'ready' } })).toEqual({ ok: true, value: undefined })
    expect(notices).toEqual(['<success>ready</success>'])
    clearSharedEditor(ctx)
    expect(opened.value.notifications!.publish({ id: 'quiet', view: { kind: 'text', content: 'no editor' } })).toEqual({ ok: true, value: undefined })

    for (const cleanup of effects.splice(0)) cleanup()
    expect(definitions.has('spark')).toBe(false)
    owner.dispose()
    expect(definitions.has('trace')).toBe(true)
  })
})
