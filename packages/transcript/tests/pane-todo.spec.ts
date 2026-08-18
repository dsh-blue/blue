/**
 * `blue-pane-todo` plugin: the todo-list bottom pane. Covers the zero-row
 * empty render, the last-write-wins snapshot scan with the in-progress
 * expansion default, live `session/event` increments filtered by session,
 * the Ctrl-T toggle, session-change rebinding, and the width rules.
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

  it('reads the latest whole-list snapshot and collapses without in-progress work', async () => {
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
    expect(screen.paneLines()).toEqual(['todos 1/2'])
    await dispose()
  })

  it('expands by default when the snapshot has work in progress', async () => {
    resetSeq()
    const agent = fakeAgent([todoWrite([
      { content: 'done', status: 'completed' },
      { content: 'doing', status: 'in_progress' },
      { content: 'later', status: 'pending' },
    ])])
    const { screen, dispose } = await bootPanePlugin(todo, agent)
    expect(screen.paneLines()).toEqual(['☑ done', '◐ doing', '☐ later'])
    await dispose()
  })

  it('tracks live todo/write increments on the attached session only', async () => {
    resetSeq()
    const agent = fakeAgent([todoWrite([{ content: 'a', status: 'pending' }])])
    const { ctx, screen, dispose } = await bootPanePlugin(todo, agent)
    expect(screen.paneLines()).toEqual(['todos 0/1'])
    const baseline = screen.renderRequests.length

    // Other sessions and other event types are ignored.
    ctx.emit('session/event', fakeAgent([]).session as unknown as Session, todoWrite([{ content: 'x', status: 'pending' }]))
    ctx.emit('session/event', agent.session as unknown as Session, userEvent('not a todo'))
    expect(screen.paneLines()).toEqual(['todos 0/1'])
    expect(screen.renderRequests.length).toBe(baseline)

    ctx.emit('session/event', agent.session as unknown as Session, todoWrite([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ]))
    expect(screen.paneLines()).toEqual(['☑ a', '◐ b'])

    // An identical rewrite changes no signature and requests no redraw.
    const before = screen.renderRequests.length
    ctx.emit('session/event', agent.session as unknown as Session, todoWrite([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ]))
    expect(screen.renderRequests.length).toBe(before)
    await dispose()
  })

  it('toggles the collapse state through the global Ctrl-T action', async () => {
    resetSeq()
    const agent = fakeAgent([todoWrite([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ])])
    const { ctx, screen, keymap, dispose } = await bootPanePlugin(todo, agent)
    expect(keymap.actions.map(action => action.id)).toEqual([todo.ACTION_TOGGLE_TODO])
    expect(keymap.actions[0]!.keys).toBe('ctrl+t')
    expect(screen.paneLines()).toEqual(['☑ a', '◐ b'])

    keymap.handler(todo.ACTION_TOGGLE_TODO)()
    expect(screen.renderRequests.at(-1)).toBe(true)
    expect(screen.paneLines()).toEqual(['todos 1/2'])

    keymap.handler(todo.ACTION_TOGGLE_TODO)()
    expect(screen.paneLines()).toEqual(['☑ a', '◐ b'])

    // The next write re-derives the default over the manual choice.
    ctx.emit('session/event', agent.session as unknown as Session, todoWrite([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'completed' },
    ]))
    expect(screen.paneLines()).toEqual(['todos 2/2'])

    await dispose()
    expect(keymap.actions).toHaveLength(0)
  })

  it('toggles even with an empty list, rendering nothing', async () => {
    const { screen, keymap, dispose } = await bootPanePlugin(todo)
    keymap.handler(todo.ACTION_TOGGLE_TODO)()
    expect(screen.renderRequests.at(-1)).toBe(true)
    expect(screen.paneLines()).toEqual([])
    await dispose()
  })

  it('re-attaches on blue/session-changed and drops the stale subscription', async () => {
    resetSeq()
    const first = fakeAgent([todoWrite([{ content: 'first', status: 'pending' }])])
    const { ctx, screen, dispose } = await bootPanePlugin(todo, first)
    expect(screen.paneLines()).toEqual(['todos 0/1'])

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
    expect(screen.paneLines()).toEqual(['◐ now'])
    await dispose()
  })

  it('truncates entries to the width budget and hides below the minimum', async () => {
    resetSeq()
    const agent = fakeAgent([todoWrite([{ content: 'a very long todo line', status: 'in_progress' }])])
    const { screen, dispose } = await bootPanePlugin(todo, agent)
    const pane = screen.bottomChildren[0]!
    expect(pane.render(10)).toEqual(['◐ a ver...'])
    expect(pane.render(3)).toEqual([])
    pane.invalidate()
    expect(pane.render(10)).toEqual(['◐ a ver...'])
    await dispose()
  })

  it('truncates the collapsed summary to the width budget', async () => {
    resetSeq()
    const agent = fakeAgent([todoWrite([{ content: 'a', status: 'pending' }])])
    const { screen, dispose } = await bootPanePlugin(todo, agent)
    expect(screen.bottomChildren[0]!.render(5)).toEqual(['to...'])
    await dispose()
  })
})
