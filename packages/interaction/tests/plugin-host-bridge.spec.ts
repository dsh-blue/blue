/**
 * Owner bridge tests for additive command and notification projection.
 *
 * @module @dsh-blue/blue-interaction/tests/plugin-host-bridge
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { BluePluginHostService, attachBluePluginHostCapabilities, createBluePluginControl, snapshotBluePluginHost } from '../../api/src/host.ts'
import type { BlueEditorCompletionItem, BlueEditorExtensionContribution, BlueResult } from '../../api/src/contracts.ts'
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
      bluePluginControl: createBluePluginControl(host),
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

    const overlayOwner = consumer()
    attachBluePluginHostCapabilities(host, overlayOwner, ['overlays'])

    const owner = consumer()
    const manifest: BluePluginManifest = { id: '@acme/interaction', api: '^1.0.0-beta.1', capabilities: ['commands', 'notifications.publish'] }
    const opened = host.open(owner, manifest)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.commands!.register({ id: 'trace', label: 'replace trace', execute: async () => ({ ok: true, value: undefined }) })).toMatchObject({ ok: false, code: 'BLUE_DUPLICATE_ID' })

    let received: { args: readonly string[], rawInput?: string, userGesture?: object } | undefined
    let commandCalls = 0
    const registered = opened.value.commands!.register({
      id: 'spark',
      label: 'Run spark',
      execute: async (args, options) => {
        commandCalls += 1
        received = { args, ...(options?.rawInput === undefined ? {} : { rawInput: options.rawInput }), ...(options?.userGesture === undefined ? {} : { userGesture: options.userGesture }) }
        return args[0] === 'fail'
          ? { ok: false, code: 'BLUE_ACTION_REJECTED', message: '' }
          : { ok: true, value: undefined }
      },
    })
    expect(registered.ok).toBe(true)
    const invocation = { rawInput: '  one   two ', signal: new AbortController().signal } as CommandInvocation
    const retainedSparkHandler = definitions.get('spark')!.handler
    await expect(retainedSparkHandler(invocation)).resolves.toEqual({ kind: 'success' })
    expect(received).toMatchObject({ args: ['one', 'two'], rawInput: '  one   two ', userGesture: {} })
    const overlays = host.open(consumer(), { id: '@acme/overlay-check', api: '^1.0.0-beta.1', capabilities: ['overlays'] })
    expect(overlays.ok).toBe(true)
    if (overlays.ok) expect(overlays.value.overlays!.open({ id: 'late-command', capturing: true, render: () => ({ kind: 'text', content: 'late' }) }, { userGesture: received?.userGesture as never })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    await expect(definitions.get('spark')!.handler({ ...invocation, rawInput: 'fail' })).resolves.toEqual({ kind: 'error', text: 'BLUE_ACTION_REJECTED' })
    await expect(definitions.get('spark')!.handler({ ...invocation, rawInput: '' })).resolves.toEqual({ kind: 'success' })

    let finishLate!: (value: BlueResult) => void
    const late = opened.value.commands!.register({
      id: 'late',
      label: 'Late',
      execute: () => new Promise(resolve => { finishLate = resolve }),
    })
    let rejectLate!: (error: unknown) => void
    const lateRejected = opened.value.commands!.register({
      id: 'late-rejected',
      label: 'Late rejected',
      execute: () => new Promise((_resolve, reject) => { rejectLate = reject }),
    })
    let releaseSideEffect!: () => void
    let sideEffectCode: string | undefined
    const sideEffect = opened.value.commands!.register({
      id: 'side-effect',
      label: 'Side effect',
      execute: async (_args, options) => {
        await new Promise<void>(resolve => { releaseSideEffect = resolve })
        if (overlays.ok) {
          const result = overlays.value.overlays!.open({ id: 'stale-side-effect', capturing: true, render: () => ({ kind: 'text', content: 'stale' }) }, { userGesture: options?.userGesture })
          sideEffectCode = result.ok ? 'ok' : result.code
        }
        return { ok: true, value: undefined }
      },
    })
    expect(late.ok && lateRejected.ok && sideEffect.ok).toBe(true)
    const lateHandler = definitions.get('late')!.handler(invocation)
    const lateRejectedHandler = definitions.get('late-rejected')!.handler(invocation)
    const sideEffectHandler = definitions.get('side-effect')!.handler(invocation)
    await Promise.resolve()
    const replacementOwner = consumer()
    attachBluePluginHostCapabilities(host, replacementOwner, ['commands'])
    const callsBeforeStaleDispatch = commandCalls
    await expect(retainedSparkHandler(invocation)).resolves.toEqual({ kind: 'error', text: 'plugin command result is stale' })
    expect(commandCalls).toBe(callsBeforeStaleDispatch)
    finishLate({ ok: true, value: undefined })
    rejectLate(new Error('late rejection'))
    releaseSideEffect()
    await expect(lateHandler).resolves.toEqual({ kind: 'error', text: 'plugin command result is stale' })
    await expect(lateRejectedHandler).resolves.toEqual({ kind: 'error', text: 'plugin command result is stale' })
    await expect(sideEffectHandler).resolves.toEqual({ kind: 'error', text: 'plugin command result is stale' })
    expect(sideEffectCode).toBe('BLUE_ACTION_REJECTED')
    expect(snapshotBluePluginHost(host).overlays).toEqual([])
    replacementOwner.dispose()
    for (const cleanup of effects.splice(0)) cleanup()
    apply(ctx)

    const explode = vi.fn(async () => { throw new Error('boom') })
    const thrown = opened.value.commands!.register({ id: 'explode', label: 'Explode', execute: explode })
    const thrownValue = opened.value.commands!.register({ id: 'odd', label: 'Odd', execute: async () => { throw 'bad' } })
    const missingMessage = opened.value.commands!.register({ id: 'missing-message', label: 'Missing message', execute: async () => { throw {} } })
    const hostileError = new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('descriptor trap') } })
    const hostile = opened.value.commands!.register({ id: 'hostile', label: 'Hostile', execute: async () => { throw hostileError } })
    expect(thrown.ok && thrownValue.ok && missingMessage.ok && hostile.ok).toBe(true)
    const retainedExplodeHandler = definitions.get('explode')!.handler
    await expect(retainedExplodeHandler(invocation)).resolves.toEqual({ kind: 'error', text: 'plugin command failed: boom' })
    await expect(definitions.get('odd')!.handler(invocation)).resolves.toEqual({ kind: 'error', text: 'plugin command failed: plugin command callback failed' })
    await expect(definitions.get('missing-message')!.handler(invocation)).resolves.toEqual({ kind: 'error', text: 'plugin command failed: plugin command callback failed' })
    await expect(definitions.get('hostile')!.handler(invocation)).resolves.toEqual({ kind: 'error', text: 'plugin command failed: plugin command callback failed' })
    if (thrown.ok) thrown.value.dispose()
    expect(definitions.has('explode')).toBe(false)
    await expect(retainedExplodeHandler(invocation)).resolves.toEqual({ kind: 'error', text: 'plugin command result is stale' })
    expect(explode).toHaveBeenCalledTimes(1)

    const notices: string[] = []
    setSharedEditor(ctx, { notice: text => notices.push(text) } as never)
    expect(opened.value.notifications!.publish({ id: 'ready', tone: 'success', view: { kind: 'text', content: 'ready' } })).toEqual({ ok: true, value: undefined })
    expect(notices).toEqual(['<success>ready</success>'])
    clearSharedEditor(ctx)
    expect(opened.value.notifications!.publish({ id: 'quiet', view: { kind: 'text', content: 'no editor' } })).toEqual({ ok: true, value: undefined })

    for (const cleanup of effects.splice(0)) cleanup()
    expect(definitions.has('spark')).toBe(false)
    expect(opened.value.commands!.register({ id: 'absent', label: 'Absent', execute: async () => ({ ok: true, value: undefined }) })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    expect(opened.value.notifications!.publish({ id: 'absent', view: { kind: 'text', content: 'absent' } })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })

    apply(ctx)
    expect(definitions.has('spark')).toBe(true)
    expect(opened.value.notifications!.publish({ id: 'restored', view: { kind: 'text', content: 'restored' } })).toEqual({ ok: true, value: undefined })
    for (const cleanup of effects.splice(0)) cleanup()
    owner.dispose()
    overlayOwner.dispose()
    expect(definitions.has('trace')).toBe(true)
  })

  it('keeps editor extensions inert, normalizes callback rejection, and scopes action gestures', async () => {
    const root = new Context()
    const host = new BluePluginHostService(root)
    const editorHost = new EditorHostService(root)
    const effects: (() => void)[] = []
    const ctx = {
      bluePluginControl: createBluePluginControl(host),
      blueEditorHost: editorHost,
      blueTheme: { colors },
      commands: { register: () => () => {} },
      effect(callback: () => void | (() => void)): void {
        const cleanup = callback()
        if (typeof cleanup === 'function') effects.push(cleanup)
      },
    } as unknown as Context
    apply(ctx)

    const overlayOwner = consumer()
    attachBluePluginHostCapabilities(host, overlayOwner, ['overlays'])
    const owner = consumer()
    const opened = host.open(owner, {
      id: '@acme/editor-extension',
      api: '^1.0.0-beta.1',
      capabilities: ['editor.extensions', 'overlays'],
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    let retainedGesture: object | undefined
    const completeV2 = vi.fn(async (request: { readonly query: string }) => {
      if (request.query === 'success') return { ok: true as const, value: [] }
      if (request.query === 'primitive') throw 'raw rejection'
      if (request.query === 'missing') throw {}
      if (request.query === 'accessor') throw Object.defineProperty({}, 'message', { get: () => 'unsafe' })
      if (request.query === 'proxy') throw new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('descriptor trap') } })
      throw new Error('completion boom')
    })
    const transformSubmit = vi.fn(async (request: { readonly text: string }) => {
      if (request.text === 'throw') throw new Error('transform boom')
      return { ok: true as const, value: { text: `transformed:${request.text}` } }
    })
    const onEvent = vi.fn(async (event, eventContext) => {
      if (event.kind === 'activate' && event.controlId === 'throw') throw new Error('dispatch boom')
      retainedGesture = eventContext.userGesture
      const result = opened.value.overlays!.open({
        id: 'from-editor-action',
        capturing: true,
        render: () => ({ kind: 'text', content: 'opened' }),
      }, { userGesture: eventContext.userGesture })
      expect(result.ok).toBe(true)
      return { ok: true as const, value: undefined }
    })
    const registered = opened.value.editorExtensions!.register({
      id: 'acme.extension',
      actions: [{ id: 'open', label: 'Open' }],
      completeV2,
      transformSubmit,
      onEvent,
    })
    expect(registered.ok).toBe(true)
    expect(completeV2).not.toHaveBeenCalled()
    expect(transformSubmit).not.toHaveBeenCalled()
    expect(onEvent).not.toHaveBeenCalled()

    const binding = editorHost.extensions!
    const entry = binding.entries[0]!
    const passiveEntry: BlueEditorExtensionContribution = { id: 'acme.passive' }
    const legacyComplete = vi.fn(async () => ({ ok: true as const, value: [] }))
    const legacyEntry: BlueEditorExtensionContribution = { id: 'acme.legacy', complete: legacyComplete }
    const signal = new AbortController().signal
    await expect(binding.complete(passiveEntry, { trigger: 'manual', query: '' }, signal, 0)).resolves.toEqual({ ok: true, value: [] })
    await expect(binding.complete(legacyEntry, { trigger: '#', query: 'hash' }, signal, 0)).resolves.toEqual({ ok: true, value: [] })
    expect(legacyComplete).not.toHaveBeenCalled()
    await expect(binding.complete(legacyEntry, { trigger: 'manual', query: 'legacy' }, signal, 0)).resolves.toEqual({ ok: true, value: [] })
    expect(legacyComplete).toHaveBeenCalledOnce()
    await expect(binding.transform(passiveEntry, { text: 'unchanged', attachments: [] }, signal, 0)).resolves.toEqual({ ok: true, value: { text: 'unchanged' } })
    await expect(binding.dispatch(passiveEntry, { kind: 'activate', controlId: 'none' }, signal, 0)).resolves.toEqual({ ok: true, value: undefined })
    await expect(binding.complete(entry, { trigger: '#', query: 'x' }, signal, 1)).resolves.toEqual({
      ok: false,
      code: 'BLUE_ACTION_REJECTED',
      message: 'completion boom',
    })
    await expect(binding.complete(entry, { trigger: '#', query: 'success' }, signal, 1)).resolves.toEqual({ ok: true, value: [] })
    for (const query of ['primitive', 'missing', 'accessor', 'proxy']) {
      await expect(binding.complete(entry, { trigger: '#', query }, signal, 1)).resolves.toEqual({
        ok: false,
        code: 'BLUE_ACTION_REJECTED',
        message: 'editor extension callback failed',
      })
    }
    await expect(binding.transform(entry, { text: 'draft', attachments: [] }, signal, 2)).resolves.toEqual({
      ok: true,
      value: { text: 'transformed:draft' },
    })
    await expect(binding.transform(entry, { text: 'throw', attachments: [] }, signal, 2)).resolves.toEqual({
      ok: false,
      code: 'BLUE_ACTION_REJECTED',
      message: 'transform boom',
    })
    await expect(binding.dispatch(entry, { kind: 'activate', controlId: 'open' }, signal, 3)).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    await expect(binding.dispatch(entry, { kind: 'activate', controlId: 'throw' }, signal, 3)).resolves.toEqual({
      ok: false,
      code: 'BLUE_ACTION_REJECTED',
      message: 'dispatch boom',
    })
    expect(completeV2).toHaveBeenCalledTimes(6)
    expect(transformSubmit).toHaveBeenCalledTimes(2)
    expect(onEvent).toHaveBeenCalledTimes(2)
    expect(retainedGesture).toBeDefined()
    expect(opened.value.overlays!.open({
      id: 'retained-editor-action',
      capturing: true,
      render: () => ({ kind: 'text', content: 'late' }),
    }, { userGesture: retainedGesture as never })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })

    let rejectComplete!: (error: unknown) => void
    let rejectTransform!: (error: unknown) => void
    let rejectDispatch!: (error: unknown) => void
    let resolveComplete!: (result: BlueResult<readonly BlueEditorCompletionItem[]>) => void
    let resolveLegacyComplete!: (result: BlueResult<readonly BlueEditorCompletionItem[]>) => void
    let resolveTransform!: (result: BlueResult<{ readonly text: string }>) => void
    let resolveDispatch!: (result: BlueResult) => void
    const staleEntry: BlueEditorExtensionContribution = {
      id: 'acme.stale',
      completeV2: () => new Promise((_resolve, reject) => { rejectComplete = reject }),
      transformSubmit: () => new Promise((_resolve, reject) => { rejectTransform = reject }),
      onEvent: () => new Promise((_resolve, reject) => { rejectDispatch = reject }),
    }
    const fulfilledEntry: BlueEditorExtensionContribution = {
      id: 'acme.stale-fulfilled',
      onEvent: () => new Promise(resolve => { resolveDispatch = resolve }),
    }
    const fulfilledCompleteEntry: BlueEditorExtensionContribution = {
      id: 'acme.stale-complete-fulfilled',
      completeV2: () => new Promise(resolve => { resolveComplete = resolve }),
    }
    const fulfilledLegacyCompleteEntry: BlueEditorExtensionContribution = {
      id: 'acme.stale-legacy-complete-fulfilled',
      complete: () => new Promise(resolve => { resolveLegacyComplete = resolve }),
    }
    const fulfilledTransformEntry: BlueEditorExtensionContribution = {
      id: 'acme.stale-transform-fulfilled',
      transformSubmit: () => new Promise(resolve => { resolveTransform = resolve }),
    }
    const staleComplete = binding.complete(staleEntry, { trigger: 'manual', query: '' }, signal, 4)
    const staleTransform = binding.transform(staleEntry, { text: 'draft', attachments: [] }, signal, 5)
    const staleDispatch = binding.dispatch(staleEntry, { kind: 'activate', controlId: 'late' }, signal, 6)
    const fulfilledDispatch = binding.dispatch(fulfilledEntry, { kind: 'activate', controlId: 'late-success' }, signal, 7)
    const fulfilledComplete = binding.complete(fulfilledCompleteEntry, { trigger: '#', query: 'late-success' }, signal, 8)
    const fulfilledLegacyComplete = binding.complete(fulfilledLegacyCompleteEntry, { trigger: 'manual', query: 'late-success' }, signal, 9)
    const fulfilledTransform = binding.transform(fulfilledTransformEntry, { text: 'late-success', attachments: [] }, signal, 10)
    await Promise.resolve()
    const replacementOwner = consumer()
    attachBluePluginHostCapabilities(host, replacementOwner, ['editor.extensions'])
    rejectComplete(new Error('late completion rejection'))
    rejectTransform(new Error('late transform rejection'))
    rejectDispatch(new Error('late dispatch rejection'))
    resolveComplete({ ok: true, value: [] })
    resolveLegacyComplete({ ok: true, value: [] })
    resolveTransform({ ok: true, value: { text: 'late-success' } })
    resolveDispatch({ ok: true, value: undefined })
    for (const result of [staleComplete, staleTransform, staleDispatch, fulfilledDispatch, fulfilledComplete, fulfilledLegacyComplete, fulfilledTransform]) {
      await expect(result).resolves.toEqual({ ok: false, code: 'BLUE_STALE', message: 'editor extension owner is stale' })
    }
    await expect(binding.complete(passiveEntry, { trigger: 'manual', query: 'retired' }, signal, 11)).resolves.toEqual({ ok: false, code: 'BLUE_STALE', message: 'editor extension owner is stale' })
    await expect(binding.transform(passiveEntry, { text: 'retired', attachments: [] }, signal, 12)).resolves.toEqual({ ok: false, code: 'BLUE_STALE', message: 'editor extension owner is stale' })
    await expect(binding.dispatch(passiveEntry, { kind: 'dismiss' }, signal, 13)).resolves.toEqual({ ok: false, code: 'BLUE_STALE', message: 'editor extension owner is stale' })
    replacementOwner.dispose()

    for (const cleanup of effects.splice(0)) cleanup()
    expect(editorHost.extensions).toBeUndefined()
    expect(opened.value.editorExtensions!.register({ id: 'absent' })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    owner.dispose()
    overlayOwner.dispose()
  })
})
