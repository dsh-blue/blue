/**
 * `blue-intent-terminal` plugin: the terminal card's rendering (description
 * row, cwd line, command line with title preference and exit badge, pending
 * vs completed output caps, expansion and caching, width truncation, the
 * defensive non-terminal fallback) and the registration contract
 * (effect-bound register/unregister).
 */

import { describe, expect, it } from 'vitest'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/intent-terminal.ts'
import {
  TerminalCardComponent,
  TERMINAL_COLLAPSED_ROWS,
  TERMINAL_EXPANDED_ROWS,
} from '../src/intent-terminal.ts'
import type { BlueIntentProps, TranscriptToolItem } from '../src/types.ts'
import { fakeBlueComponents } from './helpers.ts'
import { bootIntentPlugin, COLORS, tagged } from './intent-fakes.ts'

function toolItem(partial: Partial<TranscriptToolItem> = {}): TranscriptToolItem {
  return { kind: 'tool', seq: 1, callId: 'c1', name: 'bash', arguments: '{}', ...partial }
}

function callView(options: { title?: string, description?: string, cwd?: string } = {}): ToolCallView {
  return { card: 'terminal', title: options.title ?? 'ls -la', ...options }
}

function resultView(options: { title?: string, output?: string, exitCode?: number, signal?: string } = {}): ToolResultView {
  return { card: 'terminal', ...options }
}

/** Build props with the tagged color table and the fake factory. */
function props(item: TranscriptToolItem, expanded = false): BlueIntentProps {
  return { item, colors: tagged(), components: fakeBlueComponents(), expanded }
}

describe('TerminalCardComponent', () => {
  it('renders a description row above the card when present', () => {
    const item = toolItem({ view: callView({ description: 'list files' }) })
    expect(new TerminalCardComponent(props(item)).render(80)[0]).toBe('[M]list files[/M]')
  })

  it('omits the description row when absent', () => {
    const item = toolItem({ view: callView() })
    expect(new TerminalCardComponent(props(item)).render(80)[0]).not.toBe('[M]list files[/M]')
  })

  it('renders the cwd line when present and omits it otherwise', () => {
    const withCwd = toolItem({ view: callView({ cwd: '/repo' }) })
    expect(new TerminalCardComponent(props(withCwd)).render(80)[0]).toBe('[DM]/repo[/DM]')
    const without = toolItem({ view: callView() })
    expect(new TerminalCardComponent(props(without)).render(80)[0]).toBe('[A]$[/A] ls -la')
  })

  it('renders the command line from the title, preferring result over call over name', () => {
    const pending = toolItem({ view: callView({ title: 'npm test' }) })
    expect(new TerminalCardComponent(props(pending)).render(80)).toEqual(['[A]$[/A] npm test'])

    const completed = toolItem({ view: resultView({ title: 'npm test' }) })
    completed.result = { text: 'ok', isError: false }
    expect(new TerminalCardComponent(props(completed)).render(80)).toEqual(['[A]$[/A] npm test'])

    const noTitle = toolItem({ view: resultView({}) })
    noTitle.result = { text: 'ok', isError: false }
    expect(new TerminalCardComponent(props(noTitle)).render(80)).toEqual(['[A]$[/A] bash'])
  })

  it('renders completed output as plain text rows, capped when collapsed', () => {
    const output = Array.from({ length: 15 }, (_, n) => `out ${n}`).join('\n')
    const item = toolItem({ view: resultView({ title: 'gen', output }) })
    item.result = { text: 'done', isError: false }
    const rendered = new TerminalCardComponent(props(item)).render(80)
    expect(rendered).toHaveLength(1 + TERMINAL_COLLAPSED_ROWS + 1)
    expect(rendered[1]).toBe('[T]out 0[/T]')
    expect(rendered.at(-1)).toBe(`[TM]… ${15 - TERMINAL_COLLAPSED_ROWS} more lines[/TM]`)
  })

  it('raises the output cap when expanded and elides past 120 rows', () => {
    const output = Array.from({ length: 130 }, (_, n) => `out ${n}`).join('\n')
    const item = toolItem({ view: resultView({ title: 'gen', output }) })
    item.result = { text: 'done', isError: false }
    const component = new TerminalCardComponent(props(item))
    const collapsed = component.render(80)
    component.setExpanded(true)
    const expanded = component.render(80)
    expect(expanded).toHaveLength(1 + TERMINAL_EXPANDED_ROWS + 1)
    expect(expanded.at(-1)).toBe(`[TM]… ${130 - TERMINAL_EXPANDED_ROWS} more lines[/TM]`)
    expect(expanded).not.toEqual(collapsed)
    component.setExpanded(false)
    expect(component.render(80)).toEqual(collapsed)
  })

  it('renders no output rows while pending', () => {
    const item = toolItem({ view: callView() })
    expect(new TerminalCardComponent(props(item)).render(80)).toEqual(['[A]$[/A] ls -la'])
  })

  it('omits output rows when the completed view carries none', () => {
    const item = toolItem({ view: resultView({ title: 'gen' }) })
    item.result = { text: 'done', isError: false }
    expect(new TerminalCardComponent(props(item)).render(80)).toEqual(['[A]$[/A] gen'])
  })

  it('appends an error exit badge for a nonzero exit code', () => {
    const item = toolItem({ view: resultView({ title: 'fail', output: 'boom', exitCode: 2 }) })
    item.result = { text: 'boom', isError: true }
    expect(new TerminalCardComponent(props(item)).render(80)[0]).toBe('[A]$[/A] fail [E]exit 2[/E]')
  })

  it('appends nothing for a zero exit code', () => {
    const item = toolItem({ view: resultView({ title: 'ok', output: 'fine', exitCode: 0 }) })
    item.result = { text: 'fine', isError: false }
    expect(new TerminalCardComponent(props(item)).render(80)[0]).toBe('[A]$[/A] ok')
  })

  it('appends a warning signal badge when a signal killed the run', () => {
    const item = toolItem({ view: resultView({ title: 'kill', output: '', signal: 'SIGTERM' }) })
    item.result = { text: 'killed', isError: true }
    expect(new TerminalCardComponent(props(item)).render(80)[0]).toBe('[A]$[/A] kill [W]SIGTERM[/W]')
  })

  it('skips the badge on a pending call even with exit status present', () => {
    const item = toolItem({ view: resultView({ title: 'x', exitCode: 1 }) })
    expect(new TerminalCardComponent(props(item)).render(80)).toEqual(['[A]$[/A] x'])
  })

  it('respects the expansion state passed at construction', () => {
    const output = Array.from({ length: 12 }, (_, n) => `out ${n}`).join('\n')
    const item = toolItem({ view: resultView({ title: 'gen', output }) })
    item.result = { text: 'done', isError: false }
    expect(new TerminalCardComponent(props(item, true)).render(80)).toHaveLength(1 + 12)
  })

  it('caches by width and expansion and rebuilds on width change', () => {
    const item = toolItem({ view: callView({ description: 'd', cwd: '/w' }) })
    const component = new TerminalCardComponent(props(item))
    const first = component.render(80)
    expect(component.render(80)).toBe(first)
    expect(component.render(40)).not.toBe(first)
    component.invalidate()
    expect(component.render(80)).toEqual(first)
  })

  it('truncates long output rows to the viewport width', () => {
    const components = fakeBlueComponents()
    const item = toolItem({ view: resultView({ title: 'gen', output: 'x'.repeat(100) }) })
    item.result = { text: 'done', isError: false }
    const lines = new TerminalCardComponent({ item, colors: COLORS, components, expanded: false }).render(10)
    for (const line of lines) expect(components.visibleWidth(line)).toBeLessThanOrEqual(10)
  })

  it('renders the title only when the view is not a terminal view', () => {
    const item = toolItem({ view: { card: 'generic', title: 'plain' } })
    expect(new TerminalCardComponent(props(item)).render(80)).toEqual(['[A]$[/A] bash'])
  })

  it('renders the name only without any view', () => {
    expect(new TerminalCardComponent(props(toolItem())).render(80)).toEqual(['[A]$[/A] bash'])
  })
})

describe('blue-intent-terminal plugin', () => {
  it('registers the terminal intent and unregisters on unload', async () => {
    const harness = await bootIntentPlugin(plugin)
    expect(plugin.name).toBe('blue-intent-terminal')
    expect(plugin.inject).toEqual(['blueIntents', 'blueTheme', 'blueComponents'])
    expect(harness.entry.intent).toBe('terminal')
    const component = harness.entry.create(props(toolItem({ view: callView() })))
    expect(component).toBeInstanceOf(TerminalCardComponent)
    await harness.dispose()
    expect(harness.registry.entries).toHaveLength(0)
  })
})
