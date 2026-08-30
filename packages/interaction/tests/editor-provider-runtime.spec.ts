/**
 * Editor-provider composition tests: inert selection, atomic shells, fallback,
 * snapshots, events, and lifecycle fencing around one stable editor engine.
 *
 * @module @dsh-blue/blue-interaction/tests/editor-provider-runtime
 */

import type {
  BlueEditorProvider,
  BlueEditorSnapshot,
  BlueResult,
  BlueUiEvent,
} from '@dsh-blue/blue-api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorExtensionRuntime } from '../src/editor-extension-runtime.ts'
import {
  setEditorExtensions,
  setEditorProviders,
  type EditorExtensionBinding,
  type EditorProviderBinding,
} from '../src/editor-instance.ts'
import { FakeBlueEditor, fakeBlueContext, KEY } from './fakes.ts'

function success(): BlueResult { return { ok: true, value: undefined } }

function providerBinding(
  desiredId: string,
  entries: readonly BlueEditorProvider[],
  revision = 1,
): EditorProviderBinding {
  return Object.freeze({
    desiredId,
    entries,
    revision,
    async dispatch(provider, event, signal, operationRevision) {
      if (provider.onEvent === undefined) return success()
      return provider.onEvent(event, Object.freeze({ surfaceId: provider.id, signal, revision: operationRevision }))
    },
  })
}

function extensionBinding(entries: EditorExtensionBinding['entries']): EditorExtensionBinding {
  return {
    revision: 1,
    entries,
    async complete() { return { ok: true, value: [] } },
    async transform(_entry, request) { return { ok: true, value: { text: request.text } } },
    async dispatch(entry, event, signal, revision) {
      return entry.onEvent?.(event, { surfaceId: entry.id, signal, revision }) ?? success()
    },
  }
}

function shell(label: string) {
  return {
    kind: 'stack' as const,
    direction: 'column' as const,
    children: [
      { node: { kind: 'text' as const, content: label } },
      { node: { kind: 'editor-control' as const } },
    ],
  }
}

function fixture(options: {
  readonly desiredId?: string
  readonly providers?: readonly BlueEditorProvider[]
  readonly extensions?: EditorExtensionBinding['entries']
  readonly onNotice?: (text: string) => void
} = {}) {
  const { ctx, screen, theme } = fakeBlueContext()
  const editor = new FakeBlueEditor()
  const notices: string[] = []
  if (options.extensions !== undefined) setEditorExtensions(ctx, extensionBinding(options.extensions))
  if (options.desiredId !== undefined || options.providers !== undefined) {
    setEditorProviders(ctx, providerBinding(options.desiredId ?? 'blue.default', options.providers ?? []))
  }
  const runtime = new EditorExtensionRuntime({
    ctx,
    editor,
    notice: text => {
      notices.push(text)
      options.onNotice?.(text)
    },
    shouldTransformSubmit: () => true,
  })
  return { ctx, screen, theme, editor, runtime, notices }
}

afterEach(() => { vi.useRealTimers() })

describe('editor provider composition', () => {
  it('keeps multiple candidates inert until the persisted id is selected and measured', () => {
    const firstRender = vi.fn(() => shell('first'))
    const secondRender = vi.fn(() => shell('second'))
    const first = { id: 'first', priority: 100, render: firstRender } satisfies BlueEditorProvider
    const second = { id: 'second', priority: -100, render: secondRender } satisfies BlueEditorProvider
    const value = fixture({ providers: [first, second] })

    expect(firstRender).not.toHaveBeenCalled()
    expect(secondRender).not.toHaveBeenCalled()
    expect(value.runtime.render(40).join('\n')).not.toContain('first')
    setEditorProviders(value.ctx, providerBinding('second', [first, second], 2))
    expect(secondRender).toHaveBeenCalledOnce()
    expect(value.runtime.render(40).join('\n')).toContain('second')
    expect(firstRender).not.toHaveBeenCalled()
    value.runtime.dispose()
  })

  it('preserves editor state, snapshots, and the IME marker across swaps', async () => {
    const imeMarker = '\x1b_pi:c\x07'
    const firstSnapshots: BlueEditorSnapshot[] = []
    const secondSnapshots: BlueEditorSnapshot[] = []
    const extensionEvent = vi.fn(async () => success())
    const extension = {
      id: 'extension',
      before: { kind: 'text' as const, content: 'before' },
      hint: 'hint',
      actions: [{ id: 'extension-action', label: 'Extension' }],
      onEvent: extensionEvent,
    }
    const first = {
      id: 'first',
      render: (snapshot: BlueEditorSnapshot) => { firstSnapshots.push(snapshot); return shell('provider one') },
    } satisfies BlueEditorProvider
    const second = {
      id: 'second',
      render: (snapshot: BlueEditorSnapshot) => { secondSnapshots.push(snapshot); return shell('provider two') },
    } satisfies BlueEditorProvider
    const value = fixture({ desiredId: 'first', providers: [first, second], extensions: [extension] })
    const outer = value.runtime
    const completion = value.editor.autocompleteProvider
    vi.spyOn(value.editor, 'render').mockImplementation(width => (
      value.editor.renderContent(width).map(row => row.replace('|', imeMarker))
    ))
    value.runtime.updateSession({ id: 'session', cwd: '/work', status: 'running', mode: 'plan' })
    value.ctx.blueInteractionState.pasteImage.pastedImages.set('[image #1]', {
      attachmentId: 'attachment' as never,
      mediaType: 'image/png',
      bytes: 7,
      width: 1,
      height: 1,
      name: 'shot.png',
    })
    value.editor.setText('[image #1]ab')
    value.editor.addToHistory('older')
    value.runtime.focused = true
    value.runtime.handleInput(KEY.left)
    const firstRows = value.runtime.render(60).join('\n')
    expect(firstRows).toContain('provider one')
    expect(firstRows).toContain(imeMarker)
    expect(firstSnapshots.at(-1)).toMatchObject({
      mode: 'plan',
      attachments: [{ id: 'attachment', label: 'shot.png', mediaType: 'image/png', size: 7 }],
    })

    setEditorProviders(value.ctx, providerBinding('second', [first, second], 2))
    const rows = value.runtime.render(60).join('\n')
    expect(rows).toContain('before')
    expect(rows).toContain('provider two')
    expect(rows).toContain('hint')
    expect(rows).toContain(imeMarker)
    expect(secondSnapshots.at(-1)).toMatchObject({
      mode: 'plan',
      attachments: [{ id: 'attachment', label: 'shot.png', mediaType: 'image/png', size: 7 }],
    })
    expect(value.runtime).toBe(outer)
    expect(value.editor.autocompleteProvider).toBe(completion)
    expect(value.editor.getHistory()).toEqual(['older'])
    expect(value.runtime.focused).toBe(true)
    expect(value.editor.focused).toBe(true)
    expect(value.editor.getText()).toBe('[image #1]ab')
    value.runtime.handleInput('X')
    expect(value.editor.getText()).toBe('[image #1]aXb')

    value.runtime.handleInput(KEY.tab)
    value.runtime.handleInput(KEY.enter)
    await vi.waitFor(() => expect(extensionEvent).toHaveBeenCalledOnce())
    value.runtime.dispose()
  })

  it('publishes a deeply frozen draft-free snapshot with session, attachment, and extension facts', () => {
    const snapshots: BlueEditorSnapshot[] = []
    const provider: BlueEditorProvider = { id: 'snapshot', render: snapshot => { snapshots.push(snapshot); return shell('snapshot') } }
    const value = fixture({
      desiredId: provider.id,
      providers: [provider],
      extensions: [{ id: 'extension', hint: 'safe', complete: async () => ({ ok: true, value: [] }) }],
    })
    value.runtime.updateSession({ id: 'session', cwd: '/work', status: 'running', mode: 'plan' })
    value.ctx.blueInteractionState.pasteImage.pastedImages.set('[image #1]', {
      attachmentId: 'attachment' as never,
      mediaType: 'image/png',
      bytes: 7,
      width: 1,
      height: 1,
      name: 'shot.png',
    })
    value.editor.setText('secret [image #1]')
    value.runtime.refreshProviderSnapshot()
    value.runtime.render(50)

    const snapshot = snapshots.at(-1)!
    expect(snapshot).toEqual({
      mode: 'plan',
      busy: true,
      attachments: [{ id: 'attachment', label: 'shot.png', mediaType: 'image/png', size: 7 }],
      extensions: [{ id: 'extension', hint: 'safe' }],
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.attachments)).toBe(true)
    expect(Object.isFrozen(snapshot.extensions)).toBe(true)
    expect(snapshot).not.toHaveProperty('draft')
    value.runtime.dispose()
  })

  it('refreshes attachment facts on render after programmatic editor changes', () => {
    const snapshots: BlueEditorSnapshot[] = []
    const provider: BlueEditorProvider = { id: 'snapshot', render: snapshot => { snapshots.push(snapshot); return shell('snapshot') } }
    const value = fixture({ desiredId: provider.id, providers: [provider] })
    value.ctx.blueInteractionState.pasteImage.pastedImages.set('[image #1]', {
      attachmentId: 'attachment' as never,
      mediaType: 'image/png',
      bytes: 7,
      width: 1,
      height: 1,
      name: 'shot.png',
    })
    value.runtime.render(50)
    expect(snapshots.at(-1)?.attachments).toEqual([])

    value.editor.setText('[image #1]')
    value.runtime.render(50)
    expect(snapshots.at(-1)?.attachments).toEqual([
      { id: 'attachment', label: 'shot.png', mediaType: 'image/png', size: 7 },
    ])

    value.editor.setText('')
    value.runtime.render(50)
    expect(snapshots.at(-1)?.attachments).toEqual([])
    value.runtime.dispose()
  })

  it('retains an interactive same-session shell on bad selection and defaults after three failures', () => {
    const first = { id: 'first', render: () => shell('known good') } satisfies BlueEditorProvider
    const bad = { id: 'bad', render: () => ({
      kind: 'stack' as const,
      direction: 'column' as const,
      children: [{ node: { kind: 'editor-control' as const } }, { node: { kind: 'editor-control' as const } }],
    }) } satisfies BlueEditorProvider
    const value = fixture({ desiredId: first.id, providers: [first, bad] })
    expect(value.runtime.render(50).join('\n')).toContain('known good')

    for (let revision = 2; revision <= 4; revision += 1) {
      setEditorProviders(value.ctx, providerBinding(bad.id, [first, bad], revision))
      const rows = value.runtime.render(50).join('\n')
      if (revision < 4) expect(rows).toContain('known good')
    }
    expect(value.runtime.providerStatus).toMatchObject({ desiredId: 'bad', activeId: 'blue.default', breakerOpen: true })
    value.runtime.dispose()
  })

  it('falls back in the same frame on a contained live failure and does not retry until refresh', () => {
    const value = fixture()
    let paints = 0
    const failPaint = (text: string): string => {
      paints += 1
      if (paints >= 2) throw new Error('live paint failed')
      return text
    }
    ;(value.theme.colors as unknown as { accent(text: string): string }).accent = failPaint
    ;(value.theme.colors as unknown as { primary(text: string): string }).primary = failPaint
    const provider: BlueEditorProvider = { id: 'fragile', render: () => ({
      kind: 'stack', direction: 'column', children: [
        { node: { kind: 'text', content: 'fragile', tone: 'accent' } },
        { node: { kind: 'editor-control' } },
      ],
    }) }
    setEditorProviders(value.ctx, providerBinding(provider.id, [provider]))

    expect(value.runtime.render(40).join('\n')).not.toContain('fragile')
    expect(value.runtime.providerStatus).toMatchObject({ desiredId: 'fragile', activeId: 'blue.default', runtimeFailure: 'live paint failed' })
    const calls = paints
    value.runtime.render(40)
    expect(paints).toBe(calls)
    value.runtime.dispose()
  })

  it('opens the rolling breaker after three live failures and resets only after a committed frame', () => {
    const value = fixture()
    let failLive = true
    let phase: 'dry' | 'live' = 'live'
    let providerRenders = 0
    const paint = (text: string): string => {
      if (phase === 'dry') {
        phase = 'live'
        return text
      }
      if (failLive) throw new Error('live paint failed')
      return text
    }
    ;(value.theme.colors as unknown as { accent(text: string): string }).accent = paint
    ;(value.theme.colors as unknown as { primary(text: string): string }).primary = paint
    const provider: BlueEditorProvider = {
      id: 'fragile',
      render: () => {
        providerRenders += 1
        phase = 'dry'
        return {
          kind: 'stack', direction: 'column', children: [
            { node: { kind: 'text', content: 'fragile', tone: 'accent' } },
            { node: { kind: 'editor-control' } },
          ],
        }
      },
    }
    setEditorProviders(value.ctx, providerBinding(provider.id, [provider]))

    value.runtime.render(40)
    value.runtime.render(41)
    expect(value.runtime.providerStatus.breakerOpen).toBe(false)
    value.runtime.render(42)
    expect(value.runtime.providerStatus).toMatchObject({ activeId: 'blue.default', breakerOpen: true })

    setEditorProviders(value.ctx, providerBinding('blue.default', [provider], 2))
    setEditorProviders(value.ctx, providerBinding(provider.id, [provider], 3))
    failLive = true
    value.runtime.render(43)
    expect(value.runtime.providerStatus).toMatchObject({ activeId: 'blue.default', breakerOpen: false })
    failLive = false
    value.runtime.render(44)
    expect(value.runtime.providerStatus).toMatchObject({ activeId: provider.id, breakerOpen: false })
    failLive = true
    value.runtime.render(45)
    value.runtime.render(46)
    expect(value.runtime.providerStatus.breakerOpen).toBe(false)
    value.runtime.render(47)
    expect(value.runtime.providerStatus.breakerOpen).toBe(true)
    const calls = providerRenders
    value.runtime.render(48)
    expect(providerRenders).toBe(calls)
    value.runtime.dispose()
  })

  it('does not let a stale same-provider LKG clear candidate failures', () => {
    let failCandidate = false
    const provider = {
      id: 'same',
      render: () => {
        if (failCandidate) throw new Error('candidate failed')
        return shell('same provider')
      },
    } satisfies BlueEditorProvider
    const value = fixture({ desiredId: provider.id, providers: [provider] })
    expect(value.runtime.render(40).join('\n')).toContain('same provider')

    failCandidate = true
    for (let revision = 2; revision <= 4; revision += 1) {
      setEditorProviders(value.ctx, providerBinding(provider.id, [provider], revision))
      const rows = value.runtime.render(40).join('\n')
      if (revision < 4) expect(rows).toContain('same provider')
    }
    expect(value.runtime.providerStatus).toMatchObject({ activeId: 'blue.default', breakerOpen: true })
    value.runtime.dispose()
  })

  it('prunes provider failures outside the rolling window', () => {
    vi.useFakeTimers({ now: 0 })
    const provider = { id: 'failing', render: () => { throw new Error('candidate failed') } } satisfies BlueEditorProvider
    const value = fixture({ desiredId: provider.id, providers: [provider] })
    value.runtime.render(40)

    vi.setSystemTime(60_001)
    setEditorProviders(value.ctx, providerBinding(provider.id, [provider], 2))
    setEditorProviders(value.ctx, providerBinding(provider.id, [provider], 3))
    expect(value.runtime.providerStatus.breakerOpen).toBe(false)
    setEditorProviders(value.ctx, providerBinding(provider.id, [provider], 4))
    expect(value.runtime.providerStatus.breakerOpen).toBe(true)
    value.runtime.dispose()
  })

  it('checks a retained provider fallback in the same frame and defaults when it also fails', () => {
    const value = fixture()
    let failed = new Set<string>()
    const paint = (text: string): string => {
      if (failed.has(text)) throw new Error(`${text} failed`)
      return text
    }
    ;(value.theme.colors as unknown as { accent(text: string): string }).accent = paint
    ;(value.theme.colors as unknown as { primary(text: string): string }).primary = paint
    const first = { id: 'first', render: () => ({
      kind: 'stack' as const, direction: 'column' as const, children: [
        { node: { kind: 'text' as const, content: 'first', tone: 'accent' as const } },
        { node: { kind: 'editor-control' as const } },
      ],
    }) } satisfies BlueEditorProvider
    const second = { id: 'second', render: () => ({
      kind: 'stack' as const, direction: 'column' as const, children: [
        { node: { kind: 'text' as const, content: 'second', tone: 'accent' as const } },
        { node: { kind: 'editor-control' as const } },
      ],
    }) } satisfies BlueEditorProvider
    setEditorProviders(value.ctx, providerBinding(first.id, [first, second]))
    expect(value.runtime.render(40).join('\n')).toContain('first')
    setEditorProviders(value.ctx, providerBinding(second.id, [first, second], 2))
    expect(value.runtime.render(40).join('\n')).toContain('second')

    failed = new Set(['second'])
    expect(value.runtime.render(40).join('\n')).toContain('first')
    expect(value.runtime.providerStatus.activeId).toBe(first.id)
    failed = new Set(['first'])
    expect(value.runtime.render(40).join('\n')).not.toContain('first')
    expect(value.runtime.providerStatus.activeId).toBe('blue.default')

    setEditorProviders(value.ctx, providerBinding(first.id, [first, second], 3))
    failed = new Set()
    value.runtime.render(41)
    setEditorProviders(value.ctx, providerBinding(second.id, [first, second], 4))
    value.runtime.render(41)
    failed = new Set(['first', 'second'])
    expect(value.runtime.render(41).join('\n')).not.toMatch(/first|second/u)
    expect(value.runtime.providerStatus.activeId).toBe('blue.default')
    value.runtime.dispose()
  })

  it('contains candidate render, standalone compile, and standalone dry-render failures', () => {
    const thrown = { id: 'thrown', render: () => { throw new Error('render failed') } } satisfies BlueEditorProvider
    const invalid = { id: 'invalid', render: () => ({
      kind: 'stack' as const,
      direction: 'column' as const,
      children: [{ node: { kind: 'editor-control' as const } }, { node: { kind: 'editor-control' as const } }],
    }) } satisfies BlueEditorProvider
    for (const provider of [thrown, invalid]) {
      const value = fixture({ desiredId: provider.id, providers: [provider] })
      expect(value.runtime.render(40).join('\n')).not.toContain(provider.id)
      expect(value.runtime.providerStatus.runtimeFailure).toBeDefined()
      value.runtime.dispose()
    }

    const dry = fixture()
    const failPaint = (): string => { throw new Error('dry failed') }
    ;(dry.theme.colors as unknown as { accent(text: string): string }).accent = failPaint
    ;(dry.theme.colors as unknown as { primary(text: string): string }).primary = failPaint
    const provider = { id: 'dry', render: () => ({
      kind: 'stack' as const, direction: 'column' as const, children: [
        { node: { kind: 'text' as const, content: 'dry', tone: 'accent' as const } },
        { node: { kind: 'editor-control' as const } },
      ],
    }) } satisfies BlueEditorProvider
    setEditorProviders(dry.ctx, providerBinding(provider.id, [provider]))
    expect(dry.runtime.render(40).join('\n')).not.toContain('dry')
    expect(dry.runtime.providerStatus.runtimeFailure).toBe('dry failed')
    dry.runtime.dispose()
  })

  it('falls back to the standalone provider when extension wrapping fails compile or dry render', async () => {
    const providerEvent = vi.fn(async () => success())
    const extensionEvent = vi.fn(async () => success())
    const collision: BlueEditorProvider = {
      id: 'collision',
      render: () => ({
        kind: 'stack', direction: 'column', children: [
          { node: { kind: 'actions', id: 'provider-actions', items: [{ id: 'extension-0-0', label: 'Provider' }] } },
          { node: { kind: 'editor-control' } },
        ],
      }),
      onEvent: providerEvent,
    }
    const collided = fixture({
      desiredId: collision.id,
      providers: [collision],
      extensions: [{ id: 'extension', actions: [{ id: 'extension-action', label: 'Extension' }], onEvent: extensionEvent }],
    })
    expect(collided.runtime.render(50).join('\n')).toContain('Provider')
    expect(collided.notices).toContainEqual(expect.stringContaining('could not wrap provider'))
    collided.runtime.dispatchEvent({ kind: 'activate', controlId: 'extension-0-0' })
    await vi.waitFor(() => expect(providerEvent).toHaveBeenCalledOnce())
    expect(extensionEvent).not.toHaveBeenCalled()
    collided.runtime.dispose()

    const dry = fixture({
      desiredId: 'provider',
      providers: [{ id: 'provider', render: () => shell('provider') }],
      extensions: [{ id: 'extension', hint: 'hint' }],
    })
    ;(dry.theme.colors as unknown as { muted(text: string): string }).muted = () => { throw new Error('extension paint failed') }
    expect(dry.runtime.render(50).join('\n')).toContain('provider')
    expect(dry.notices).toContain('editor extensions failed around provider: extension paint failed')
    dry.runtime.dispose()
  })

  it('publishes complete immutable extension and attachment snapshots', () => {
    const snapshots: BlueEditorSnapshot[] = []
    const provider: BlueEditorProvider = { id: 'snapshot', render: snapshot => { snapshots.push(snapshot); return shell('snapshot') } }
    const value = fixture({ desiredId: provider.id, providers: [provider] })
    value.runtime.render(50)
    value.ctx.blueInteractionState.pasteImage.pastedImages.set('[image #1]', {
      attachmentId: 'unnamed' as never,
      width: 1,
      height: 1,
    } as never)
    value.ctx.blueInteractionState.pasteImage.pastedImages.set('[image #2]', {
      attachmentId: 'orphan' as never,
      name: 'orphan.png',
    } as never)
    value.editor.setText('[image #1]')
    setEditorExtensions(value.ctx, extensionBinding([
      {
        id: 'complete',
        before: { kind: 'text', content: 'before' },
        after: { kind: 'text', content: 'after' },
        diagnostics: [
          { id: 'plain', message: 'plain' },
          { id: 'danger', message: 'danger', tone: 'danger' },
        ],
        actions: [
          { id: 'plain', label: 'Plain' },
          { id: 'full', label: 'Full', intent: 'primary', disabled: true, busy: true, confirm: 'Confirm?', shortcut: 'pageup', shortcutFor: 'provider-form', focusable: false },
        ],
      },
      {
        id: 'rejected-passive-fields',
        before: { kind: 'actions', id: 'interactive', items: [{ id: 'go', label: 'Go' }] },
        after: { kind: 'unknown' } as never,
      },
    ]))
    value.runtime.render(50)

    expect(snapshots.at(-1)).toEqual({
      mode: 'normal',
      busy: false,
      attachments: [{ id: 'unnamed', label: '[image #1]', mediaType: undefined, size: undefined }],
      extensions: [
        {
          id: 'complete',
          before: { kind: 'text', content: 'before' },
          after: { kind: 'text', content: 'after' },
          diagnostics: [
            { id: 'plain', message: 'plain' },
            { id: 'danger', message: 'danger', tone: 'danger' },
          ],
          actions: [
            { id: 'plain', label: 'Plain' },
            { id: 'full', label: 'Full', intent: 'primary', disabled: true, busy: true, confirm: 'Confirm?', shortcut: 'pageup', shortcutFor: 'provider-form', focusable: false },
          ],
        },
        { id: 'rejected-passive-fields' },
      ],
    })
    expect(Object.isFrozen(snapshots.at(-1)?.extensions[0]?.diagnostics)).toBe(true)
    expect(Object.isFrozen(snapshots.at(-1)?.extensions[0]?.actions)).toBe(true)
    value.runtime.dispose()
  })

  it('handles unchanged facts, same-session changes, blank selection, and active removal', () => {
    const snapshots: BlueEditorSnapshot[] = []
    const provider: BlueEditorProvider = { id: 'provider', render: snapshot => { snapshots.push(snapshot); return shell('provider') } }
    const value = fixture({ desiredId: provider.id, providers: [provider] })
    value.runtime.render(40)
    const initialCalls = snapshots.length
    value.runtime.updateSession(null)
    value.runtime.refreshProviderSnapshot()
    expect(snapshots).toHaveLength(initialCalls)

    value.runtime.updateSession({ id: 'session', cwd: '/', status: 'idle', mode: 'normal' })
    value.runtime.updateSession({ id: 'session', cwd: '/', status: 'running', mode: 'plan' })
    expect(snapshots.at(-1)).toMatchObject({ mode: 'plan', busy: true })

    setEditorProviders(value.ctx, providerBinding(' ', [provider], 2))
    expect(value.runtime.providerStatus.desiredId).toBe('blue.default')
    setEditorProviders(value.ctx, providerBinding(provider.id, [provider], 3))
    value.runtime.render(40)
    setEditorProviders(value.ctx, providerBinding(provider.id, [], 4))
    expect(value.runtime.providerStatus.activeId).toBe('blue.default')
    value.runtime.dispose()

    const plain = fixture()
    plain.runtime.refreshProviderSnapshot()
    plain.runtime.invalidateRoute()
    plain.runtime.dispose()
  })

  it('rejects a reentrant candidate after a newer provider commits', () => {
    let value: ReturnType<typeof fixture>
    let reenter = true
    const second = { id: 'second', render: () => shell('second') } satisfies BlueEditorProvider
    const first = {
      id: 'first',
      render: () => {
        if (reenter) {
          reenter = false
          setEditorProviders(value.ctx, providerBinding(second.id, [first, second], 2))
        }
        return shell('first')
      },
    } satisfies BlueEditorProvider
    value = fixture({ desiredId: first.id, providers: [first, second] })

    expect(value.runtime.render(40).join('\n')).toContain('second')
    expect(value.runtime.providerStatus.activeId).toBe(second.id)
    value.runtime.dispose()
  })

  it('aborts stale provider events and serializes discrete actions per provider', async () => {
    const gates = [Promise.withResolvers<BlueResult>(), Promise.withResolvers<BlueResult>()]
    const signals: AbortSignal[] = []
    let calls = 0
    const provider: BlueEditorProvider = {
      id: 'events',
      render: () => ({
        kind: 'stack', direction: 'column', children: [
          { node: { kind: 'actions', id: 'actions', items: [{ id: 'go', label: 'Go' }] } },
          { node: { kind: 'editor-control' } },
        ],
      }),
      onEvent: (_event, context) => {
        signals.push(context.signal)
        return gates[calls++]!.promise
      },
    }
    const value = fixture({ desiredId: provider.id, providers: [provider] })
    value.runtime.render(50)
    value.runtime.handleInput(KEY.tab)
    value.runtime.handleInput(KEY.enter)
    value.runtime.handleInput(KEY.enter)
    await vi.waitFor(() => expect(calls).toBe(1))
    gates[0]!.resolve(success())
    await vi.waitFor(() => expect(calls).toBe(2))
    setEditorProviders(value.ctx, providerBinding('blue.default', [provider], 2))
    expect(signals[1]?.aborted).toBe(true)
    gates[1]!.resolve(success())
    await Promise.resolve()
    expect(value.runtime.providerStatus.activeId).toBe('blue.default')
    value.runtime.dispose()
  })

  it('uses latest-wins for change events and drops a stale FIFO tail', async () => {
    const changes = [Promise.withResolvers<BlueResult>(), Promise.withResolvers<BlueResult>()]
    const changeSignals: AbortSignal[] = []
    let changeCalls = 0
    const changeProvider: BlueEditorProvider = {
      id: 'changes',
      render: () => shell('changes'),
      onEvent: (_event, context) => {
        changeSignals.push(context.signal)
        return changes[changeCalls++]!.promise
      },
    }
    const latest = fixture({ desiredId: changeProvider.id, providers: [changeProvider] })
    latest.runtime.render(40)
    latest.runtime.dispatchEvent({ kind: 'value-change', controlId: 'field', value: 'first' })
    await vi.waitFor(() => expect(changeCalls).toBe(1))
    latest.runtime.dispatchEvent({ kind: 'selection-change', controlId: 'list', value: 'second' })
    await vi.waitFor(() => expect(changeCalls).toBe(2))
    expect(changeSignals[0]?.aborted).toBe(true)
    changes[0]!.resolve(success())
    changes[1]!.resolve(success())
    await Promise.resolve()
    latest.runtime.dispose()

    const gate = Promise.withResolvers<BlueResult>()
    const discrete = vi.fn(() => gate.promise)
    const fifoProvider: BlueEditorProvider = { id: 'fifo', render: () => shell('fifo'), onEvent: discrete }
    const fifo = fixture({ desiredId: fifoProvider.id, providers: [fifoProvider] })
    fifo.runtime.render(40)
    fifo.runtime.dispatchEvent({ kind: 'dismiss' })
    fifo.runtime.dispatchEvent({ kind: 'activate', controlId: 'queued' })
    await vi.waitFor(() => expect(discrete).toHaveBeenCalledOnce())
    setEditorProviders(fifo.ctx, providerBinding('blue.default', [fifoProvider], 2))
    gate.resolve(success())
    await Promise.resolve()
    await Promise.resolve()
    expect(discrete).toHaveBeenCalledOnce()
    fifo.runtime.dispose()
  })

  it('contains provider timeout, rejection, failed result, stale shell, and absent callback paths', async () => {
    const absent = { id: 'absent', render: () => shell('absent') } satisfies BlueEditorProvider
    const noCallback = fixture({ desiredId: absent.id, providers: [absent] })
    noCallback.runtime.render(40)
    noCallback.runtime.dispatchEvent({ kind: 'dismiss' })
    noCallback.runtime.dispose()

    const failed: BlueEditorProvider = {
      id: 'failed',
      render: () => shell('failed'),
      onEvent: async event => {
        if (event.kind === 'dismiss') throw new Error('provider rejected')
        return { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'provider refused' }
      },
    }
    const outcomes = fixture({ desiredId: failed.id, providers: [failed] })
    outcomes.runtime.render(40)
    outcomes.runtime.dispatchEvent({ kind: 'dismiss' })
    outcomes.runtime.dispatchEvent({ kind: 'activate', controlId: 'bad' })
    await vi.waitFor(() => {
      expect(outcomes.notices).toContain('provider rejected')
      expect(outcomes.notices).toContain('provider refused')
    })

    type ProviderInternals = {
      readonly shell: { readonly provider?: unknown }
      dispatchProviderEvent(provider: unknown, event: BlueUiEvent): void
    }
    const internals = outcomes.runtime as unknown as ProviderInternals
    const stale = internals.shell.provider!
    setEditorProviders(outcomes.ctx, providerBinding('blue.default', [failed], 2))
    internals.dispatchProviderEvent(stale, { kind: 'dismiss' })
    outcomes.runtime.dispose()

    vi.useFakeTimers()
    const timeoutProvider: BlueEditorProvider = {
      id: 'timeout',
      render: () => shell('timeout'),
      onEvent: () => new Promise<BlueResult>(() => {}),
    }
    const timeout = fixture({ desiredId: timeoutProvider.id, providers: [timeoutProvider] })
    timeout.runtime.render(40)
    timeout.runtime.dispatchEvent({ kind: 'dismiss' })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(timeout.notices).toContain('editor provider action timed out')
    timeout.runtime.dispose()
  })

  it('contains notice failures in change and FIFO rejection tails', async () => {
    const provider: BlueEditorProvider = {
      id: 'notice',
      render: () => shell('notice'),
      onEvent: async () => ({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'rejected' }),
    }
    const value = fixture({
      desiredId: provider.id,
      providers: [provider],
      onNotice: () => { throw new Error('notice failed') },
    })
    value.runtime.render(40)
    value.runtime.dispatchEvent({ kind: 'value-change', controlId: 'field', value: 'x' })
    await vi.waitFor(() => expect(value.notices.length).toBeGreaterThanOrEqual(2))
    value.runtime.dispatchEvent({ kind: 'dismiss' })
    await vi.waitFor(() => expect(value.notices.length).toBeGreaterThanOrEqual(4))
    value.runtime.dispose()
  })

  it('contains reentrant rejection tails after latest-wins abort and FIFO chaining', async () => {
    const provider: BlueEditorProvider = {
      id: 'reentrant-notice',
      render: () => shell('reentrant notice'),
      onEvent: async () => ({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'rejected' }),
    }
    let latest!: ReturnType<typeof fixture>
    let reenterLatest = true
    latest = fixture({
      desiredId: provider.id,
      providers: [provider],
      onNotice: () => {
        if (reenterLatest) {
          reenterLatest = false
          latest.runtime.dispatchEvent({ kind: 'value-change', controlId: 'field', value: 'newer' })
        }
        throw new Error('notice failed')
      },
    })
    latest.runtime.render(40)
    latest.runtime.dispatchEvent({ kind: 'value-change', controlId: 'field', value: 'first' })
    await vi.waitFor(() => expect(latest.notices.length).toBeGreaterThanOrEqual(3))
    latest.runtime.dispose()

    let fifo!: ReturnType<typeof fixture>
    let reenterFifo = true
    const calls = vi.fn(provider.onEvent)
    const fifoProvider = { ...provider, id: 'fifo-notice', onEvent: calls } satisfies BlueEditorProvider
    fifo = fixture({
      desiredId: fifoProvider.id,
      providers: [fifoProvider],
      onNotice: () => {
        if (reenterFifo) {
          reenterFifo = false
          fifo.runtime.dispatchEvent({ kind: 'dismiss' })
        }
        throw new Error('notice failed')
      },
    })
    fifo.runtime.render(40)
    fifo.runtime.dispatchEvent({ kind: 'dismiss' })
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(2))
    fifo.runtime.dispose()
  })

  it('returns no completion work for an already-aborted request', async () => {
    const value = fixture({
      extensions: [{ id: 'completion', completeV2: async () => ({ ok: true, value: [] }) }],
    })
    value.ctx.blueEditorHost.registerAutocompleteSource('aborted', {
      getSuggestions: async () => ({ prefix: '', items: [] }),
      applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
    })
    const controller = new AbortController()
    controller.abort()
    await expect(value.editor.autocompleteProvider?.getSuggestions(
      [],
      0,
      1,
      { signal: controller.signal },
    )).resolves.toBeNull()
    value.runtime.dispose()
  })

  it('keeps a missing desired id configured, resets on session switch, and unloads to default', () => {
    const provider = { id: 'active', render: () => shell('active') } satisfies BlueEditorProvider
    const value = fixture({ desiredId: provider.id, providers: [provider] })
    expect(value.runtime.render(30).join('\n')).toContain('active')
    setEditorProviders(value.ctx, providerBinding('missing', [provider], 2))
    expect(value.runtime.render(30).join('\n')).toContain('active')
    expect(value.runtime.providerStatus.desiredId).toBe('missing')

    value.runtime.updateSession({ id: 'other', cwd: '/', status: 'idle', mode: 'normal' })
    expect(value.runtime.render(30).join('\n')).not.toContain('active')
    setEditorProviders(value.ctx, undefined)
    expect(value.runtime.providerStatus).toMatchObject({ desiredId: 'blue.default', activeId: 'blue.default' })
    value.runtime.dispose()
  })
})
