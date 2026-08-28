/** Canonical status registry, compiler, layout, and containment coverage. */
import { Context } from '@deepseek-ai/cordis'
import type { BlueComponent, BlueComponents } from '@dsh-blue/blue-core'
import type { BlueSessionSnapshot, BlueStatusProvider, BlueStatusSnapshot } from '@dsh-blue/blue-api'
import { describe, expect, it, vi } from 'vitest'
import {
  BLUE_DEFAULT_STATUS_PROVIDER,
  BlueStatusCompositionService,
  BlueStatusEntryService,
  StatusFooterComponent,
  type BlueStatusEntry,
} from '../src/status-model.ts'
import { fakeBlueComponents } from './helpers.ts'
import { COLORS, StatusFakeScreen } from './status-fakes.ts'

function entry(id: string, content: string, options: Partial<BlueStatusEntry> = {}): BlueStatusEntry {
  return { id, node: { kind: 'text', content }, visible: true, ...options }
}

function session(id = 'session', status: BlueSessionSnapshot['status'] = 'idle'): BlueSessionSnapshot {
  return { id, cwd: '/tmp', status, mode: 'normal', model: { id: 'model', provider: 'provider' } }
}

function composition(options: { now?: () => number, components?: BlueComponents } = {}) {
  const ctx = new Context()
  const screen = new StatusFakeScreen()
  const components = options.components ?? fakeBlueComponents()
  const entries = new BlueStatusEntryService(ctx, screen)
  entries.register(entry('default', 'default'))
  const footer = new StatusFooterComponent(entries, components, COLORS)
  const service = new BlueStatusCompositionService(ctx, entries, footer, {
    components,
    colors: COLORS,
    viewport: () => ({ columns: screen.columns, rows: screen.rows }),
    requestRender: () => screen.requestRender(),
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  return { service, entries, screen }
}

function provider(id: string, render: BlueStatusProvider['render']): BlueStatusProvider {
  return { id, render }
}

describe('BlueStatusEntryService', () => {
  it('registers live nodes, orders them, refreshes, and disposes idempotently', () => {
    const screen = new StatusFakeScreen()
    const service = new BlueStatusEntryService(new Context(), screen)
    const invalidate = vi.fn()
    service.attachFooter({ render: () => [], invalidate } satisfies BlueComponent)
    let current: BlueStatusEntry | null = entry('dynamic', 'first', { priority: 2 })
    const dispose = service.register(() => current)
    service.register(entry('same-z', 'z', { priority: 1 }))
    service.register(entry('same-a', 'a', { priority: 1 }))
    expect(service.list().map(model => model.id)).toEqual(['same-a', 'same-z', 'dynamic'])
    expect(() => service.register(entry('dynamic', 'duplicate'))).toThrow(/already registered/)
    current = entry('dynamic', 'second')
    service.refresh('dynamic')
    service.refresh('missing')
    expect(invalidate).toHaveBeenCalledTimes(4)
    current = null
    expect(service.list().map(model => model.id)).toEqual(['same-a', 'same-z'])
    dispose()
    dispose()
    const absent = service.register(() => null)
    absent()
    service.dispose()
    expect(service.list()).toEqual([])
  })

  it('attaches late and contains a throwing source in place', () => {
    const service = new BlueStatusEntryService(new Context())
    let broken = false
    service.register(() => {
      if (broken) throw new Error('failed')
      return entry('source', 'ok', { priority: 4, band: 'right', row: 2, overflow: 'hide' })
    })
    broken = true
    expect(service.list()[0]).toMatchObject({
      id: 'source',
      priority: 4,
      band: 'right',
      row: 2,
      overflow: 'hide',
      visible: true,
    })
    expect(service.list()[0]!.node).toMatchObject({ kind: 'text', tone: 'danger' })
    const screen = new StatusFakeScreen()
    service.attach(screen)
    expect(screen.renderRequests).toHaveLength(1)
  })

})

describe('StatusFooterComponent', () => {
  it('lays out two bands, priorities, right alignment, tones, cache, and overflow', () => {
    const components = fakeBlueComponents()
    const service = new BlueStatusEntryService(new Context())
    service.register(entry('left', 'left', { priority: 0, node: { kind: 'text', content: 'left', tone: 'accent' } }))
    service.register(entry('hidden', 'hidden', { visible: false }))
    service.register(entry('right', 'right', { band: 'right', node: { kind: 'text', content: 'right', tone: 'success' } }))
    service.register(entry('second', 'second', { row: 2, node: { kind: 'text', content: 'second', tone: 'warning' } }))
    service.register(entry('wide', '0123456789', { row: 2, priority: 2, overflow: 'hide' }))
    const footer = new StatusFooterComponent(service, components, COLORS)
    expect(footer.render(14)).toEqual(['left     right', 'second        '])
    expect(footer.render(14)).toBe(footer.render(14))
    footer.invalidate()
    expect(footer.render(4)).toEqual(['left', 's\x1b[0m...\x1b[0m'])
  })

  it('compiles status stacks, right-only rows, and invalid trees safely', () => {
    const service = new BlueStatusEntryService(new Context())
    service.register({
      id: 'stack',
      visible: true,
      band: 'right',
      node: { kind: 'stack', direction: 'row', gap: 1, children: [
        { node: { kind: 'text', content: 'one' } },
        { node: { kind: 'text', content: 'two', tone: 'muted' } },
      ] },
    })
    const footer = new StatusFooterComponent(service, fakeBlueComponents(), COLORS)
    const row = footer.render(12)[0]!
    expect(row).toContain('one')
    expect(row).toContain('two')
    expect(fakeBlueComponents().visibleWidth(row)).toBe(12)

    const invalid = new BlueStatusEntryService(new Context())
    invalid.register(entry('bad', '', { node: { kind: 'actions' } as never }))
    const error = new StatusFooterComponent(invalid, fakeBlueComponents(), COLORS)
    expect(error.render(12)[0]).toContain('Blue UI')
    expect(error.render(0)).toEqual([])
  })

  it('drops empty compiled rows and hides multi-row overflow', () => {
    const service = new BlueStatusEntryService(new Context())
    service.register(entry('empty', ''))
    service.register({
      id: 'empty-stack',
      visible: true,
      node: { kind: 'stack', direction: 'column', children: [] },
    })
    service.register({
      id: 'overflow',
      visible: true,
      overflow: 'hide',
      node: { kind: 'stack', direction: 'column', children: [
        { node: { kind: 'text', content: 'first' } },
        { node: { kind: 'text', content: 'second' } },
      ] },
    })
    const footer = new StatusFooterComponent(service, fakeBlueComponents(), COLORS)
    expect(footer.render(20)).toEqual([])
  })

  it('separates multiple entries in one footer cluster', () => {
    const service = new BlueStatusEntryService(new Context())
    service.register(entry('first', 'first'))
    service.register(entry('second', 'second'))
    const footer = new StatusFooterComponent(service, fakeBlueComponents(), COLORS)
    expect(footer.render(20)).toEqual(['first  second       '])
  })
})

describe('BlueStatusCompositionService', () => {
  it('keeps candidates inert until selection and the first measured render width', () => {
    const { service } = composition()
    const render = vi.fn(() => ({ kind: 'text' as const, content: 'custom' }))
    const selected = provider('custom', render)
    service.updateCandidates([selected], 1)
    service.select('custom')
    expect(render).not.toHaveBeenCalled()
    expect(service.snapshot.activeId).toBe(BLUE_DEFAULT_STATUS_PROVIDER)
    expect(service.render(17)).toEqual(['custom'])
    expect(render).toHaveBeenCalledOnce()
    expect(service.snapshot.activeId).toBe('custom')
    service.select('custom')
    service.updateCandidates([selected], 1)
    expect(render).toHaveBeenCalledOnce()

    const other = provider('other', () => ({ kind: 'text', content: 'other' }))
    service.updateCandidates([selected, other], 2)
    expect(render).toHaveBeenCalledOnce()
    expect(service.snapshot.activeId).toBe('custom')
    service.updateCandidates([other], 3)
    expect(service.snapshot).toMatchObject({
      desiredId: 'custom',
      activeId: BLUE_DEFAULT_STATUS_PROVIDER,
      runtimeFailure: 'status provider "custom" is unavailable',
    })
  })

  it('passes a sanitized, owned, recursively frozen snapshot of visible additive entries', () => {
    const { service, entries } = composition()
    entries.register({ id: 'rich', priority: 1, visible: true, node: { kind: 'rich-text', spans: [{ text: '\x1b[31mred', tone: 'success' }] } })
    entries.register({ id: 'hidden', visible: false, node: { kind: 'text', content: 'secret' } })
    entries.register({ id: 'invalid', priority: 2, visible: true, node: { kind: 'actions' } as never })
    let seen: BlueStatusSnapshot | undefined
    service.updateSession(session('one', 'waiting'))
    service.updateCandidates([provider('inspect', snapshot => {
      seen = snapshot
      return { kind: 'text', content: 'inspect' }
    })], 1)
    service.select('inspect')
    service.render(40)
    expect(seen).toBeDefined()
    expect(seen?.busy).toBe(false)
    expect(seen?.entries.map(item => item.id)).toEqual(['default', 'rich', 'invalid'])
    expect(seen?.entries[1]?.node).toEqual({ kind: 'rich-text', spans: [{ text: 'red', tone: 'success' }] })
    expect(seen?.entries[2]?.node).toEqual({ kind: 'text', content: 'Status invalid rejected', tone: 'danger' })
    expect(Object.isFrozen(seen)).toBe(true)
    expect(Object.isFrozen(seen?.session)).toBe(true)
    expect(Object.isFrozen(seen?.entries)).toBe(true)
    expect(Object.isFrozen(seen?.entries[1]?.node)).toBe(true)
    expect(() => { ;(seen!.session as { cwd: string }).cwd = '/changed' }).toThrow()

    service.updateSession(session('one', 'running'))
    expect(seen?.busy).toBe(true)
  })

  it('copies absent and partial model facts without inventing optional fields', () => {
    const { service } = composition()
    const seen: BlueStatusSnapshot[] = []
    service.updateSession({ id: 'one', cwd: '/tmp', status: 'idle', mode: 'normal' })
    service.updateCandidates([provider('inspect', snapshot => {
      seen.push(snapshot)
      return { kind: 'text', content: 'inspect' }
    })], 1)
    service.select('inspect')
    service.render(20)
    expect(seen.at(-1)?.session).not.toHaveProperty('model')

    service.updateSession({
      id: 'one',
      cwd: '/tmp',
      status: 'idle',
      mode: 'normal',
      model: { id: 'model', effort: 'high' },
    })
    expect(seen.at(-1)?.session?.model).toEqual({ id: 'model', effort: 'high' })
  })

  it('returns to the default for a blank selection and contains provider admission failures', () => {
    const { service } = composition()
    service.updateCandidates([
      provider('custom', () => ({ kind: 'text', content: 'custom' })),
      provider('non-error', () => { throw 'plain failure' }),
      provider('invalid', () => ({ kind: 'actions' } as never)),
    ], 1)
    service.select('custom')
    expect(service.render(20)).toEqual(['custom'])
    service.select(' ')
    expect(service.snapshot).toEqual({
      desiredId: BLUE_DEFAULT_STATUS_PROVIDER,
      activeId: BLUE_DEFAULT_STATUS_PROVIDER,
      breakerOpen: false,
    })

    service.select('non-error')
    expect(service.snapshot.runtimeFailure).toBe('status provider render failed')
    service.select('invalid')
    expect(service.snapshot.runtimeFailure).toMatch(/status node/i)
  })

  it('rejects a contained dry-render failure and normalizes non-finite widths', () => {
    const base = fakeBlueComponents()
    const broken = composition({
      components: {
        ...base,
        wrapText: () => { throw new Error('dry render failed') },
      },
    }).service
    broken.updateCandidates([provider('broken', () => ({ kind: 'rich-text', spans: [{ text: 'broken' }] }))], 1)
    broken.select('broken')
    expect(broken.render(20)[0]).toContain('Blue UI rejected')
    expect(broken.snapshot).toMatchObject({
      activeId: BLUE_DEFAULT_STATUS_PROVIDER,
      runtimeFailure: 'dry render failed',
    })

    const finite = composition().service
    finite.updateCandidates([provider('finite', () => ({ kind: 'text', content: 'finite' }))], 1)
    finite.select('finite')
    const finiteRows = finite.render(Number.NaN)
    expect(finiteRows).toHaveLength(1)
    expect(fakeBlueComponents().visibleWidth(finiteRows[0]!)).toBeLessThanOrEqual(1)
    expect(finite.snapshot).toMatchObject({
      desiredId: 'finite',
      activeId: BLUE_DEFAULT_STATUS_PROVIDER,
      runtimeFailure: 'status provider exceeds its 1-3 row viewport',
    })
  })

  it('rejects zero and overflowing rows and atomically preserves A when B fails', () => {
    const { service } = composition()
    const a = provider('a', () => ({ kind: 'text', content: 'A' }))
    const empty = provider('empty', () => ({ kind: 'stack', direction: 'column', children: [] }))
    const tall = provider('tall', () => ({ kind: 'stack', direction: 'column', children: [
      { node: { kind: 'text', content: '1' } }, { node: { kind: 'text', content: '2' } },
      { node: { kind: 'text', content: '3' } }, { node: { kind: 'text', content: '4' } },
    ] }))
    service.updateCandidates([a, empty, tall], 1)
    service.select('a')
    expect(service.render(20)).toEqual(['A'])
    service.select('empty')
    expect(service.snapshot).toMatchObject({ desiredId: 'empty', activeId: 'a', runtimeFailure: 'status provider must render at least one row' })
    service.select('tall')
    expect(service.snapshot).toMatchObject({ desiredId: 'tall', activeId: 'a', runtimeFailure: 'status provider exceeds its 1-3 row viewport' })

    const fresh = composition().service
    fresh.updateCandidates([empty], 1)
    fresh.select('empty')
    expect(fresh.render(20)).toEqual(['default             '])
    expect(fresh.snapshot.activeId).toBe(BLUE_DEFAULT_STATUS_PROVIDER)
    fresh.select('missing')
    expect(fresh.render(20)).toEqual(['default             '])
    expect(fresh.snapshot).toMatchObject({ desiredId: 'missing', activeId: BLUE_DEFAULT_STATUS_PROVIDER, runtimeFailure: 'status provider "missing" is unavailable' })
  })

  it('drops the old provider before a session switch and fences reentrant stale activation', () => {
    const { service } = composition()
    let fail = false
    const a = provider('a', () => {
      if (fail) throw new Error('new session failed')
      return { kind: 'text', content: 'A' }
    })
    service.updateSession(session('one'))
    service.updateCandidates([a], 1)
    service.select('a')
    expect(service.render(20)).toEqual(['A'])
    fail = true
    service.updateSession(session('two'))
    expect(service.snapshot).toMatchObject({ activeId: BLUE_DEFAULT_STATUS_PROVIDER, runtimeFailure: 'new session failed' })

    const reentrant = composition().service
    const b = provider('b', () => ({ kind: 'text', content: 'B' }))
    const switching = provider('a', () => {
      reentrant.select('b')
      return { kind: 'text', content: 'stale A' }
    })
    reentrant.updateCandidates([switching, b], 1)
    reentrant.select('a')
    expect(reentrant.render(20)).toEqual(['B'])
    expect(reentrant.snapshot.activeId).toBe('b')
  })

  it('opens a timer-free breaker on three failures in 60 seconds and resets only after a successful dry render', () => {
    const timer = vi.spyOn(globalThis, 'setTimeout')
    let now = 0
    let failing = false
    const { service, entries } = composition({ now: () => now })
    const candidate = provider('custom', () => {
      if (failing) throw new Error('runtime failed')
      return { kind: 'text', content: 'custom' }
    })
    service.updateCandidates([candidate], 1)
    service.select('custom')
    service.render(20)
    failing = true
    for (const time of [1, 2]) {
      now = time
      entries.refresh('default')
    }
    expect(service.snapshot).toMatchObject({ activeId: 'custom', breakerOpen: false })
    failing = false
    entries.refresh('default')
    failing = true
    for (const time of [3, 4]) {
      now = time
      entries.refresh('default')
    }
    expect(service.snapshot).toMatchObject({ activeId: 'custom', breakerOpen: false })
    now = 5
    entries.refresh('default')
    expect(service.snapshot).toMatchObject({ activeId: BLUE_DEFAULT_STATUS_PROVIDER, breakerOpen: true, runtimeFailure: 'runtime failed' })
    expect(timer).not.toHaveBeenCalled()
    timer.mockRestore()
  })

  it('atomically retains the active generation when its public provider refresh fails', () => {
    const { service } = composition()
    let failing = false
    const candidate = provider('custom', () => {
      if (failing) throw new Error('refresh failed')
      return { kind: 'text', content: 'known good' }
    })
    service.updateCandidates([candidate], 1)
    service.select('custom')
    expect(service.render(20)).toEqual(['known good'])

    failing = true
    service.updateCandidates([candidate], 2)
    expect(service.snapshot).toMatchObject({ activeId: 'custom', breakerOpen: false, runtimeFailure: 'refresh failed' })
    expect(service.render(20)).toEqual(['known good'])
    expect(service.snapshot.runtimeFailure).toBe('refresh failed')
    service.updateCandidates([candidate], 3)
    expect(service.snapshot.activeId).toBe('custom')
    service.updateCandidates([candidate], 4)
    expect(service.snapshot).toMatchObject({ activeId: BLUE_DEFAULT_STATUS_PROVIDER, breakerOpen: true, runtimeFailure: 'refresh failed' })
  })

  it('counts a never-admitted selected B, keeps its breaker on refresh/session switch, and retries a new generation', () => {
    const { service } = composition()
    const a = provider('a', () => ({ kind: 'text', content: 'A' }))
    const badRender = vi.fn(() => { throw new Error('bad B') })
    const bad = provider('bad', badRender)
    service.updateSession(session('one'))
    service.updateCandidates([a, bad], 1)
    service.select('a')
    expect(service.render(20)).toEqual(['A'])

    service.select('bad')
    expect(service.snapshot).toMatchObject({ desiredId: 'bad', activeId: 'a', breakerOpen: false, runtimeFailure: 'bad B' })
    expect(service.render(20)).toEqual(['A'])
    expect(service.snapshot.runtimeFailure).toBe('bad B')
    service.updateCandidates([a, bad], 2)
    expect(service.snapshot).toMatchObject({ activeId: 'a', breakerOpen: false })
    service.updateCandidates([a, bad], 3)
    expect(service.snapshot).toMatchObject({ desiredId: 'bad', activeId: BLUE_DEFAULT_STATUS_PROVIDER, breakerOpen: true, runtimeFailure: 'bad B' })

    service.updateSession(session('two'))
    expect(service.snapshot).toMatchObject({ desiredId: 'bad', activeId: BLUE_DEFAULT_STATUS_PROVIDER, breakerOpen: true, runtimeFailure: 'bad B' })
    service.updateCandidates([a, bad], 4)
    expect(service.snapshot).toMatchObject({ activeId: BLUE_DEFAULT_STATUS_PROVIDER, breakerOpen: true, runtimeFailure: 'bad B' })
    expect(badRender).toHaveBeenCalledTimes(3)

    service.updateCandidates([a], 5)
    expect(service.snapshot.breakerOpen).toBe(true)
    const replacementRender = vi.fn(() => ({ kind: 'text' as const, content: 'new B' }))
    service.updateCandidates([a, provider('bad', replacementRender)], 6)
    expect(replacementRender).toHaveBeenCalledOnce()
    expect(service.snapshot).toMatchObject({ desiredId: 'bad', activeId: 'bad', breakerOpen: false })
    expect(service.render(20)).toEqual(['new B'])
  })

  it('uses width-safe last-known-good rows for two active runtime failures before default fallback', () => {
    let paintFails = false
    const base = fakeBlueComponents()
    const components: BlueComponents = { ...base, wrapText: (text, width) => {
      if (paintFails) throw new Error('paint failed')
      return base.wrapText(text, width)
    } }
    const { service } = composition({ components })
    service.updateCandidates([provider('custom', () => ({ kind: 'rich-text', spans: [{ text: 'known-good-status' }] }))], 1)
    service.select('custom')
    expect(service.render(20)).toEqual(['known-good-status'])

    paintFails = true
    const first = service.render(8)
    const second = service.render(8)
    expect(first.join('')).toContain('known-go')
    expect(second.join('')).toContain('known-go')
    expect(first.join('')).not.toContain('Blue UI')
    expect(first.every(row => components.visibleWidth(row) <= 8)).toBe(true)
    expect(service.snapshot).toMatchObject({ activeId: 'custom', breakerOpen: false, runtimeFailure: 'paint failed' })
    const fallback = service.render(8)
    expect(fallback.every(row => components.visibleWidth(row) <= 8)).toBe(true)
    expect(service.snapshot).toMatchObject({ activeId: BLUE_DEFAULT_STATUS_PROVIDER, breakerOpen: true })
  })

  it('contains active overflow and responsive zero-row failures behind last-known-good rows', () => {
    const overflow = composition().service
    overflow.updateCandidates([provider('responsive', () => ({
      kind: 'stack',
      direction: 'column',
      children: [
        { node: { kind: 'text', content: 'compact' }, when: { maxWidth: 29 } },
        { node: { kind: 'text', content: 'one' }, when: { minWidth: 30 } },
        { node: { kind: 'text', content: 'two' }, when: { minWidth: 30 } },
        { node: { kind: 'text', content: 'three' }, when: { minWidth: 30 } },
        { node: { kind: 'text', content: 'four' }, when: { minWidth: 30 } },
      ],
    }))], 1)
    overflow.select('responsive')
    expect(overflow.render(20)).toEqual(['compact'])
    expect(overflow.render(40)).toEqual(['compact'])
    expect(overflow.snapshot.runtimeFailure).toBe('status provider exceeds its 1-3 row viewport')

    const empty = composition().service
    empty.updateCandidates([provider('responsive', () => ({
      kind: 'stack',
      direction: 'column',
      children: [{ node: { kind: 'text', content: 'compact' }, when: { maxWidth: 29 } }],
    }))], 1)
    empty.select('responsive')
    expect(empty.render(20)).toEqual(['compact'])
    expect(empty.render(40)).toEqual(['compact'])
    expect(empty.snapshot.runtimeFailure).toBe('status provider must render at least one row')
  })

  it('contains LKG truncation and default-footer helper failures', () => {
    let helpersFail = false
    const base = fakeBlueComponents()
    const components: BlueComponents = {
      ...base,
      wrapText: (text, width) => {
        if (helpersFail) throw new Error('wrap failed')
        return base.wrapText(text, width)
      },
      truncateToWidth: (text, width, ellipsis) => {
        if (helpersFail) throw new Error('truncate failed')
        return base.truncateToWidth(text, width, ellipsis)
      },
    }
    const { service } = composition({ components })
    service.updateCandidates([provider('custom', () => ({ kind: 'rich-text', spans: [{ text: 'known good' }] }))], 1)
    service.select('custom')
    expect(service.render(20)).toEqual(['known good'])

    helpersFail = true
    expect(service.render(8)).toEqual([])
    expect(service.snapshot).toMatchObject({ activeId: 'custom', breakerOpen: false, runtimeFailure: 'wrap failed' })
  })

  it('prunes old failures, handles contained runtime failures, and reloads the desired provider', () => {
    let now = 0
    let paintFails = false
    const base = fakeBlueComponents()
    const components: BlueComponents = { ...base, wrapText: (text, width) => {
      if (paintFails) throw new Error('paint failed')
      return base.wrapText(text, width)
    } }
    const { service, entries } = composition({ now: () => now, components })
    const candidate = provider('custom', () => ({ kind: 'rich-text', spans: [{ text: 'custom' }] }))
    service.updateCandidates([candidate], 4)
    service.select('custom')
    expect(service.render(20)).toEqual(['custom'])
    paintFails = true
    now = 1
    service.render(20)
    now = 60_002
    service.render(20)
    now = 60_003
    service.render(20)
    expect(service.snapshot.activeId).toBe('custom')
    now = 60_004
    service.render(20)
    expect(service.snapshot).toMatchObject({ activeId: BLUE_DEFAULT_STATUS_PROVIDER, breakerOpen: true })

    paintFails = false
    service.detachProviders()
    expect(service.snapshot).toMatchObject({ desiredId: 'custom', activeId: BLUE_DEFAULT_STATUS_PROVIDER, breakerOpen: false })
    service.updateCandidates([candidate], 4)
    expect(service.snapshot.activeId).toBe('custom')
    entries.refresh('default')
    expect(service.render(20)).toEqual(['custom'])
  })

  it('fences an unload triggered inside a candidate callback', () => {
    const { service } = composition()
    service.updateCandidates([provider('dispose', () => {
      service.dispose()
      return { kind: 'text', content: 'late' }
    })], 1)
    service.select('dispose')
    expect(service.render(20)).toEqual(['default             '])
    expect(service.snapshot.activeId).toBe(BLUE_DEFAULT_STATUS_PROVIDER)
    service.dispose()
    expect(service.render(20)).toEqual(['default             '])
  })
})
