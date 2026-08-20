/**
 * `blue-intent-diff` plugin: the diff card's rendering (title preference,
 * per-file count lines, colored rows, null-oldText whole-adds, collapsed and
 * expanded caps, multi-file sequence, expansion and caching, width
 * truncation, the defensive non-diff fallback) and the registration contract
 * (effect-bound register/unregister).
 */

import { describe, expect, it } from 'vitest'
import type { FileDiff, ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/intent-diff.ts'
import { DiffCardComponent, DIFF_COLLAPSED_ROWS, DIFF_EXPANDED_ROWS } from '../src/intent-diff.ts'
import type { BlueIntentProps, TranscriptToolItem } from '../src/types.ts'
import { fakeBlueComponents } from './helpers.ts'
import { bootIntentPlugin, COLORS, tagged } from './intent-fakes.ts'

function toolItem(partial: Partial<TranscriptToolItem> = {}): TranscriptToolItem {
  return { kind: 'tool', seq: 1, callId: 'c1', name: 'edit', arguments: '{}', ...partial }
}

function callView(diffs: FileDiff[], title = 'Edit file'): ToolCallView {
  return { card: 'diff', title, diffs }
}

function resultView(diffs: FileDiff[], title?: string): ToolResultView {
  return { card: 'diff', ...(title === undefined ? {} : { title }), diffs }
}

/** Build props with the tagged color table and the fake factory. */
function props(item: TranscriptToolItem, expanded = false): BlueIntentProps {
  return { item, colors: tagged(), components: fakeBlueComponents(), expanded }
}

describe('DiffCardComponent', () => {
  it('renders the pending call view: kimi header, diff rows', () => {
    const item = toolItem({ view: callView([
      { path: 'a.ts', oldText: 'x\ny', newText: 'x\nz' },
    ]) })
    const lines = new DiffCardComponent(props(item)).render(80)
    expect(lines).toEqual([
      '',
      '[T]● [/T]Using \x1b[1m[P]edit[/P]\x1b[22m',
      '[M] x[/M]',
      '[DRS]-[/DRS][DR]y[/DR]',
      '[DAS]+[/DAS][DA]z[/DA]',
    ])
  })

  it('carries the key argument in the header', () => {
    const item = toolItem({
      name: 'write',
      view: callView([{ path: 'new.ts', oldText: null, newText: 'a' }]),
      parsedArguments: { file_path: '/tmp/temp_demo.txt' },
    })
    expect(new DiffCardComponent(props(item)).render(80)[1])
      .toContain('[M] (/tmp/temp_demo.txt)[/M]')
  })

  it('renders the applied hunks with the Edit chip after completion', () => {
    const item = toolItem({
      view: resultView([{ path: 'a.ts', oldText: 'x', newText: 'w' }], 'Edited a.ts'),
    })
    item.result = { text: 'ok', isError: false }
    expect(new DiffCardComponent(props(item)).render(80)).toEqual([
      '',
      '✓ Used \x1b[1m[P]edit[/P]\x1b[22m[M] · +1 -1[/M]',
      '[DRS]-[/DRS][DR]x[/DR]',
      '[DAS]+[/DAS][DA]w[/DA]',
    ])
  })

  it('colors the chip error on a failed result', () => {
    const item = toolItem({ view: resultView([{ path: 'a', oldText: 'x', newText: 'w' }]) })
    item.result = { text: 'bad', isError: true }
    expect(new DiffCardComponent(props(item)).render(80)[1])
      .toContain('[E] · +1 -1[/E]')
  })

  it('suppresses the edit chip when nothing changed', () => {
    const item = toolItem({ view: resultView([{ path: 'a', oldText: 'x', newText: 'x' }]) })
    item.result = { text: 'ok', isError: false }
    const header = new DiffCardComponent(props(item)).render(80)[1]!
    expect(header).not.toContain(' · ')
  })

  it('renders a null oldText create as the kimi numbered file preview', () => {
    const item = toolItem({
      name: 'write',
      view: callView([{ path: 'new.ts', oldText: null, newText: 'a\nb' }]),
    })
    expect(new DiffCardComponent(props(item)).render(80)).toEqual([
      '',
      '[T]● [/T]Using \x1b[1m[P]write[/P]\x1b[22m',
      '  [M]   1  [/M]a',
      '  [M]   2  [/M]b',
    ])
  })

  it('keeps the trailing empty row a final newline produces (kimi shape)', () => {
    const item = toolItem({
      name: 'write',
      view: callView([{ path: 'new.ts', oldText: null, newText: 'a\n' }]),
    })
    expect(new DiffCardComponent(props(item)).render(80)).toEqual([
      '',
      '[T]● [/T]Using \x1b[1m[P]write[/P]\x1b[22m',
      '  [M]   1  [/M]a',
      '  [M]   2  [/M]',
    ])
  })

  it('chips the Write line count after completion, trailing newline ignored', () => {
    const item = toolItem({
      name: 'write',
      view: resultView([{ path: 'new.ts', oldText: null, newText: 'a\nb\n' }]),
    })
    item.result = { text: 'ok', isError: false }
    const header = new DiffCardComponent(props(item)).render(80)[1]!
    expect(header).toContain('✓ Used ')
    expect(header).toContain('[M] · 2 lines[/M]')

    // The singular form for a one-line file.
    const single = toolItem({
      name: 'write',
      view: resultView([{ path: 'new.ts', oldText: null, newText: 'a' }]),
    })
    single.result = { text: 'ok', isError: false }
    expect(new DiffCardComponent(props(single)).render(80)[1])
      .toContain('[M] · 1 line[/M]')
  })

  it('renders nothing for an empty create content', () => {
    const item = toolItem({
      name: 'write',
      view: resultView([{ path: 'new.ts', oldText: null, newText: '' }]),
    })
    item.result = { text: 'ok', isError: false }
    const lines = new DiffCardComponent(props(item)).render(80)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('[M] · 0 lines[/M]')
  })

  it('caps the collapsed create preview at ten rows with the kimi hint', () => {
    const lines = Array.from({ length: 20 }, (_, n) => `l${n}`).join('\n')
    const item = toolItem({ name: 'write', view: callView([{ path: 'a', oldText: null, newText: lines }]) })
    const rendered = new DiffCardComponent(props(item)).render(80)
    // Separator + header + capped rows + hint.
    expect(rendered).toHaveLength(2 + DIFF_COLLAPSED_ROWS + 1)
    expect(rendered.at(-1)).toBe(
      `[TM]... (${20 - DIFF_COLLAPSED_ROWS} more lines, 20 total, ctrl+o to expand)[/TM]`)
  })

  it('uncaps the create preview fully when expanded', () => {
    const lines = Array.from({ length: 230 }, (_, n) => `l${n}`).join('\n')
    const item = toolItem({ name: 'write', view: callView([{ path: 'a', oldText: null, newText: lines }]) })
    const component = new DiffCardComponent(props(item))
    const collapsed = component.render(80)
    component.setExpanded(true)
    const expanded = component.render(80)
    expect(expanded).toHaveLength(2 + 230)
    expect(expanded).not.toEqual(collapsed)
    component.setExpanded(false)
    expect(component.render(80)).toEqual(collapsed)
  })

  it('caps edit diff rows at 200 when expanded', () => {
    const common = Array.from({ length: 200 }, (_, n) => `same ${n}`).join('\n')
    const oldText = `${common}\n${Array.from({ length: 30 }, (_, n) => `o${n}`).join('\n')}`
    const newText = `${common}\n${Array.from({ length: 30 }, (_, n) => `n${n}`).join('\n')}`
    const item = toolItem({ view: resultView([{ path: 'a', oldText, newText }]) })
    item.result = { text: 'ok', isError: false }
    const component = new DiffCardComponent(props(item))
    component.setExpanded(true)
    const expanded = component.render(80)
    // 200 context + 30 removed + 30 added = 260 rows; 200 shown + hint.
    expect(expanded).toHaveLength(2 + DIFF_EXPANDED_ROWS + 1)
    expect(expanded.at(-1)).toBe('[TM]... (60 more lines, 260 total, ctrl+o to expand)[/TM]')
  })

  it('renders every file in sequence, creates numbered and edits diffed', () => {
    const item = toolItem({ view: callView([
      { path: 'one', oldText: null, newText: 'a' },
      { path: 'two', oldText: 'b', newText: 'c' },
    ]) })
    expect(new DiffCardComponent(props(item)).render(80)).toEqual([
      '',
      '[T]● [/T]Using \x1b[1m[P]edit[/P]\x1b[22m',
      '  [M]   1  [/M]a',
      '[DRS]-[/DRS][DR]b[/DR]',
      '[DAS]+[/DAS][DA]c[/DA]',
    ])
  })

  it('respects the expansion state passed at construction', () => {
    const lines = Array.from({ length: 15 }, (_, n) => `l${n}`).join('\n')
    const item = toolItem({ name: 'write', view: callView([{ path: 'a', oldText: null, newText: lines }]) })
    expect(new DiffCardComponent(props(item, true)).render(80)).toHaveLength(2 + 15)
  })

  it('caches by width and expansion and rebuilds on width change', () => {
    const item = toolItem({ view: callView([{ path: 'a', oldText: 'x', newText: 'y' }]) })
    const component = new DiffCardComponent(props(item))
    const first = component.render(80)
    expect(component.render(80)).toBe(first)
    expect(component.render(40)).not.toBe(first)
    component.invalidate()
    expect(component.render(80)).toEqual(first)
  })

  it('truncates long rows to the viewport width', () => {
    const components = fakeBlueComponents()
    const item = toolItem({ view: callView([{ path: 'a', oldText: null, newText: 'x'.repeat(100) }]) })
    // Identity colors: the fake truncate counts every character, tags included.
    const lines = new DiffCardComponent({ item, colors: COLORS, components, expanded: false }).render(12)
    for (const line of lines) expect(components.visibleWidth(line)).toBeLessThanOrEqual(12)
  })

  it('renders the header only when the view is not a diff view', () => {
    const item = toolItem({ view: { card: 'generic', title: 'plain' } })
    expect(new DiffCardComponent(props(item)).render(80)).toEqual([
      '',
      '[T]● [/T]Using \x1b[1m[P]edit[/P]\x1b[22m',
    ])
  })

  it('renders the header only without any view', () => {
    expect(new DiffCardComponent(props(toolItem())).render(80)).toEqual([
      '',
      '[T]● [/T]Using \x1b[1m[P]edit[/P]\x1b[22m',
    ])
  })
})

describe('blue-intent-diff plugin', () => {
  it('registers the diff intent and unregisters on unload', async () => {
    const harness = await bootIntentPlugin(plugin)
    expect(plugin.name).toBe('blue-intent-diff')
    expect(plugin.inject).toEqual(['blueIntents', 'blueTheme', 'blueComponents'])
    expect(harness.entry.intent).toBe('diff')
    const component = harness.entry.create(props(toolItem({ view: callView([]) })))
    expect(component).toBeInstanceOf(DiffCardComponent)
    await harness.dispose()
    expect(harness.registry.entries).toHaveLength(0)
  })
})
