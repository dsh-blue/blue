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
  it('renders the pending call view: title, path counts, colored rows', () => {
    const item = toolItem({ view: callView([
      { path: 'a.ts', oldText: 'x\ny', newText: 'x\nz' },
    ]) })
    const lines = new DiffCardComponent(props(item)).render(80)
    expect(lines).toEqual([
      '[DM]Edit file[/DM]',
      '[DM]a.ts (+1 −1)[/DM]',
      '[M] x[/M]',
      '[DRS]-[/DRS][DR]y[/DR]',
      '[DAS]+[/DAS][DA]z[/DA]',
    ])
  })

  it('prefers the result view title and renders its applied hunks', () => {
    const item = toolItem({
      view: resultView([{ path: 'a.ts', oldText: 'x', newText: 'w' }], 'Edited a.ts'),
    })
    item.result = { text: 'ok', isError: false }
    expect(new DiffCardComponent(props(item)).render(80)).toEqual([
      '[DM]Edited a.ts[/DM]',
      '[DM]a.ts (+1 −1)[/DM]',
      '[DRS]-[/DRS][DR]x[/DR]',
      '[DAS]+[/DAS][DA]w[/DA]',
    ])
  })

  it('falls back to the call title and then the tool name', () => {
    const result = toolItem({ view: resultView([{ path: 'a', oldText: 'x', newText: 'y' }]) })
    result.result = { text: 'ok', isError: false }
    expect(new DiffCardComponent(props(result)).render(80)[0]).toBe('[DM]edit[/DM]')

    const noTitle = toolItem({ view: { card: 'diff', diffs: [] } as ToolCallView })
    expect(new DiffCardComponent(props(noTitle)).render(80)).toEqual(['[DM]edit[/DM]'])
  })

  it('renders a null oldText whole-file as added with additions-only counts', () => {
    const item = toolItem({ view: callView([{ path: 'new.ts', oldText: null, newText: 'a\nb' }]) })
    expect(new DiffCardComponent(props(item)).render(80)).toEqual([
      '[DM]Edit file[/DM]',
      '[DM]new.ts (+2)[/DM]',
      '[DAS]+[/DAS][DA]a[/DA]',
      '[DAS]+[/DAS][DA]b[/DA]',
    ])
  })

  it('drops the phantom row a final newline in a created file produces', () => {
    const item = toolItem({ view: callView([{ path: 'new.ts', oldText: null, newText: 'a\n' }]) })
    expect(new DiffCardComponent(props(item)).render(80)).toEqual([
      '[DM]Edit file[/DM]',
      '[DM]new.ts (+1)[/DM]',
      '[DAS]+[/DAS][DA]a[/DA]',
    ])
  })

  it('caps collapsed rows per file with a meta counter', () => {
    const lines = Array.from({ length: 20 }, (_, n) => `l${n}`).join('\n')
    const item = toolItem({ view: callView([{ path: 'a', oldText: null, newText: lines }]) })
    const rendered = new DiffCardComponent(props(item)).render(80)
    // Header + path + capped rows + counter.
    expect(rendered).toHaveLength(2 + DIFF_COLLAPSED_ROWS + 1)
    expect(rendered.at(-1)).toBe(
      `[TM]... (${20 - DIFF_COLLAPSED_ROWS} more lines, 20 total, ctrl+o to expand)[/TM]`)
  })

  it('raises the cap when expanded and elides past 200 rows', () => {
    const lines = Array.from({ length: 230 }, (_, n) => `l${n}`).join('\n')
    const item = toolItem({ view: callView([{ path: 'a', oldText: null, newText: lines }]) })
    const component = new DiffCardComponent(props(item))
    const collapsed = component.render(80)
    component.setExpanded(true)
    const expanded = component.render(80)
    expect(expanded).toHaveLength(2 + DIFF_EXPANDED_ROWS + 1)
    expect(expanded.at(-1)).toBe(
      `[TM]... (${230 - DIFF_EXPANDED_ROWS} more lines, 230 total, ctrl+o to expand)[/TM]`)
    expect(expanded).not.toEqual(collapsed)
    component.setExpanded(false)
    expect(component.render(80)).toEqual(collapsed)
  })

  it('renders every file in sequence', () => {
    const item = toolItem({ view: callView([
      { path: 'one', oldText: null, newText: 'a' },
      { path: 'two', oldText: 'b', newText: 'c' },
    ]) })
    expect(new DiffCardComponent(props(item)).render(80)).toEqual([
      '[DM]Edit file[/DM]',
      '[DM]one (+1)[/DM]',
      '[DAS]+[/DAS][DA]a[/DA]',
      '[DM]two (+1 −1)[/DM]',
      '[DRS]-[/DRS][DR]b[/DR]',
      '[DAS]+[/DAS][DA]c[/DA]',
    ])
  })

  it('respects the expansion state passed at construction', () => {
    const lines = Array.from({ length: 15 }, (_, n) => `l${n}`).join('\n')
    const item = toolItem({ view: callView([{ path: 'a', oldText: null, newText: lines }]) })
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
    expect(new DiffCardComponent(props(item)).render(80)).toEqual(['[DM]edit[/DM]'])
  })

  it('renders the header only without any view', () => {
    expect(new DiffCardComponent(props(toolItem())).render(80)).toEqual(['[DM]edit[/DM]'])
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
