/**
 * `blue-pane-todo` plugin: the todo-list bottom pane. Covers the zero-row
 * empty render, the last-write-wins snapshot scan with the folded default,
 * the kimi row selection (`selectVisibleTodos`) and its footer distribution,
 * live `session/event` increments filtered by session, the Ctrl-T
 * expand/collapse toggle with the expansion persisting across writes, the
 * settled-list auto-close, session-change rebinding, and the width rules.
 */

import { describe, expect, it } from 'vitest'
import type { Session, SessionEvent, TodoItem } from '@deepseek-ai/dsh-session'
import * as todo from '../src/pane-todo.ts'
import { event, resetSeq, userEvent } from './helpers.ts'
import { bootPanePlugin } from './pane-fakes.ts'
import { asAgent, fakeAgent } from './status-fakes.ts'

/** A `todo/write` whole-list snapshot event. */
function todoWrite(todos: TodoItem[]): SessionEvent<'todo/write'> {
  return event('todo/write', { todos })
}

/** The pane's flat top rule at the given width (identity border). */
function rule(width = 80): string {
  return '─'.repeat(width)
}

/** The pane's bold `primary` title row (identity colors leave the bold SGR). */
const TITLE = '\x1b[1m  Todo\x1b[22m'

/** One indented content row (identity colors: the marker paints vanish). */
function row(glyph: string, text: string): string {
  return `  ${glyph} ${text}`
}

/** The in-progress marker carries the manual bold SGR through `primary`. */
const IN_PROGRESS = '\x1b[1m●\x1b[22m'

/** Completed content carries the manual strikethrough SGR through `muted`. */
function strike(text: string): string {
  return `\x1b[9m${text}\x1b[29m`
}

/** The folded view's footer (identity colors: the muted paint vanishes). */
function foldFooter(hidden: number, distribution = ''): string {
  return `  … +${hidden} more${distribution.length > 0 ? ` (${distribution})` : ''} · ctrl+t to expand`
}

/** The expanded view's footer. */
function allFooter(total: number): string {
  return `  all ${total} items · ctrl+t to collapse`
}

describe('selectVisibleTodos', () => {
  it('returns every row under the cap with nothing hidden', () => {
    const todos: TodoItem[] = [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ]
    const visible = todo.selectVisibleTodos(todos)
    expect(visible.rows).toEqual(todos)
    expect(visible.hidden).toBe(0)
    expect(visible.hiddenCounts).toEqual({ completed: 0, in_progress: 0, pending: 0 })
  })

  it('folds an all-pending list to the earliest rows', () => {
    const todos = Array.from({ length: 7 }, (_, index): TodoItem => ({ content: `t${index}`, status: 'pending' }))
    const visible = todo.selectVisibleTodos(todos)
    expect(visible.rows.map(rowItem => rowItem.content)).toEqual(['t0', 't1', 't2', 't3', 't4'])
    expect(visible.hidden).toBe(2)
    expect(visible.hiddenCounts).toEqual({ completed: 0, in_progress: 0, pending: 2 })
  })

  it('prioritizes every in-progress item, capped at the row budget', () => {
    const todos: TodoItem[] = [
      { content: 'p0', status: 'pending' },
      { content: 'ip1', status: 'in_progress' },
      { content: 'p2', status: 'pending' },
      { content: 'ip3', status: 'in_progress' },
      { content: 'p4', status: 'pending' },
      { content: 'p5', status: 'pending' },
    ]
    const visible = todo.selectVisibleTodos(todos)
    // Both in-progress rows plus the earliest three pending, original order.
    expect(visible.rows.map(rowItem => rowItem.content)).toEqual(['p0', 'ip1', 'p2', 'ip3', 'p4'])
    expect(visible.hiddenCounts).toEqual({ completed: 0, in_progress: 0, pending: 1 })

    const sixBusy = Array.from({ length: 6 }, (_, index): TodoItem => ({ content: `b${index}`, status: 'in_progress' }))
    const capped = todo.selectVisibleTodos([...sixBusy, { content: 'tail', status: 'pending' }])
    expect(capped.rows.map(rowItem => rowItem.content)).toEqual(['b0', 'b1', 'b2', 'b3', 'b4'])
    expect(capped.hiddenCounts).toEqual({ completed: 0, in_progress: 1, pending: 1 })
  })

  it('reserves one slot for the latest completed beside the earliest pending', () => {
    const todos: TodoItem[] = [
      { content: 'done-1', status: 'completed' },
      { content: 'done-2', status: 'completed' },
      { content: 'done-3', status: 'completed' },
      { content: 'p1', status: 'pending' },
      { content: 'p2', status: 'pending' },
      { content: 'p3', status: 'pending' },
      { content: 'p4', status: 'pending' },
    ]
    const visible = todo.selectVisibleTodos(todos)
    expect(visible.rows.map(rowItem => rowItem.content)).toEqual(['done-3', 'p1', 'p2', 'p3', 'p4'])
    expect(visible.hiddenCounts).toEqual({ completed: 2, in_progress: 0, pending: 0 })
  })

  it('lets the completed side expand when the pending side runs short', () => {
    const todos: TodoItem[] = [
      { content: 'only-next', status: 'pending' },
      ...Array.from({ length: 5 }, (_, index): TodoItem => ({ content: `d${index}`, status: 'completed' })),
    ]
    const visible = todo.selectVisibleTodos(todos)
    // The pending row, then the four most recent completed, original order.
    expect(visible.rows.map(rowItem => rowItem.content)).toEqual(['only-next', 'd1', 'd2', 'd3', 'd4'])
    expect(visible.hidden).toBe(1)
    expect(visible.hiddenCounts).toEqual({ completed: 1, in_progress: 0, pending: 0 })
  })

  it('fills every free slot with completed rows when nothing is pending', () => {
    const todos: TodoItem[] = [
      { content: 'running', status: 'in_progress' },
      ...Array.from({ length: 5 }, (_, index): TodoItem => ({ content: `d${index}`, status: 'completed' })),
    ]
    const visible = todo.selectVisibleTodos(todos)
    // The in-progress row plus the four most recent completed, original order.
    expect(visible.rows.map(rowItem => rowItem.content)).toEqual(['running', 'd1', 'd2', 'd3', 'd4'])
    expect(visible.hidden).toBe(1)
    expect(visible.hiddenCounts).toEqual({ completed: 1, in_progress: 0, pending: 0 })
  })

  it('formats the hidden distribution in the kimi label order, dropping zeros', () => {
    expect(todo.formatHiddenCounts({ completed: 2, in_progress: 1, pending: 0 })).toBe('2 done · 1 in progress')
    expect(todo.formatHiddenCounts({ completed: 0, in_progress: 0, pending: 3 })).toBe('3 pending')
    expect(todo.formatHiddenCounts({ completed: 0, in_progress: 0, pending: 0 })).toBe('')
  })
})

describe('blue-pane-todo', () => {
  it('renders zero rows without a session or without any todo/write', async () => {
    const noSession = await bootPanePlugin(todo)
    expect(todo.name).toBe('blue-pane-todo')
    expect(noSession.screen.bottomChildren).toHaveLength(1)
    expect(noSession.screen.paneLines()).toEqual([])
    await noSession.dispose()
    expect(noSession.screen.bottomChildren).toHaveLength(0)

    resetSeq()
    const noTodos = await bootPanePlugin(todo, fakeAgent([userEvent('hi')]))
    expect(noTodos.screen.paneLines()).toEqual([])
    await noTodos.dispose()
  })

  it('reads the latest whole-list snapshot and shows it folded by default', async () => {
    resetSeq()
    const agent = fakeAgent([
      todoWrite([{ content: 'stale', status: 'in_progress' }]),
      userEvent('hi'),
      todoWrite([
        { content: 'done', status: 'completed' },
        { content: 'later', status: 'pending' },
      ]),
    ])
    const { screen, dispose } = await bootPanePlugin(todo, agent)
    expect(screen.paneLines()).toEqual([rule(80), TITLE, row('✓', strike('done')), row('○', 'later')])
    await dispose()
  })

  it('renders every status marker, completed content struck through', async () => {
    resetSeq()
    const agent = fakeAgent([todoWrite([
      { content: 'done', status: 'completed' },
      { content: 'doing', status: 'in_progress' },
      { content: 'later', status: 'pending' },
    ])])
    const { screen, dispose } = await bootPanePlugin(todo, agent)
    expect(screen.paneLines()).toEqual([rule(80), TITLE, row('✓', strike('done')), row(IN_PROGRESS, 'doing'), row('○', 'later')])
    await dispose()
  })

  it('tracks live todo/write increments on the attached session only', async () => {
    resetSeq()
    const agent = fakeAgent([todoWrite([{ content: 'a', status: 'pending' }])])
    const { ctx, screen, dispose } = await bootPanePlugin(todo, agent)
    expect(screen.paneLines()).toEqual([rule(80), TITLE, row('○', 'a')])
    const baseline = screen.renderRequests.length

    // Other sessions and other event types are ignored.
    ctx.emit('session/event', fakeAgent([]).session as unknown as Session, todoWrite([{ content: 'x', status: 'pending' }]))
    ctx.emit('session/event', agent.session as unknown as Session, userEvent('not a todo'))
    expect(screen.paneLines()).toEqual([rule(80), TITLE, row('○', 'a')])
    expect(screen.renderRequests.length).toBe(baseline)

    ctx.emit('session/event', agent.session as unknown as Session, todoWrite([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ]))
    expect(screen.paneLines()).toEqual([rule(80), TITLE, row('✓', strike('a')), row(IN_PROGRESS, 'b')])

    // An identical rewrite changes no signature and requests no redraw.
    const before = screen.renderRequests.length
    ctx.emit('session/event', agent.session as unknown as Session, todoWrite([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ]))
    expect(screen.renderRequests.length).toBe(before)
    await dispose()
  })

  it('folds a long list by the kimi selection and toggles to the full list with Ctrl-T', async () => {
    resetSeq()
    const seven: TodoItem[] = [
      { content: 'done-1', status: 'completed' },
      { content: 'done-2', status: 'completed' },
      { content: 'done-3', status: 'completed' },
      { content: 'p1', status: 'pending' },
      { content: 'p2', status: 'pending' },
      { content: 'p3', status: 'pending' },
      { content: 'p4', status: 'pending' },
    ]
    const agent = fakeAgent([todoWrite(seven)])
    const { ctx, screen, keymap, dispose } = await bootPanePlugin(todo, agent)
    expect(keymap.actions.map(action => action.id)).toEqual([todo.ACTION_TOGGLE_TODO])
    expect(keymap.actions[0]!.keys).toBe('ctrl+t')
    // The folded default: the latest completed row, the four pending rows,
    // and the footer counting the two hidden completed entries.
    expect(screen.paneLines()).toEqual([
      rule(80),
      TITLE,
      row('✓', strike('done-3')),
      row('○', 'p1'),
      row('○', 'p2'),
      row('○', 'p3'),
      row('○', 'p4'),
      foldFooter(2, '2 done'),
    ])

    keymap.handler(todo.ACTION_TOGGLE_TODO)()
    expect(screen.renderRequests.at(-1)).toBe(true)
    expect(screen.paneLines()).toEqual([
      rule(80),
      TITLE,
      row('✓', strike('done-1')),
      row('✓', strike('done-2')),
      row('✓', strike('done-3')),
      row('○', 'p1'),
      row('○', 'p2'),
      row('○', 'p3'),
      row('○', 'p4'),
      allFooter(7),
    ])

    // The expansion persists across a mid-run write (kimi setTodos
    // semantics): the refreshed list still renders in full.
    ctx.emit('session/event', agent.session as unknown as Session, todoWrite([
      ...seven.slice(0, 6),
      { content: 'p4 now running', status: 'in_progress' },
    ]))
    expect(screen.paneLines()).toEqual([
      rule(80),
      TITLE,
      row('✓', strike('done-1')),
      row('✓', strike('done-2')),
      row('✓', strike('done-3')),
      row('○', 'p1'),
      row('○', 'p2'),
      row('○', 'p3'),
      row(IN_PROGRESS, 'p4 now running'),
      allFooter(7),
    ])

    keymap.handler(todo.ACTION_TOGGLE_TODO)()
    expect(screen.paneLines()).toEqual([
      rule(80),
      TITLE,
      row('✓', strike('done-3')),
      row('○', 'p1'),
      row('○', 'p2'),
      row('○', 'p3'),
      row(IN_PROGRESS, 'p4 now running'),
      foldFooter(2, '2 done'),
    ])
    await dispose()
    expect(keymap.actions).toHaveLength(0)
  })

  it('closes the pane when the list settles and reopens folded on the next write', async () => {
    resetSeq()
    const agent = fakeAgent([todoWrite([{ content: 'a', status: 'in_progress' }])])
    const { ctx, screen, dispose } = await bootPanePlugin(todo, agent)
    expect(screen.paneLines()).toEqual([rule(80), TITLE, row(IN_PROGRESS, 'a')])

    ctx.emit('session/event', agent.session as unknown as Session, todoWrite([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'completed' },
    ]))
    expect(screen.paneLines()).toEqual([])
    expect(screen.renderRequests.length).toBeGreaterThan(0)

    // The next list starts from the folded default (the expansion reset).
    ctx.emit('session/event', agent.session as unknown as Session, todoWrite([{ content: 'c', status: 'pending' }]))
    expect(screen.paneLines()).toEqual([rule(80), TITLE, row('○', 'c')])
    await dispose()
  })

  it('renders nothing for a snapshot that already settled', async () => {
    resetSeq()
    const agent = fakeAgent([todoWrite([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'completed' },
    ])])
    const { screen, dispose } = await bootPanePlugin(todo, agent)
    expect(screen.paneLines()).toEqual([])
    await dispose()
  })

  it('toggles even with an empty list, rendering nothing', async () => {
    const { screen, keymap, dispose } = await bootPanePlugin(todo)
    keymap.handler(todo.ACTION_TOGGLE_TODO)()
    expect(screen.renderRequests.at(-1)).toBe(true)
    expect(screen.paneLines()).toEqual([])
    await dispose()
  })

  it('toggles a short list with no visual difference: no footer either way', async () => {
    resetSeq()
    const agent = fakeAgent([todoWrite([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'pending' },
    ])])
    const { screen, keymap, dispose } = await bootPanePlugin(todo, agent)
    const folded = [rule(80), TITLE, row('✓', strike('a')), row('○', 'b')]
    expect(screen.paneLines()).toEqual(folded)
    keymap.handler(todo.ACTION_TOGGLE_TODO)()
    expect(screen.renderRequests.at(-1)).toBe(true)
    // Under the cap the folded and expanded renders are identical rows —
    // no footer in either state.
    expect(screen.paneLines()).toEqual(folded)
    await dispose()
  })

  it('re-attaches on blue/session-changed and drops the stale subscription', async () => {
    resetSeq()
    const first = fakeAgent([todoWrite([{ content: 'first', status: 'pending' }])])
    const { ctx, screen, dispose } = await bootPanePlugin(todo, first)
    expect(screen.paneLines()).toEqual([rule(80), TITLE, row('○', 'first')])

    resetSeq()
    const second = fakeAgent([userEvent('fresh')])
    ctx.emit('blue/session-changed', asAgent(second))
    expect(screen.paneLines()).toEqual([])

    // The stale subscription to the first session stays inert.
    const baseline = screen.renderRequests.length
    ctx.emit('session/event', first.session as unknown as Session, todoWrite([{ content: 'ghost', status: 'pending' }]))
    expect(screen.paneLines()).toEqual([])
    expect(screen.renderRequests.length).toBe(baseline)

    ctx.emit('session/event', second.session as unknown as Session, todoWrite([{ content: 'now', status: 'in_progress' }]))
    expect(screen.paneLines()).toEqual([rule(80), TITLE, row(IN_PROGRESS, 'now')])
    await dispose()
  })

  it('truncates rows and footers to the width budget and hides below the minimum', async () => {
    resetSeq()
    const long: TodoItem[] = [
      { content: 'a very long todo line', status: 'in_progress' },
      ...Array.from({ length: 5 }, (_, index): TodoItem => ({ content: `fill${index}`, status: 'pending' })),
    ]
    const agent = fakeAgent([todoWrite(long)])
    const { screen, dispose } = await bootPanePlugin(todo, agent)
    const pane = screen.bottomChildren[0]!
    // The framed rows never exceed the viewport (the flat rule, the folded
    // rows, and the footer alike), and a too-narrow viewport renders nothing.
    const narrow = pane.render(10)
    expect(narrow[0]?.startsWith('─')).toBe(true)
    for (const line of narrow) {
      expect(line.replace(/\x1b\[[0-9;]*m/g, '').length).toBeLessThanOrEqual(10)
    }
    expect(narrow.at(-1)?.startsWith('  … +')).toBe(true)
    expect(pane.render(3)).toEqual([])
    pane.invalidate()
    expect(pane.render(10)).toEqual(narrow)
    await dispose()
  })
})
