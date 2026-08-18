/**
 * The transcript components: rendering against identity colors and the fake
 * `BlueComponents` factory, width discipline, caching/invalidation, and
 * mutable streaming state. Width guards measure with the fake's
 * `visibleWidth` (codepoint count, SGR-stripped) so assertions match the
 * deterministic fake wrap/truncate behavior, not pi-tui's.
 */

import { describe, expect, it } from 'vitest'
import type { BlueComponents, BlueSemanticColors } from '@deepseek-ai/dsh-blue-core'
import {
  AssistantMessageComponent,
  StepSummaryComponent,
  ToolCallComponent,
  UserMessageComponent,
} from '../src/components.ts'
import type {
  TranscriptAssistantItem,
  TranscriptStepSummaryItem,
  TranscriptToolItem,
  TranscriptUserItem,
} from '../src/types.ts'
import { fakeBlueComponents } from './helpers.ts'

/** Identity colors: assertions see structure, not escape codes. */
const id = (text: string): string => text
const COLORS = {
  text: id, textStrong: id, muted: id, accent: id, border: id, borderFocus: id,
  success: id, error: id, warning: id, selectedBg: id, roleUser: id, shellMode: id,
  mdHeading: id, mdLink: id, mdLinkUrl: id, mdCode: id, mdCodeBlock: id,
  mdCodeBlockBorder: id, mdQuote: id, mdQuoteBorder: id, mdHr: id, mdListBullet: id,
  diffAdded: id, diffRemoved: id, diffAddedStrong: id, diffRemovedStrong: id,
  diffGutter: id, diffMeta: id,
}
// Structurally satisfies BlueSemanticColors; declared where consumed.

/** Tagged colors for role assertions. */
function tagged(): BlueSemanticColors {
  const tag = (letter: string) => (text: string): string => `[${letter}]${text}[/${letter}]`
  return {
    ...COLORS,
    accent: tag('A'),
    muted: tag('M'),
    border: tag('B'),
    success: tag('S'),
    error: tag('E'),
  }
}

/** One shared fake factory; stateless across components. */
function setup(): BlueComponents {
  return fakeBlueComponents()
}

function userItem(text: string): TranscriptUserItem {
  return { kind: 'user', seq: 1, text }
}

function assistantItem(partial: Partial<TranscriptAssistantItem> = {}): TranscriptAssistantItem {
  return { kind: 'assistant', seq: 1, text: '', reasoning: '', streaming: false, ...partial }
}

function toolItem(partial: Partial<TranscriptToolItem> = {}): TranscriptToolItem {
  return { kind: 'tool', seq: 1, callId: 'c1', name: 'bash', arguments: '{}', ...partial }
}

describe('UserMessageComponent', () => {
  it('loads images on first render and keeps placeholders on failure', async () => {
    const calls: string[] = []
    const loaders: ((data?: Uint8Array) => void)[] = []
    const component = new UserMessageComponent(
      { kind: 'user', seq: 1, text: 'pics', images: [
        { id: 'a', mediaType: 'image/png', name: 'shot.png' } as never,
        { id: 'b', mediaType: 'image/png' } as never,
      ] },
      tagged(),
      setup(),
      {
        loadImage: (ref) => new Promise(resolve => {
          calls.push((ref as { id: string }).id)
          loaders.push(resolve)
        }),
        onReady: () => {},
      },
    )
    // First render kicks both loads; both stay placeholders.
    let lines = component.render(80)
    expect(calls).toEqual(['a', 'b'])
    expect(lines.filter(line => line.includes('[image]'))).toHaveLength(2)
    // Named and unnamed refs both reach the fake createImage (filename
    // spread only when the ref names one).
    loaders[0]?.(new Uint8Array([1]))
    loaders[1]?.(new Uint8Array([2]))
    await new Promise(resolve => setTimeout(resolve, 0))
    lines = component.render(80)
    expect(lines).toEqual(['', '[A]❯[/A] pics', '<image 1B>', '<image 1B>'])
    // A rejected load keeps the placeholder.
    const failing = new UserMessageComponent(
      { kind: 'user', seq: 2, text: 'x', images: [{ id: 'c' } as never] },
      tagged(),
      setup(),
      { loadImage: () => Promise.reject(new Error('gone')) },
    )
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(failing.render(80).some(line => line.includes('[image]'))).toBe(true)
  })
  it('renders an accent gutter, wrapped text, and a leading separator', () => {
    const lines = new UserMessageComponent(userItem('hello world'), tagged(), setup()).render(80)
    expect(lines).toEqual(['', '[A]❯[/A] hello world'])
  })

  it('indents continuation lines under the text', () => {
    const components = setup()
    const lines = new UserMessageComponent(userItem('aaa bbb ccc'), COLORS, components).render(6)
    expect(lines).toEqual(['', '❯ aaa', '  bbb', '  ccc'])
    for (const line of lines) expect(components.visibleWidth(line)).toBeLessThanOrEqual(6)
  })

  it('caches by width and rebuilds after invalidate', () => {
    const component = new UserMessageComponent(userItem('x'), COLORS, setup())
    expect(component.render(80)).toBe(component.render(80))
    component.invalidate()
    expect(component.render(80)).not.toBe(component.render(40))
  })
})

describe('AssistantMessageComponent', () => {
  it('renders markdown text with a leading separator', () => {
    const lines = new AssistantMessageComponent(assistantItem({ text: '**hi**' }), COLORS, setup()).render(80)
    expect(lines).toEqual(['', '**hi**'])
  })

  it('renders reasoning muted and italic above the answer', () => {
    const lines = new AssistantMessageComponent(
      assistantItem({ text: 'answer', reasoning: 'thought' }),
      tagged(),
      setup(),
    ).render(80)
    expect(lines).toEqual(['', '\x1b[3m[M]thought[/M]\x1b[23m', '', 'answer'])
  })

  it('shows a streaming cursor that follows the growing text', () => {
    const item = assistantItem({ streaming: true })
    const component = new AssistantMessageComponent(item, tagged(), setup())
    expect(component.render(80)).toEqual(['', '[A]▌[/A]'])
    item.text = 'partial'
    expect(component.render(80)).toEqual(['', 'partial[A]▌[/A]'])
    item.text = 'done'
    item.streaming = false
    expect(component.render(80)).toEqual(['', 'done'])
  })

  it('rebuilds when the item mutates and after invalidate', () => {
    const item = assistantItem({ text: 'a' })
    const component = new AssistantMessageComponent(item, COLORS, setup())
    const first = component.render(80)
    expect(component.render(80)).toBe(first)
    item.text = 'ab'
    expect(component.render(80)).not.toBe(first)
    component.invalidate()
    expect(component.render(80)).not.toBe(first)
  })

  it('respects the viewport width', () => {
    const components = setup()
    const item = assistantItem({ text: 'word '.repeat(20).trim() })
    for (const line of new AssistantMessageComponent(item, COLORS, components).render(12)) {
      expect(components.visibleWidth(line)).toBeLessThanOrEqual(12)
    }
  })

  it('yields one column for the streaming cursor on a full-width last line', () => {
    const components = setup()
    // The last rendered row is exactly `width` columns; appending the cursor
    // naively overflowed the viewport and crashed pi-tui's render guard.
    const item = assistantItem({ text: 'x'.repeat(12), streaming: true })
    const lines = new AssistantMessageComponent(item, COLORS, components).render(12)
    for (const line of lines) expect(components.visibleWidth(line)).toBeLessThanOrEqual(12)
    expect(lines.at(-1)?.endsWith('▌')).toBe(true)
  })
})

describe('ToolCallComponent', () => {
  it('renders a pending call with a muted hollow bullet', () => {
    const lines = new ToolCallComponent(toolItem(), tagged(), setup()).render(80)
    expect(lines).toEqual(['', '[M]○[/M] bash[M]({})[/M]'])
  })

  it('renders a success result with an indented summary', () => {
    const item = toolItem()
    item.result = { text: 'ok done', isError: false }
    const lines = new ToolCallComponent(item, tagged(), setup()).render(80)
    expect(lines).toEqual(['', '[S]●[/S] bash[M]({})[/M]', '  [B]⎿[/B] [M]ok done[/M]'])
  })

  it('renders an error result in error colors', () => {
    const item = toolItem()
    item.result = { text: 'nope', isError: true }
    const lines = new ToolCallComponent(item, tagged(), setup()).render(80)
    expect(lines[1]).toContain('[E]●[/E]')
    expect(lines[2]).toBe('  [B]⎿[/B] [E]nope[/E]')
  })

  it('ellipsizes long arguments and omits empty parentheses', () => {
    const longArgs = toolItem({ arguments: `{"cmd":"${'x'.repeat(100)}","more":true}` })
    const lines = new ToolCallComponent(longArgs, COLORS, setup()).render(80)
    expect(lines[1]!.length).toBeLessThan(80)
    expect(lines[1]).toContain('…')

    const noArgs = new ToolCallComponent(toolItem({ arguments: '' }), tagged(), setup()).render(80)
    expect(noArgs[1]).toBe('[M]○[/M] bash')
  })

  it('truncates the call line to the viewport width', () => {
    const components = setup()
    const item = toolItem({ name: 'a-very-long-tool-name' })
    const lines = new ToolCallComponent(item, COLORS, components).render(10)
    expect(components.visibleWidth(lines[1]!)).toBeLessThanOrEqual(10)
  })

  it('re-renders when the result arrives', () => {
    const item = toolItem()
    const component = new ToolCallComponent(item, COLORS, setup())
    const pending = component.render(80)
    expect(component.render(80)).toBe(pending)
    item.result = { text: 'done', isError: false }
    expect(component.render(80)).not.toBe(pending)
    component.invalidate()
    expect(component.render(80)).not.toBe(pending)
  })

  it('renders the summary collapsed and the full text expanded', () => {
    const item = toolItem()
    item.result = { text: 'line one xxx…', fullText: `line one\n${'x'.repeat(200)}`, isError: false }
    const component = new ToolCallComponent(item, tagged(), setup())
    const collapsed = component.render(80)
    expect(collapsed).toEqual(['', '[S]●[/S] bash[M]({})[/M]', '  [B]⎿[/B] [M]line one xxx…[/M]'])

    component.setExpanded(true)
    const expanded = component.render(80)
    expect(expanded).not.toBe(collapsed)
    expect(expanded[2]).toBe('  [B]⎿[/B] [M]line one[/M]')
    // The 200-x run hard-breaks across the 76-column content width.
    expect(expanded.length).toBeGreaterThan(4)
    expect(expanded.some(line => line.includes('x'.repeat(76)))).toBe(true)

    component.setExpanded(false)
    expect(component.render(80)).toEqual(collapsed)
  })

  it('falls back to the summary when an expanded result has no fullText', () => {
    const item = toolItem()
    item.result = { text: 'only summary', isError: false }
    const component = new ToolCallComponent(item, tagged(), setup())
    component.setExpanded(true)
    expect(component.render(80)[2]).toBe('  [B]⎿[/B] [M]only summary[/M]')
  })
})

describe('StepSummaryComponent', () => {
  const item: TranscriptStepSummaryItem = {
    kind: 'step-summary', seq: 1, turn: 1, step: 2, toolNames: ['Read', 'Read', 'Edit'],
  }

  it('renders one muted summary line counting duplicate tools', () => {
    const component = new StepSummaryComponent(item, tagged(), setup())
    const lines = component.render(80)
    expect(lines).toEqual(['[M]… step 2 · Read ×2, Edit ×1[/M]'])
    // Width-cached; invalidate forces a rebuild.
    expect(component.render(80)).toBe(lines)
    component.invalidate()
    expect(component.render(80)).toEqual(lines)
  })
})
