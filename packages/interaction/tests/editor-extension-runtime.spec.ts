/**
 * Public editor-extension runtime tests: shell refresh, completion
 * multiplexing, action serialization, and pre-clear submit transactions.
 *
 * @module @dsh-blue/blue-interaction/tests/editor-extension-runtime
 */

import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  BlueEditorCompletionItem,
  BlueEditorCompletionRequestV2,
  BlueEditorExtensionContribution,
  BlueEditorSubmitRequest,
  BlueEditorSubmitValue,
  BlueResult,
  BlueUiEvent,
} from '@dsh-blue/blue-api'
import type { BlueAutocompleteItem, BlueAutocompleteProvider, BlueEditorSubmitAttempt } from '@dsh-blue/blue-core'
import { describe, expect, it, vi } from 'vitest'
import { EditorExtensionRuntime } from '../src/editor-extension-runtime.ts'
import {
  clearEditorExtensions,
  registerEditorAutocompleteSource,
  setEditorExtensions,
  type EditorExtensionBinding,
} from '../src/editor-instance.ts'
import { FakeBlueEditor, fakeBlueContext, KEY } from './fakes.ts'

function success<Value>(value: Value): BlueResult<Value> { return { ok: true, value } }

function binding(entries: readonly BlueEditorExtensionContribution[], revision = 1): EditorExtensionBinding {
  return {
    revision,
    entries,
    async complete(entry, request, signal, operationRevision) {
      const context = { surfaceId: entry.id, signal, revision: operationRevision }
      if (entry.completeV2 !== undefined) return entry.completeV2(request, context)
      if (request.trigger === '#' || entry.complete === undefined) return success([])
      return entry.complete({ query: request.query, trigger: request.trigger }, context)
    },
    async transform(entry, request, signal, operationRevision) {
      if (entry.transformSubmit === undefined) return success({ text: request.text })
      return entry.transformSubmit(request, { surfaceId: entry.id, signal, revision: operationRevision })
    },
    async dispatch(entry, event, signal, operationRevision) {
      if (entry.onEvent === undefined) return success(undefined)
      return entry.onEvent(event, { surfaceId: entry.id, signal, revision: operationRevision })
    },
  }
}

function runtimeFixture(entries: readonly BlueEditorExtensionContribution[] = []): {
  readonly ctx: ReturnType<typeof fakeBlueContext>['ctx']
  readonly editor: FakeBlueEditor
  readonly runtime: EditorExtensionRuntime
  readonly notices: string[]
  readonly replace: (next: readonly BlueEditorExtensionContribution[], revision?: number) => EditorExtensionBinding
} {
  const { ctx } = fakeBlueContext()
  const editor = new FakeBlueEditor()
  const notices: string[] = []
  if (entries.length > 0) setEditorExtensions(ctx, binding(entries))
  const runtime = new EditorExtensionRuntime({
    ctx,
    editor,
    notice: text => notices.push(text),
    shouldTransformSubmit: () => true,
  })
  return {
    ctx,
    editor,
    runtime,
    notices,
    replace(next, revision = 2) {
      const value = binding(next, revision)
      setEditorExtensions(ctx, value)
      return value
    },
  }
}

function suggestions(provider: BlueAutocompleteProvider, text: string, force?: boolean) {
  return provider.getSuggestions([text], 0, text.length, {
    signal: new AbortController().signal,
    ...(force === undefined ? {} : { force }),
  })
}

function privateSubmit(runtime: EditorExtensionRuntime, attempt: BlueEditorSubmitAttempt): void {
  ;(runtime as unknown as { beginSubmit(value: BlueEditorSubmitAttempt): void }).beginSubmit(attempt)
}

function privateDispatch(runtime: EditorExtensionRuntime, event: BlueUiEvent): void {
  ;(runtime as unknown as { dispatchEvent(value: BlueUiEvent): void }).dispatchEvent(event)
}

function imageRefForCoverage(id: string): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(id),
    mediaType: 'image/png',
    bytes: 1,
    width: 1,
    height: 1,
  }
}

describe('editor extension completion multiplexer', () => {
  it('combines the Blue source with /, @, #, and manual extension requests', async () => {
    const requests: BlueEditorCompletionRequestV2[] = []
    const extension: BlueEditorExtensionContribution = {
      id: 'acme.complete',
      completeV2: async request => {
        requests.push(request)
        return success([{ id: `extension-${request.trigger}`, label: `Extension ${request.query}`, insertText: `insert-${request.trigger}`, detail: 'plugin' }])
      },
    }
    const { ctx, editor, runtime } = runtimeFixture()
    const baseItem: BlueAutocompleteItem = { value: 'base-value', label: 'Base' }
    const baseApply = vi.fn((lines: string[]) => ({ lines: [`base:${lines[0] ?? ''}`], cursorLine: 0, cursorCol: 4 }))
    const base: BlueAutocompleteProvider = {
      triggerCharacters: ['@', '$'],
      getSuggestions: async () => ({ prefix: 'base-prefix', items: [baseItem] }),
      applyCompletion: baseApply,
      shouldTriggerFileCompletion: () => true,
    }
    const unregister = registerEditorAutocompleteSource(ctx, 'base', base)
    const installed = binding([extension])
    setEditorExtensions(ctx, installed)

    const provider = editor.autocompleteProvider!
    expect(provider.triggerCharacters).toEqual(['@', '$', '/', '#'])
    const cases = [
      { text: '/he', trigger: '/', query: 'he' },
      { text: 'open @fi', trigger: '@', query: 'fi' },
      { text: 'use #sk', trigger: '#', query: 'sk' },
      { text: 'plain', trigger: 'manual', query: 'plain', force: true },
    ] as const
    for (const test of cases) {
      const result = await suggestions(provider, test.text, test.force)
      expect(result?.items.map(item => item.label)).toEqual(['Base', `Extension ${test.query}`])
      expect(result?.prefix).toBe(test.trigger === '/' ? test.text : test.text.split(' ').at(-1))
    }
    expect(requests).toEqual(cases.map(({ trigger, query }) => ({ trigger, query })))
    expect(provider.shouldTriggerFileCompletion?.(['x'], 0, 1)).toBe(true)

    const result = await suggestions(provider, '#sk')
    const extensionItem = result!.items[1]!
    // The aggregate source also returned a base item whose own prefix was
    // `base-prefix`. A public item must keep its `#sk` prefix even when the
    // editor supplies that different aggregate/base prefix at acceptance.
    expect(provider.applyCompletion(['use #sk now'], 0, 7, extensionItem, 'base-prefix')).toEqual({
      lines: ['use insert-# now'],
      cursorLine: 0,
      cursorCol: 12,
    })
    expect(provider.applyCompletion(['x'], 0, 1, baseItem, 'x')).toEqual({ lines: ['base:x'], cursorLine: 0, cursorCol: 4 })
    expect(baseApply).toHaveBeenCalledOnce()

    clearEditorExtensions(ctx, installed)
    unregister()
    runtime.dispose()
  })

  it('keeps the Beta compatibility callback exhaustive by never dispatching hash requests', async () => {
    const complete = vi.fn(async request => success([{
      id: 'legacy',
      label: `Legacy ${request.trigger}`,
      insertText: request.query,
    }]))
    const { editor, runtime } = runtimeFixture([
      { id: 'acme.passive' },
      { id: 'acme.legacy', complete },
    ])

    const slash = await suggestions(editor.autocompleteProvider!, '/legacy')
    expect(slash?.items.map(item => item.label)).toEqual(['Legacy /'])
    await expect(suggestions(editor.autocompleteProvider!, '#legacy')).resolves.toBeNull()
    expect(complete).toHaveBeenCalledOnce()
    expect(complete.mock.calls[0]?.[0]).toEqual({ trigger: '/', query: 'legacy' })
    runtime.dispose()
  })

  it('rejects late completion after refresh or unload without publishing a notice', async () => {
    const gates = [Promise.withResolvers<BlueResult<readonly BlueEditorCompletionItem[]>>(), Promise.withResolvers<BlueResult<readonly BlueEditorCompletionItem[]>>()]
    const signals: AbortSignal[] = []
    let call = 0
    const extension: BlueEditorExtensionContribution = {
      id: 'acme.slow-complete',
      completeV2: (_request, context) => {
        signals.push(context.signal)
        return gates[call++]!.promise
      },
    }
    const { editor, runtime, notices, replace } = runtimeFixture([extension])
    const firstProvider = editor.autocompleteProvider!
    const first = suggestions(firstProvider, '/old')
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    replace([])
    expect(signals[0]?.aborted).toBe(true)
    gates[0]!.resolve(success([{ id: 'old', label: 'Old', insertText: '/old' }]))
    await expect(first).resolves.toBeNull()

    replace([extension], 3)
    const second = suggestions(editor.autocompleteProvider!, '#late')
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    runtime.dispose()
    expect(signals[1]?.aborted).toBe(true)
    gates[1]!.resolve({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'too late' })
    await expect(second).resolves.toBeNull()
    expect(notices).toEqual([])
  })

  it('aborts the current completion on session invalidation and lets a new request complete', async () => {
    const gate = Promise.withResolvers<BlueResult<readonly BlueEditorCompletionItem[]>>()
    const signals: AbortSignal[] = []
    let calls = 0
    const extension: BlueEditorExtensionContribution = {
      id: 'acme.session-complete',
      completeV2: (_request, context) => {
        signals.push(context.signal)
        calls += 1
        return calls === 1
          ? gate.promise
          : success([{ id: 'current', label: 'Current', insertText: '#current' }])
      },
    }
    const { editor, runtime } = runtimeFixture([extension])
    const first = suggestions(editor.autocompleteProvider!, '#old')
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    runtime.invalidateSession()
    expect(signals[0]?.aborted).toBe(true)
    gate.resolve(success([{ id: 'old', label: 'Old', insertText: '#old' }]))
    await expect(first).resolves.toBeNull()

    const second = await suggestions(editor.autocompleteProvider!, '#cur')
    expect(second?.items.map(item => item.label)).toEqual(['Current'])
    expect(signals[1]?.aborted).toBe(false)
    runtime.dispose()
  })

  it.each([
    ['invalid BlueResult', null, 'completion result must be a BlueResult'],
    ['duplicate ids', success([
      { id: 'same', label: 'One', insertText: 'one' },
      { id: 'same', label: 'Two', insertText: 'two' },
    ]), 'invalid or duplicate id'],
    ['too many items', success(Array.from({ length: 201 }, (_, index) => ({ id: `item-${String(index)}`, label: 'Item', insertText: 'item' }))), 'at most 200 items'],
    ['rejected callback', { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'completion denied' }, 'completion denied'],
  ])('contains %s without leaking suggestions or a rejection', async (_label, callbackResult, expectedNotice) => {
    const { editor, runtime, notices } = runtimeFixture([{
      id: 'acme.invalid-completion',
      completeV2: async () => callbackResult as BlueResult<readonly BlueEditorCompletionItem[]>,
    }])
    await expect(suggestions(editor.autocompleteProvider!, '/bad')).resolves.toBeNull()
    expect(notices.some(notice => notice.includes(expectedNotice))).toBe(true)
    runtime.dispose()
  })

  it.each([
    ['null item', success([null]), 'must be an object'],
    ['missing id', success([{ label: 'x', insertText: 'x' }]), 'id must be an own data property'],
    ['accessor id', success([Object.defineProperty({ label: 'x', insertText: 'x' }, 'id', { get: () => 'x' })]), 'id must be an own data property'],
    ['empty id', success([{ id: '', label: 'x', insertText: 'x' }]), 'invalid or duplicate id'],
    ['long id', success([{ id: 'x'.repeat(129), label: 'x', insertText: 'x' }]), 'invalid or duplicate id'],
    ['invalid label', success([{ id: 'x', label: 3, insertText: 'x' }]), 'invalid label'],
    ['long label', success([{ id: 'x', label: 'x'.repeat(2_001), insertText: 'x' }]), 'invalid label'],
    ['invalid insertText', success([{ id: 'x', label: 'x', insertText: 3 }]), 'invalid insertText'],
    ['long insertText', success([{ id: 'x', label: 'x', insertText: 'x'.repeat(2_001) }]), 'invalid insertText'],
    ['accessor detail', success([Object.defineProperty({ id: 'x', label: 'x', insertText: 'x' }, 'detail', { get: () => 'detail' })]), 'invalid detail'],
    ['invalid detail', success([{ id: 'x', label: 'x', insertText: 'x', detail: 3 }]), 'invalid detail'],
    ['long detail', success([{ id: 'x', label: 'x', insertText: 'x', detail: 'x'.repeat(2_001) }]), 'invalid detail'],
    ['missing result value', { ok: true }, 'value must be an own data property'],
    ['raw thrown value', new Proxy({}, { getOwnPropertyDescriptor: () => { throw 'raw completion trap' } }), 'completion result was rejected'],
  ])('contains hostile completion shape: %s', async (_label, result, expectedNotice) => {
    const { editor, runtime, notices } = runtimeFixture([{
      id: 'acme.hostile-completion',
      completeV2: async () => result as BlueResult<readonly BlueEditorCompletionItem[]>,
    }])
    await expect(suggestions(editor.autocompleteProvider!, '/hostile')).resolves.toBeNull()
    expect(notices.some(notice => notice.includes(expectedNotice))).toBe(true)
    runtime.dispose()
  })

  it.each([
    [{ ok: false }, 'completion failed'],
    [{ ok: false, message: '' }, 'completion failed'],
    [{ ok: false, message: 4 }, 'completion failed'],
    [new Proxy({ ok: false }, {
      getOwnPropertyDescriptor(target, key) {
        if (key === 'message') throw new Error('message trap')
        return Reflect.getOwnPropertyDescriptor(target, key)
      },
    }), 'completion failed'],
  ])('bounds malformed completion failure messages', async (result, expectedNotice) => {
    const { editor, runtime, notices } = runtimeFixture([{
      id: 'acme.failure-message',
      completeV2: async () => result as BlueResult<readonly BlueEditorCompletionItem[]>,
    }])
    await expect(suggestions(editor.autocompleteProvider!, '/fail')).resolves.toBeNull()
    expect(notices).toContain(expectedNotice)
    runtime.dispose()
  })

  it('contains a rejected completion promise', async () => {
    const { editor, runtime, notices } = runtimeFixture([{
      id: 'acme.rejected-completion',
      completeV2: async () => { throw new Error('rejected completion promise') },
    }])
    await expect(suggestions(editor.autocompleteProvider!, '#x')).resolves.toBeNull()
    expect(notices).toContain('rejected completion promise')
    runtime.dispose()
  })

  it('times out and aborts a hung base source while preserving another base source', async () => {
    vi.useFakeTimers()
    let hungSignal: AbortSignal | undefined
    const { ctx, editor, runtime } = runtimeFixture()
    const unregisterHung = registerEditorAutocompleteSource(ctx, 'hung-base', {
      getSuggestions: async (_lines, _cursorLine, _cursorCol, options) => {
        hungSignal = options.signal
        return new Promise(() => {})
      },
      applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
    })
    const settledItem: BlueAutocompleteItem = { value: 'settled', label: 'Settled' }
    const unregisterSettled = registerEditorAutocompleteSource(ctx, 'settled-base', {
      getSuggestions: async () => ({ items: [settledItem], prefix: 'x' }),
      applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
    })
    try {
      const pending = suggestions(editor.autocompleteProvider!, 'x', true)
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(pending).resolves.toEqual({ items: [settledItem], prefix: 'x' })
      expect(hungSignal?.aborted).toBe(true)
    } finally {
      runtime.dispose()
      unregisterSettled()
      unregisterHung()
      vi.useRealTimers()
    }
  })

  it('caps combined base and public output and exercises generic application fallbacks', async () => {
    const extensionItems = Array.from({ length: 100 }, (_, index) => ({ id: `extension-${String(index)}`, label: 'Extension', insertText: 'extension' }))
    const baseItems = Array.from({ length: 150 }, (_, index): BlueAutocompleteItem => ({ value: `base-${String(index)}`, label: 'Base' }))
    const { ctx, editor, runtime } = runtimeFixture([{
      id: 'acme.completion-cap',
      completeV2: async () => success(extensionItems),
    }])
    const unregister = registerEditorAutocompleteSource(ctx, 'base-cap', {
      getSuggestions: async () => ({ items: baseItems, prefix: '' }),
      applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
      shouldTriggerFileCompletion: () => { throw new Error('file trigger failed') },
    })
    const provider = editor.autocompleteProvider!
    const result = await suggestions(provider, '', true)
    expect(result?.items).toHaveLength(200)
    expect(provider.shouldTriggerFileCompletion?.(['x'], 0, 1)).toBe(false)
    expect(provider.applyCompletion([], 0, 0, { value: 'fallback', label: 'Fallback' }, '')).toEqual({
      lines: [],
      cursorLine: 0,
      cursorCol: 8,
    })
    expect(provider.applyCompletion(['one', 'two'], 0, 3, { value: 'fallback', label: 'Fallback' }, 'one')).toEqual({
      lines: ['fallback', 'two'],
      cursorLine: 0,
      cursorCol: 8,
    })
    runtime.dispose()
    unregister()
  })

  it('caps hostile base output and supplies the terminal prefix fallback', async () => {
    const { ctx, editor, runtime } = runtimeFixture()
    const items = Array.from({ length: 201 }, (_, index): BlueAutocompleteItem => ({ value: String(index), label: String(index) }))
    const unregister = registerEditorAutocompleteSource(ctx, 'hostile-base-cap', {
      getSuggestions: async () => ({ items, prefix: undefined as never }),
      applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
    })
    const result = await suggestions(editor.autocompleteProvider!, 'plain')
    expect(result).toMatchObject({ prefix: '', items: expect.any(Array) })
    expect(result?.items).toHaveLength(200)
    runtime.dispose()
    unregister()
  })

  it('times out a hung extension while retaining settled base suggestions', async () => {
    vi.useFakeTimers()
    const hung = new Promise<BlueResult<readonly BlueEditorCompletionItem[]>>(() => {})
    const { ctx, editor, runtime, notices } = runtimeFixture([{
      id: 'acme.hung-completion',
      completeV2: () => hung,
    }])
    const baseItem: BlueAutocompleteItem = { value: '/base', label: 'Base' }
    const unregister = registerEditorAutocompleteSource(ctx, 'base-timeout', {
      getSuggestions: async () => ({ items: [baseItem], prefix: '/b' }),
      applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
    })
    try {
      const pending = suggestions(editor.autocompleteProvider!, '/b')
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(pending).resolves.toEqual({ items: [baseItem], prefix: '/b' })
      expect(notices).toContain('editor extension completion timed out')
    } finally {
      runtime.dispose()
      unregister()
      vi.useRealTimers()
    }
  })
})

describe('editor extension submit barrier', () => {
  it('keeps the buffer until ordered async transforms settle, then commits once', async () => {
    const gate = Promise.withResolvers<BlueResult<BlueEditorSubmitValue>>()
    const requests: BlueEditorSubmitRequest[] = []
    const entries: BlueEditorExtensionContribution[] = [
      {
        id: 'acme.first',
        priority: 10,
        transformSubmit: async request => {
          requests.push(request)
          return gate.promise
        },
      },
      {
        id: 'acme.second',
        transformSubmit: request => {
          requests.push(request)
          return success({ text: `second:${request.text}` })
        },
      },
    ]
    const { editor, runtime } = runtimeFixture(entries)
    const submitted: Array<ReturnType<EditorExtensionRuntime['takePrepared']>> = []
    editor.onSubmit = source => submitted.push(runtime.takePrepared(source))
    editor.setText('draft')
    editor.submit()
    expect(editor.getText()).toBe('draft')
    expect(submitted).toEqual([])
    gate.resolve(success({ text: 'first:draft' }))
    await vi.waitFor(() => expect(submitted).toHaveLength(1))
    expect(editor.getText()).toBe('')
    expect(requests.map(request => request.text)).toEqual(['draft', 'first:draft'])
    expect(submitted[0]).toEqual({ text: 'second:first:draft' })
    runtime.dispose()
  })

  it.each([
    ['rejection', async () => ({ ok: false as const, code: 'BLUE_ACTION_REJECTED' as const, message: 'blocked' }), 'blocked'],
    ['throw', async () => { throw new Error('exploded') }, 'exploded'],
    ['empty output', async () => success({ text: '   ' }), 'submit transform produced an empty prompt'],
  ])('cancels and preserves the editor on %s', async (_label, transform, expectedNotice) => {
    const { editor, runtime, notices } = runtimeFixture([{ id: 'acme.reject', transformSubmit: transform }])
    const submit = vi.fn()
    editor.onSubmit = submit
    editor.setText('keep me')
    editor.submit()
    await vi.waitFor(() => expect(notices).toContain(expectedNotice))
    expect(editor.getText()).toBe('keep me')
    expect(submit).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it.each([
    ['null value', async () => success(null as never), 'submit transform value must be an object'],
    ['missing text', async () => success({} as never), 'text must be an own data property'],
    ['accessor text', async () => success(Object.defineProperty({}, 'text', { get: () => 'x' }) as never), 'text must be an own data property'],
    ['rejected without message', async () => ({ ok: false as const, code: 'BLUE_ACTION_REJECTED' as const } as never), 'submit transform failed'],
    ['rejected with blank message', async () => ({ ok: false as const, code: 'BLUE_ACTION_REJECTED' as const, message: '' }), 'submit transform failed'],
    ['raw thrown value', async () => new Proxy({}, { getOwnPropertyDescriptor: () => { throw 'raw submit trap' } }) as never, 'submit transform was rejected'],
  ])('contains hostile submit shape: %s', async (_label, transform, expectedNotice) => {
    const { editor, runtime, notices } = runtimeFixture([{ id: 'acme.hostile-submit', transformSubmit: transform }])
    editor.setText('hostile draft')
    editor.submit()
    await vi.waitFor(() => expect(notices.some(notice => notice.includes(expectedNotice))).toBe(true))
    expect(editor.getText()).toBe('hostile draft')
    runtime.dispose()
  })

  it('covers owner-declined, empty-generation, aborted, failed-commit, and thrown-commit attempts', async () => {
    const noBinding = runtimeFixture()
    const noBindingCommit = vi.fn(() => true)
    privateSubmit(noBinding.runtime, {
      text: 'plain', signal: new AbortController().signal, revision: 1,
      commit: noBindingCommit, cancel: vi.fn(),
    })
    expect(noBindingCommit).toHaveBeenCalledOnce()
    noBinding.runtime.dispose()

    const declinedBlue = fakeBlueContext()
    const declinedEditor = new FakeBlueEditor()
    const declinedRuntime = new EditorExtensionRuntime({
      ctx: declinedBlue.ctx,
      editor: declinedEditor,
      notice: () => {},
      shouldTransformSubmit: () => false,
    })
    const declinedBinding = binding([{ id: 'acme.declined', transformSubmit: request => success({ text: request.text }) }])
    setEditorExtensions(declinedBlue.ctx, declinedBinding)
    const declinedCommit = vi.fn(() => true)
    privateSubmit(declinedRuntime, {
      text: 'declined', signal: new AbortController().signal, revision: 2,
      commit: declinedCommit, cancel: vi.fn(),
    })
    expect(declinedCommit).toHaveBeenCalledOnce()
    declinedRuntime.dispose()

    const mutableEntries: BlueEditorExtensionContribution[] = [{ id: 'acme.mutable', transformSubmit: request => success({ text: request.text }) }]
    const empty = runtimeFixture(mutableEntries)
    mutableEntries.splice(0)
    const emptyCommit = vi.fn(() => true)
    privateSubmit(empty.runtime, {
      text: 'empty generation', signal: new AbortController().signal, revision: 3,
      commit: emptyCommit, cancel: vi.fn(),
    })
    expect(emptyCommit).toHaveBeenCalledOnce()
    empty.runtime.dispose()

    const aborted = runtimeFixture([{ id: 'acme.abort-before-loop', transformSubmit: async request => success({ text: request.text }) }])
    const abortedCancel = vi.fn()
    privateSubmit(aborted.runtime, {
      text: 'aborted', signal: new AbortController().signal, revision: 4,
      commit: vi.fn(() => true), cancel: abortedCancel,
    })
    aborted.runtime.invalidateSession()
    await new Promise(resolve => setImmediate(resolve))
    expect(abortedCancel).toHaveBeenCalledOnce()
    aborted.runtime.dispose()

    const failed = runtimeFixture([{ id: 'acme.failed-commit', transformSubmit: request => success({ text: request.text }) }])
    privateSubmit(failed.runtime, {
      text: 'failed commit', signal: new AbortController().signal, revision: 5,
      commit: () => false, cancel: vi.fn(),
    })
    await new Promise(resolve => setImmediate(resolve))
    expect(failed.runtime.takePrepared('failed commit')).toBeUndefined()
    failed.runtime.dispose()

    const thrown = runtimeFixture([{ id: 'acme.thrown-commit', transformSubmit: request => success({ text: request.text }) }])
    const thrownCancel = vi.fn()
    privateSubmit(thrown.runtime, {
      text: 'thrown commit', signal: new AbortController().signal, revision: 6,
      commit: () => { throw 'raw commit failure' }, cancel: thrownCancel,
    })
    await vi.waitFor(() => expect(thrown.notices).toContain('submit transform failed'))
    expect(thrownCancel).toHaveBeenCalledOnce()
    thrown.runtime.dispose()
  })

  it('contains an abort raised while capturing text and an aborted commit failure', async () => {
    const beforeLoop = runtimeFixture([{
      id: 'acme.abort-during-capture',
      transformSubmit: request => success({ text: request.text }),
    }])
    const captureController = new AbortController()
    const captureCancel = vi.fn()
    const hostileText = {
      replace: () => {
        captureController.abort()
        return 'captured'
      },
    } as unknown as string
    privateSubmit(beforeLoop.runtime, {
      text: hostileText,
      signal: captureController.signal,
      revision: 7,
      commit: vi.fn(() => true),
      cancel: captureCancel,
    })
    await new Promise(resolve => setImmediate(resolve))
    expect(captureCancel).toHaveBeenCalledOnce()
    beforeLoop.runtime.dispose()

    const duringCommit = runtimeFixture([{
      id: 'acme.abort-during-commit',
      transformSubmit: request => success({ text: request.text }),
    }])
    const commitController = new AbortController()
    const commitCancel = vi.fn()
    privateSubmit(duringCommit.runtime, {
      text: 'commit abort',
      signal: commitController.signal,
      revision: 8,
      commit: () => {
        commitController.abort()
        throw new Error('commit failed after abort')
      },
      cancel: commitCancel,
    })
    await vi.waitFor(() => expect(commitCancel).toHaveBeenCalledTimes(2))
    expect(duringCommit.notices).not.toContain('commit failed after abort')
    duringCommit.runtime.dispose()
  })

  it.each([
    ['invalid BlueResult', async () => null as never, 'submit transform must return a BlueResult'],
    ['invalid value', async () => success({ text: 7 as never }), 'submit transform text exceeds'],
    ['overlong text', async () => success({ text: 'x'.repeat(20_001) }), 'submit transform text exceeds'],
  ])('contains malicious %s and keeps the draft', async (_label, transform, expectedNotice) => {
    const { editor, runtime, notices } = runtimeFixture([{ id: 'acme.invalid-transform', transformSubmit: transform }])
    const submitted = vi.fn()
    editor.onSubmit = submitted
    editor.setText('still here')
    editor.submit()
    await vi.waitFor(() => expect(notices.some(notice => notice.includes(expectedNotice))).toBe(true))
    expect(editor.getText()).toBe('still here')
    expect(submitted).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('aborts a stale transform when the buffer changes and ignores its late result', async () => {
    const gate = Promise.withResolvers<BlueResult<BlueEditorSubmitValue>>()
    let signal: AbortSignal | undefined
    const { editor, runtime, notices } = runtimeFixture([{
      id: 'acme.stale',
      transformSubmit: (_request, context) => {
        signal = context.signal
        return gate.promise
      },
    }])
    const submit = vi.fn()
    editor.onSubmit = submit
    editor.setText('draft')
    editor.submit()
    await vi.waitFor(() => expect(signal).toBeDefined())
    editor.insertText('!')
    expect(signal?.aborted).toBe(true)
    gate.resolve(success({ text: 'late' }))
    await new Promise(resolve => setImmediate(resolve))
    expect(editor.getText()).toBe('draft!')
    expect(submit).not.toHaveBeenCalled()
    expect(notices).toEqual([])
    runtime.dispose()
  })

  it('aborts pending work on extension refresh and accepts a new transaction', async () => {
    const gate = Promise.withResolvers<BlueResult<BlueEditorSubmitValue>>()
    let oldSignal: AbortSignal | undefined
    const { editor, runtime, replace } = runtimeFixture([{
      id: 'acme.old',
      transformSubmit: (_request, context) => {
        oldSignal = context.signal
        return gate.promise
      },
    }])
    const submitted: string[] = []
    editor.onSubmit = source => submitted.push(runtime.takePrepared(source)?.text ?? source)
    editor.setText('old')
    editor.submit()
    await vi.waitFor(() => expect(oldSignal).toBeDefined())
    replace([{ id: 'acme.new', transformSubmit: request => success({ text: `new:${request.text}` }) }])
    expect(oldSignal?.aborted).toBe(true)
    gate.resolve(success({ text: 'late-old' }))
    await new Promise(resolve => setImmediate(resolve))
    expect(editor.getText()).toBe('old')
    expect(submitted).toEqual([])

    editor.setText('current')
    editor.submit()
    await vi.waitFor(() => expect(submitted).toEqual(['new:current']))
    runtime.dispose()
  })

  it('cancels the pending attempt on session invalidation, preserves the draft, and submits again', async () => {
    const first = Promise.withResolvers<BlueResult<BlueEditorSubmitValue>>()
    const signals: AbortSignal[] = []
    let calls = 0
    const { editor, runtime } = runtimeFixture([{
      id: 'acme.session-transform',
      transformSubmit: (request, context) => {
        signals.push(context.signal)
        calls += 1
        return calls === 1 ? first.promise : success({ text: `current:${request.text}` })
      },
    }])
    const submitted: string[] = []
    editor.onSubmit = source => submitted.push(runtime.takePrepared(source)?.text ?? source)
    editor.setText('session draft')
    editor.submit()
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    runtime.invalidateSession()
    expect(signals[0]?.aborted).toBe(true)
    expect(editor.getText()).toBe('session draft')
    first.resolve(success({ text: 'late' }))
    await new Promise(resolve => setImmediate(resolve))
    expect(submitted).toEqual([])

    editor.submit()
    await vi.waitFor(() => expect(submitted).toEqual(['current:session draft']))
    expect(signals[1]?.aborted).toBe(false)
    runtime.dispose()
  })

  it('passes a frozen attachment snapshot through every transform and restores consumed images on rollback', async () => {
    const ref: ImageAttachmentRef = {
      attachmentId: AttachmentId('extension-image'),
      mediaType: 'image/png',
      bytes: 42,
      width: 3,
      height: 2,
      name: 'capture.png',
    }
    const requests: BlueEditorSubmitRequest[] = []
    const entries: BlueEditorExtensionContribution[] = [
      { id: 'acme.one', transformSubmit: request => { requests.push(request); return success({ text: `one:${request.text}` }) } },
      { id: 'acme.two', transformSubmit: request => { requests.push(request); return success({ text: `two:${request.text}` }) } },
    ]
    const { ctx, editor, runtime } = runtimeFixture(entries)
    ctx.blueInteractionState.pasteImage.pastedImages.set('[image #1]', ref)
    let prepared: ReturnType<EditorExtensionRuntime['takePrepared']>
    editor.onSubmit = source => { prepared = runtime.takePrepared(source) }
    editor.setText('[image #1] hello')
    editor.submit()
    await vi.waitFor(() => expect(prepared).toBeDefined())

    expect(requests.map(request => request.text)).toEqual(['hello', 'one:hello'])
    expect(requests[0]?.attachments).toEqual([{
      id: 'extension-image',
      label: 'capture.png',
      mediaType: 'image/png',
      size: 42,
    }])
    expect(Object.isFrozen(requests[0])).toBe(true)
    expect(Object.isFrozen(requests[0]?.attachments)).toBe(true)
    expect(requests[1]?.attachments).toBe(requests[0]?.attachments)
    expect(prepared!.transformation?.blocks).toEqual([
      { type: 'text', text: 'two:one:hello' },
      { type: 'image', attachment: ref },
    ])
    expect(ctx.blueInteractionState.pasteImage.pastedImages.has('[image #1]')).toBe(false)
    prepared!.transformation?.rollback?.()
    prepared!.transformation?.rollback?.()
    expect(ctx.blueInteractionState.pasteImage.pastedImages.get('[image #1]')).toBe(ref)
    runtime.dispose()
  })

  it('does not consume a replaced attachment and does not overwrite a replacement during rollback', async () => {
    const original = imageRefForCoverage('original-image')
    const replacement = imageRefForCoverage('replacement-image')
    const { ctx, editor, runtime } = runtimeFixture([{
      id: 'acme.attachment-race',
      transformSubmit: request => success({ text: request.text }),
    }])
    ctx.blueInteractionState.pasteImage.pastedImages.set('[image #1]', original)
    let raced: ReturnType<EditorExtensionRuntime['takePrepared']>
    editor.onSubmit = source => {
      ctx.blueInteractionState.pasteImage.pastedImages.set('[image #1]', replacement)
      raced = runtime.takePrepared(source)
    }
    editor.setText('[image #1] caption')
    editor.submit()
    await vi.waitFor(() => expect(raced).toBeDefined())
    expect(raced!.transformation?.blocks).toEqual([{ type: 'text', text: 'caption' }])
    expect(ctx.blueInteractionState.pasteImage.pastedImages.get('[image #1]')).toBe(replacement)

    ctx.blueInteractionState.pasteImage.pastedImages.set('[image #1]', original)
    let prepared: ReturnType<EditorExtensionRuntime['takePrepared']>
    editor.onSubmit = source => { prepared = runtime.takePrepared(source) }
    editor.setText('[image #1] caption')
    editor.submit()
    await vi.waitFor(() => expect(prepared).toBeDefined())
    ctx.blueInteractionState.pasteImage.pastedImages.set('[image #1]', replacement)
    prepared!.transformation?.rollback?.()
    expect(ctx.blueInteractionState.pasteImage.pastedImages.get('[image #1]')).toBe(replacement)
    runtime.dispose()
  })

  it('allows an image-only transformed submission', async () => {
    const ref: ImageAttachmentRef = {
      attachmentId: AttachmentId('image-only'),
      mediaType: 'image/png',
      bytes: 9,
      width: 1,
      height: 1,
    }
    const { ctx, editor, runtime } = runtimeFixture([{
      id: 'acme.image-only',
      transformSubmit: request => success({ text: request.text }),
    }])
    ctx.blueInteractionState.pasteImage.pastedImages.set('[image #1]', ref)
    let prepared: ReturnType<EditorExtensionRuntime['takePrepared']>
    editor.onSubmit = source => { prepared = runtime.takePrepared(source) }
    editor.setText('[image #1]')
    editor.submit()
    await vi.waitFor(() => expect(prepared).toBeDefined())
    expect(prepared!.text).toBe('')
    expect(prepared!.transformation?.blocks).toEqual([{ type: 'image', attachment: ref }])
    runtime.dispose()
  })

  it('keeps an unknown image marker as ordinary text', async () => {
    const requests: BlueEditorSubmitRequest[] = []
    const { editor, runtime } = runtimeFixture([{
      id: 'acme.unknown-marker',
      transformSubmit: request => {
        requests.push(request)
        return success({ text: request.text })
      },
    }])
    let prepared: ReturnType<EditorExtensionRuntime['takePrepared']>
    editor.onSubmit = source => { prepared = runtime.takePrepared(source) }
    editor.setText('keep [image #77] literal')
    editor.submit()
    await vi.waitFor(() => expect(prepared).toBeDefined())
    expect(requests).toEqual([{ text: 'keep [image #77] literal', attachments: [] }])
    expect(prepared).toEqual({ text: 'keep [image #77] literal' })
    runtime.dispose()
  })

  it('cancels a pending transform when the runtime disposes', async () => {
    const gate = Promise.withResolvers<BlueResult<BlueEditorSubmitValue>>()
    let signal: AbortSignal | undefined
    const { editor, runtime, notices } = runtimeFixture([{
      id: 'acme.dispose-transform',
      transformSubmit: (_request, context) => {
        signal = context.signal
        return gate.promise
      },
    }])
    const submitted = vi.fn()
    editor.onSubmit = submitted
    editor.setText('survives dispose')
    editor.submit()
    await vi.waitFor(() => expect(signal).toBeDefined())
    runtime.dispose()
    expect(signal?.aborted).toBe(true)
    expect(editor.getText()).toBe('survives dispose')
    gate.resolve(success({ text: 'late' }))
    await new Promise(resolve => setImmediate(resolve))
    expect(submitted).not.toHaveBeenCalled()
    expect(notices).toEqual([])

    // Disposal removed the barrier, so the same editor can submit normally.
    editor.submit()
    expect(submitted).toHaveBeenCalledWith('survives dispose')
  })

  it('times out a hung transform, cancels the attempt, and preserves the draft', async () => {
    vi.useFakeTimers()
    const hung = new Promise<BlueResult<BlueEditorSubmitValue>>(() => {})
    const { editor, runtime, notices } = runtimeFixture([{
      id: 'acme.hung-transform',
      transformSubmit: () => hung,
    }])
    const submitted = vi.fn()
    editor.onSubmit = submitted
    editor.setText('timeout draft')
    editor.submit()
    try {
      await vi.advanceTimersByTimeAsync(30_000)
      expect(editor.getText()).toBe('timeout draft')
      expect(submitted).not.toHaveBeenCalled()
      expect(notices).toContain('editor extension submit transform timed out')
    } finally {
      runtime.dispose()
      vi.useRealTimers()
    }
  })
})

describe('editor extension shell and actions', () => {
  it('refreshes the shell around the exact same editor and preserves its draft', () => {
    const { editor, runtime, replace } = runtimeFixture([{ id: 'acme.first', before: { kind: 'text', content: 'before-one' } }])
    editor.setText('persistent draft')
    expect(runtime.render(80).join('\n')).toContain('before-one')
    replace([{ id: 'acme.second', after: { kind: 'text', content: 'after-two' } }])
    expect(runtime.render(80).join('\n')).toContain('after-two')
    expect(editor.getText()).toBe('persistent draft')
    runtime.focused = true
    runtime.handleInput('!')
    expect(editor.getText()).toBe('persistent draft!')
    runtime.dispose()
  })

  it('admits recursive passive shell nodes and contains malformed chrome contributions', () => {
    const accessorTone = Object.defineProperty({ id: 'accessor-tone', message: 'bad tone' }, 'tone', { get: () => 'warning', enumerable: true })
    const accessorMessage = Object.defineProperty({ id: 'accessor-message' }, 'message', { get: () => 'bad message', enumerable: true })
    const entries = [{
      id: 'acme.passive-stack',
      before: { kind: 'stack' as const, direction: 'column' as const, children: [{ node: { kind: 'text' as const, content: 'stack child' } }] },
      after: { kind: 'surface' as const, child: { kind: 'text' as const, content: 'surface child' }, footer: { kind: 'divider' as const, label: 'footer' } },
      hint: 'valid hint',
      diagnostics: [
        { id: 'default-tone', message: 'default warning' },
        { id: 'explicit-tone', message: 'explicit success', tone: 'success' as const },
        null,
        accessorTone,
        accessorMessage,
        { id: 'invalid-message', message: 7 },
        { id: 'invalid-tone', message: 'invalid tone', tone: 'loud' },
      ],
    }, {
      id: 'acme.surface-without-footer',
      before: { kind: 'surface' as const, child: { kind: 'text' as const, content: 'bare surface' } },
      after: { kind: 'stack' as const, direction: 'column' as const, children: [{ node: { kind: 'text' as const, content: 'after stack' } }] },
    }, {
      id: 'acme.rejected-chrome',
      before: { kind: 'actions', id: 'interactive-before', items: [] },
      after: { kind: 'unknown' },
      hint: 'x'.repeat(20_001),
      actions: [{ id: '', label: 'invalid action' }],
    }, {
      id: 'acme.opposite-rejections',
      before: { kind: 'unknown' },
      after: { kind: 'actions', id: 'interactive-after', items: [] },
    }] as unknown as readonly BlueEditorExtensionContribution[]
    const { runtime, notices } = runtimeFixture(entries)
    expect(runtime.render(Infinity).length).toBeGreaterThan(0)
    const output = runtime.render(80).join('\n')
    expect(output).toContain('stack child')
    expect(output).toContain('surface child')
    expect(output).toContain('default warning')
    expect(output).toContain('explicit success')
    expect(notices).toEqual(expect.arrayContaining([
      'editor extension before must be passive',
      expect.stringContaining('unknown Blue UI kind'),
      expect.stringContaining('Blue UI text exceeds'),
      expect.stringContaining('tone must be an own data property'),
      expect.stringContaining('message must be an own data property'),
    ]))
    runtime.invalidate()
    runtime.dispose()
  })

  it('falls back to the editor when separately valid extension trees exceed the shell quota', () => {
    const entries = Array.from({ length: 256 }, (_, index): BlueEditorExtensionContribution => ({
      id: `acme.quota-${String(index)}`,
      before: { kind: 'text', content: `row ${String(index)}` },
    }))
    const { editor, runtime, notices } = runtimeFixture(entries)
    expect(runtime.render(80)).toEqual(editor.render(80))
    expect(notices).toContain('$.children exceeds 200 entries')
    runtime.dispose()
  })

  it('contains unknown actions, handler failures, and hostile action results', async () => {
    const results: unknown[] = [
      success(undefined),
      null,
      { ok: false, code: 'BLUE_ACTION_REJECTED', message: '' },
      new Proxy({}, { getOwnPropertyDescriptor: () => { throw 'raw event trap' } }),
    ]
    const calls: BlueUiEvent[] = []
    const entries: readonly BlueEditorExtensionContribution[] = [{
      id: 'acme.action-results',
      actions: [{ id: 'run', label: 'Run' }],
      onEvent: async event => {
        calls.push(event)
        const result = results.shift()
        if (result === undefined) throw new Error('rejected action callback')
        return result as BlueResult
      },
    }, {
      id: 'acme.no-handler',
      actions: [{ id: 'idle', label: 'Idle' }],
    }]
    const { runtime, notices, replace } = runtimeFixture(entries)
    privateDispatch(runtime, { kind: 'change', controlId: 'extension-0-0', value: 'ignored' })
    privateDispatch(runtime, { kind: 'activate', controlId: 'missing' })
    privateDispatch(runtime, { kind: 'activate', controlId: 'extension-1-0' })
    for (let index = 0; index < 5; index += 1) privateDispatch(runtime, { kind: 'activate', controlId: 'extension-0-0' })
    await vi.waitFor(() => expect(calls).toHaveLength(5))
    expect(notices).toEqual(expect.arrayContaining([
      'editor action must return a BlueResult',
      'editor action failed',
      'editor action result was rejected',
      'rejected action callback',
    ]))

    privateDispatch(runtime, { kind: 'activate', controlId: 'extension-0-0' })
    replace([], 3)
    await new Promise(resolve => setImmediate(resolve))
    runtime.dispose()
  })

  it('contains both a queued action rejection and a throwing owner notice', async () => {
    const { ctx } = fakeBlueContext()
    const editor = new FakeBlueEditor()
    let calls = 0
    setEditorExtensions(ctx, binding([{
      id: 'acme.throwing-notice',
      actions: [{ id: 'run', label: 'Run' }],
      onEvent: async () => {
        calls += 1
        return calls === 1 ? Promise.reject(new Error('first rejection')) : success(undefined)
      },
    }]))
    const runtime = new EditorExtensionRuntime({
      ctx,
      editor,
      notice: () => { throw new Error('notice failed') },
      shouldTransformSubmit: () => true,
    })
    privateDispatch(runtime, { kind: 'activate', controlId: 'extension-0-0' })
    privateDispatch(runtime, { kind: 'activate', controlId: 'extension-0-0' })
    await vi.waitFor(() => expect(calls).toBe(2))
    runtime.dispose()
  })

  it('serializes repeated actions per extension and drops queued work after unload', async () => {
    const first = Promise.withResolvers<BlueResult>()
    const calls: string[] = []
    const signals: AbortSignal[] = []
    let count = 0
    const entry: BlueEditorExtensionContribution = {
      id: 'acme.actions',
      actions: [{ id: 'run', label: 'Run', intent: 'primary' }],
      onEvent: (event, context) => {
        calls.push((event as BlueUiEvent & { controlId: string }).controlId)
        signals.push(context.signal)
        count += 1
        return count === 1 ? first.promise : success(undefined)
      },
    }
    const { runtime, replace } = runtimeFixture([entry])
    runtime.focused = true
    runtime.render(80)
    runtime.handleInput(KEY.tab)
    runtime.handleInput(KEY.enter)
    runtime.handleInput(KEY.enter)
    await vi.waitFor(() => expect(calls).toEqual(['run']))
    first.resolve(success(undefined))
    await vi.waitFor(() => expect(calls).toEqual(['run', 'run']))

    const late = Promise.withResolvers<BlueResult>()
    const retiring: BlueEditorExtensionContribution = {
      ...entry,
      onEvent: (_event, context) => {
        calls.push('late')
        signals.push(context.signal)
        return late.promise
      },
    }
    replace([retiring], 3)
    runtime.render(80)
    runtime.handleInput(KEY.tab)
    runtime.handleInput(KEY.enter)
    runtime.handleInput(KEY.enter)
    await vi.waitFor(() => expect(calls.at(-1)).toBe('late'))
    replace([], 4)
    expect(signals.at(-1)?.aborted).toBe(true)
    late.resolve({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'too late' })
    await new Promise(resolve => setImmediate(resolve))
    expect(calls.filter(call => call === 'late')).toHaveLength(1)
    runtime.dispose()
  })

  it('fences queued action dispatch across session invalidation and starts the new lifecycle immediately', async () => {
    const hung = Promise.withResolvers<BlueResult>()
    const entry: BlueEditorExtensionContribution = {
      id: 'acme.session-action',
      actions: [{ id: 'run', label: 'Run', intent: 'primary' }],
      onEvent: () => success(undefined),
    }
    const installed = binding([entry])
    const dispatch = vi.fn()
      .mockImplementationOnce((_entry, _event, _signal, _revision) => hung.promise)
      .mockResolvedValue(success(undefined))
    const { ctx } = fakeBlueContext()
    const editor = new FakeBlueEditor()
    setEditorExtensions(ctx, { ...installed, dispatch })
    const runtime = new EditorExtensionRuntime({
      ctx,
      editor,
      notice: () => {},
      shouldTransformSubmit: () => true,
    })

    privateDispatch(runtime, { kind: 'activate', controlId: 'extension-0-0' })
    privateDispatch(runtime, { kind: 'activate', controlId: 'extension-0-0' })
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce())

    runtime.invalidateSession()
    privateDispatch(runtime, { kind: 'activate', controlId: 'extension-0-0' })
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2))
    expect(dispatch.mock.calls[1]?.[1]).toEqual({ kind: 'activate', controlId: 'run' })

    hung.resolve(success(undefined))
    await new Promise(resolve => setImmediate(resolve))
    expect(dispatch).toHaveBeenCalledTimes(2)
    runtime.dispose()
  })

  it('never dispatches a queued action after runtime disposal', async () => {
    const hung = Promise.withResolvers<BlueResult>()
    const entry: BlueEditorExtensionContribution = {
      id: 'acme.dispose-action',
      actions: [{ id: 'run', label: 'Run', intent: 'primary' }],
      onEvent: () => success(undefined),
    }
    const installed = binding([entry])
    const dispatch = vi.fn().mockReturnValue(hung.promise)
    const { ctx } = fakeBlueContext()
    const editor = new FakeBlueEditor()
    setEditorExtensions(ctx, { ...installed, dispatch })
    const runtime = new EditorExtensionRuntime({
      ctx,
      editor,
      notice: () => {},
      shouldTransformSubmit: () => true,
    })

    privateDispatch(runtime, { kind: 'activate', controlId: 'extension-0-0' })
    privateDispatch(runtime, { kind: 'activate', controlId: 'extension-0-0' })
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce())

    runtime.dispose()
    hung.resolve(success(undefined))
    await new Promise(resolve => setImmediate(resolve))
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('lets the same id run in a new generation while the old action remains hung', async () => {
    vi.useFakeTimers()
    const old = Promise.withResolvers<BlueResult>()
    let oldSignal: AbortSignal | undefined
    const calls: string[] = []
    const { runtime, notices, replace } = runtimeFixture([{
      id: 'acme.same-action',
      actions: [{ id: 'run', label: 'Run', intent: 'primary' }],
      onEvent: (_event, context) => {
        calls.push('old')
        oldSignal = context.signal
        return old.promise
      },
    }])
    try {
      runtime.focused = true
      runtime.render(80)
      runtime.handleInput(KEY.tab)
      runtime.handleInput(KEY.enter)
      await vi.advanceTimersByTimeAsync(0)
      expect(calls).toEqual(['old'])

      replace([{
        id: 'acme.same-action',
        actions: [{ id: 'run', label: 'Run', intent: 'primary' }],
        onEvent: () => { calls.push('new'); return success(undefined) },
      }], 2)
      expect(oldSignal?.aborted).toBe(true)
      runtime.render(80)
      runtime.handleInput(KEY.tab)
      runtime.handleInput(KEY.enter)
      await vi.advanceTimersByTimeAsync(0)
      expect(calls).toEqual(['old', 'new'])

      old.resolve({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'late old failure' })
      await vi.advanceTimersByTimeAsync(0)
      expect(notices).not.toContain('late old failure')
    } finally {
      runtime.dispose()
      vi.useRealTimers()
    }
  })

  it('releases the per-extension FIFO when a hung action times out', async () => {
    vi.useFakeTimers()
    const hung = new Promise<BlueResult>(() => {})
    let calls = 0
    const { runtime, notices } = runtimeFixture([{
      id: 'acme.action-timeout',
      actions: [{ id: 'run', label: 'Run', intent: 'primary' }],
      onEvent: () => {
        calls += 1
        return calls === 1 ? hung : success(undefined)
      },
    }])
    try {
      runtime.focused = true
      runtime.render(80)
      runtime.handleInput(KEY.tab)
      runtime.handleInput(KEY.enter)
      runtime.handleInput(KEY.enter)
      await vi.advanceTimersByTimeAsync(0)
      expect(calls).toBe(1)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(calls).toBe(2)
      expect(notices).toContain('editor extension action timed out')
    } finally {
      runtime.dispose()
      vi.useRealTimers()
    }
  })
})
