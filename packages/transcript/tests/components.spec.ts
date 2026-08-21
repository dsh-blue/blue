/**
 * The transcript components: rendering against identity colors and the fake
 * `BlueComponents` factory, width discipline, caching/invalidation, and
 * mutable streaming state. Width guards measure with the fake's
 * `visibleWidth` (codepoint count, SGR-stripped) so assertions match the
 * deterministic fake wrap/truncate behavior, not pi-tui's.
 */

import { describe, expect, it } from 'vitest'
import type { BlueComponents, BlueSemanticColors } from '@dsh-blue/blue-core'
import {
  AssistantMessageComponent,
  ErrorMessageComponent,
  InterruptedMarkerComponent,
  StepSummaryComponent,
  ToolCallComponent,
  UserMessageComponent,
} from '../src/components.ts'
import type {
  TranscriptAssistantItem,
  TranscriptErrorItem,
  TranscriptStepSummaryItem,
  TranscriptToolItem,
  TranscriptUserItem,
} from '../src/types.ts'
import { fakeBlueComponents } from './helpers.ts'

/** Identity colors: assertions see structure, not escape codes. */
const id = (text: string): string => text
const COLORS = {
  text: id, textStrong: id, muted: id, textMuted: id, accent: id, primary: id, border: id,
  borderFocus: id,
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
    textMuted: tag('T'),
    primary: tag('P'),
    roleUser: tag('R'),
    border: tag('B'),
    success: tag('S'),
    error: tag('E'),
    warning: tag('W'),
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
  return { kind: 'assistant', seq: 1, text: '', ...partial }
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
    // The bullet and text carry the bold roleUser wrap; loaded images sit
    // under the text, indented to the bullet's visible width.
    expect(lines).toEqual([
      '',
      '\x1b[1m[R]✨ [/R]\x1b[22m\x1b[1m[R]pics[/R]\x1b[22m',
      '  <image 1B>',
      '  <image 1B>',
    ])
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
  it('renders the kimi user chrome: bold roleUser bullet and full bold text', () => {
    const lines = new UserMessageComponent(userItem('hello world'), tagged(), setup()).render(80)
    expect(lines).toEqual([
      '',
      '\x1b[1m[R]✨ [/R]\x1b[22m\x1b[1m[R]hello world[/R]\x1b[22m',
    ])
  })

  it('aligns continuation lines to the bullet\'s visible width', () => {
    const components = setup()
    const lines = new UserMessageComponent(userItem('aaa bbb ccc'), COLORS, components).render(6)
    expect(lines).toEqual([
      '',
      '\x1b[1m✨ \x1b[22m\x1b[1maaa\x1b[22m',
      '  \x1b[1mbbb\x1b[22m',
      '  \x1b[1mccc\x1b[22m',
    ])
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
  it('renders markdown text behind the bullet with a leading separator', () => {
    const lines = new AssistantMessageComponent(assistantItem({ text: '**hi**' }), COLORS, setup()).render(80)
    expect(lines).toEqual(['', '● **hi**'])
  })

  it('renders only the body — the step\'s reasoning lives in its own component', () => {
    const lines = new AssistantMessageComponent(
      assistantItem({ text: 'answer' }),
      tagged(),
      setup(),
    ).render(80)
    expect(lines).toEqual(['', '● answer'])
  })

  it('renders growing text bare — the streaming cursor retired (kimi parity)', () => {
    const item = assistantItem({ text: 'partial' })
    const component = new AssistantMessageComponent(item, tagged(), setup())
    expect(component.render(80)).toEqual(['', '● partial'])
    item.text = 'partial, still growing'
    expect(component.render(80)).toEqual(['', '● partial, still growing'])
  })

  it('indents continuation lines under the bullet (kimi MESSAGE_INDENT)', () => {
    const components = setup()
    const lines = new AssistantMessageComponent(assistantItem({ text: 'aaa bbb ccc' }), COLORS, components).render(6)
    expect(lines).toEqual(['', '● aaa', '  bbb', '  ccc'])
    for (const line of lines) expect(components.visibleWidth(line)).toBeLessThanOrEqual(6)
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

  it('renders a full-width content row without reserving a cursor column', () => {
    const components = setup()
    // The markdown renders at the content width (viewport minus the
    // bullet): the regression guard for the removed truncation branch —
    // every row must still satisfy pi-tui's render guard.
    const item = assistantItem({ text: 'x'.repeat(12) })
    const lines = new AssistantMessageComponent(item, COLORS, components).render(12)
    expect(lines).toEqual(['', '● xxxxxxxxxx', '  xx'])
    for (const line of lines) expect(components.visibleWidth(line)).toBeLessThanOrEqual(12)
  })
})

describe('ToolCallComponent', () => {
  it('renders a pending call with the solid text bullet and Using verb', () => {
    const lines = new ToolCallComponent(toolItem({ name: 'probe' }), tagged(), setup()).render(80)
    expect(lines).toEqual(['', '● Using \x1b[1m[P]probe[/P]\x1b[22m'])
  })

  it('gives bash the kimi pure label — the command belongs to the body', () => {
    const pending = new ToolCallComponent(toolItem(), tagged(), setup()).render(80)
    expect(pending).toEqual(['', '● \x1b[1m[P]Running a command[/P]\x1b[22m'])

    const item = toolItem()
    item.result = { text: 'ran ok', isError: false }
    const finished = new ToolCallComponent(item, tagged(), setup()).render(80)
    expect(finished[1]).toContain('[S]✓ [/S]\x1b[1m[P]Ran a command[/P]\x1b[22m')
  })

  it('renders a success result with the ✓ mark, lines chip, and preview', () => {
    const item = toolItem({ name: 'probe' })
    item.result = { text: 'ok done', isError: false }
    const lines = new ToolCallComponent(item, tagged(), setup()).render(80)
    expect(lines).toEqual([
      '',
      '[S]✓ [/S]Used \x1b[1m[P]probe[/P]\x1b[22m[M] · 1 line[/M]',
      '  [M]ok done[/M]',
    ])
  })

  it('renders an error result in error colors', () => {
    const item = toolItem({ name: 'probe' })
    item.result = { text: 'nope', isError: true }
    const lines = new ToolCallComponent(item, tagged(), setup()).render(80)
    expect(lines[1]).toContain('[E]✗ [/E]')
    expect(lines[1]).toContain('[E] · 1 line[/E]')
    expect(lines[2]).toBe('  [E]nope[/E]')
  })

  it('presents a declined plan review in the warning tone, not the error state', () => {
    // dsh-plan-mode answers a rejection by failing exit_plan_mode — a
    // user decision, not a tool failure (the S24b round-3 ruling).
    const item = toolItem({ name: 'exit_plan_mode' })
    item.result = { text: 'The user chose to keep planning; their feedback: mojap', isError: true }
    const lines = new ToolCallComponent(item, tagged(), setup()).render(100)
    expect(lines[1]).toContain('[W]◐ [/W]Used \x1b[1m[P]exit_plan_mode[/P]\x1b[22m')
    expect(lines[1]).toContain('[W] · plan declined[/W]')
    expect(lines[1]).not.toContain('✗')
    expect(lines[2]).toBe('  [W]The user chose to keep planning; their feedback: mojap[/W]')
    // The approve path stays the plain success card.
    const approved = toolItem({ name: 'exit_plan_mode' })
    approved.result = { text: 'Plan approved — plan mode exited', isError: false }
    const ok = new ToolCallComponent(approved, tagged(), setup()).render(100)
    expect(ok[1]).toContain('[S]✓ [/S]')
    // Other tools failing still render the error state.
    const other = toolItem({ name: 'probe' })
    other.result = { text: 'nope', isError: true }
    expect(new ToolCallComponent(other, tagged(), setup()).render(80)[1]).toContain('[E]✗ [/E]')
  })

  it('picks the key argument — whitelist first, then the first short arg', () => {
    const whitelisted = toolItem({
      name: 'probe',
      parsedArguments: { verbose: true, file_path: 'src/main.ts' },
    })
    const lines = new ToolCallComponent(whitelisted, tagged(), setup()).render(80)
    expect(lines[1]).toContain('[M] (src/main.ts)[/M]')

    // No whitelist key: the first short string argument steps in; a long
    // first argument is skipped in favour of a later short one.
    const fallback = toolItem({
      name: 'probe',
      parsedArguments: { blob: 'y'.repeat(100), note: 'short note' },
    })
    expect(new ToolCallComponent(fallback, tagged(), setup()).render(80)[1])
      .toContain('[M] (short note)[/M]')

    // Nothing stringly: no parentheses at all.
    const none = toolItem({ name: 'probe', parsedArguments: { n: 1, ok: true } })
    expect(new ToolCallComponent(none, tagged(), setup()).render(80)[1])
      .toBe('● Using \x1b[1m[P]probe[/P]\x1b[22m')
  })

  it('ellipsizes a long key argument to one line', () => {
    const item = toolItem({
      name: 'probe',
      parsedArguments: { file_path: `src/${'x'.repeat(100)}.ts` },
    })
    const components = setup()
    const lines = new ToolCallComponent(item, COLORS, components).render(80)
    // The bold SGR inflates the raw string length; measure the visible width.
    expect(components.visibleWidth(lines[1]!)).toBeLessThan(80)
    expect(lines[1]).toContain('…')
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

  it('caps the collapsed preview at three visual rows with the kimi hint', () => {
    const item = toolItem({ name: 'probe' })
    item.result = { text: 'line one', fullText: Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n'), isError: false }
    const component = new ToolCallComponent(item, tagged(), setup())
    const collapsed = component.render(80)
    expect(collapsed.slice(2)).toEqual([
      '  [M]line 1[/M]',
      '  [M]line 2[/M]',
      '  [M]line 3[/M]',
      '[T]... (7 more lines, 10 total, ctrl+o to expand)[/T]',
    ])

    component.setExpanded(true)
    const expanded = component.render(80)
    expect(expanded).not.toEqual(collapsed)
    expect(expanded).toHaveLength(1 + 1 + 10)
    expect(expanded[11]).toBe('  [M]line 10[/M]')

    component.setExpanded(false)
    expect(component.render(80)).toEqual(collapsed)
  })

  it('counts wrapped visual rows for the preview cap and hint', () => {
    const item = toolItem({ name: 'probe' })
    item.result = { text: 'word', fullText: 'word '.repeat(30).trim(), isError: false }
    // At width 20 the single long line wraps past the 3-row cap; the hint
    // counts the wrapped rows, not the raw line count.
    const components = setup()
    const lines = new ToolCallComponent(item, COLORS, components).render(20)
    // The hint truncates at this narrow width, but its signature survives.
    expect(lines.at(-1)).toContain('more lines')
    for (const line of lines) expect(components.visibleWidth(line)).toBeLessThanOrEqual(20)
  })

  it('falls back to the text when an expanded result has no fullText', () => {
    const item = toolItem({ name: 'probe' })
    item.result = { text: 'only summary', isError: false }
    const component = new ToolCallComponent(item, tagged(), setup())
    component.setExpanded(true)
    expect(component.render(80)[2]).toBe('  [M]only summary[/M]')
  })

  it('suppresses the chip and the body for an empty result', () => {
    const item = toolItem({ name: 'probe' })
    item.result = { text: '', isError: false }
    const lines = new ToolCallComponent(item, tagged(), setup()).render(80)
    expect(lines).toEqual(['', '[S]✓ [/S]Used \x1b[1m[P]probe[/P]\x1b[22m'])
  })

  it('collapses a Read card to its header until expanded (kimi)', () => {
    const item = toolItem({
      name: 'read',
      view: { card: 'read', path: 'x', offset: 1, lines: [], totalLines: 0 },
    })
    item.result = { text: 'l1', fullText: 'l1\nl2\nl3', isError: false }
    const component = new ToolCallComponent(item, tagged(), setup())
    // The kimi Read card: header + lines chip only — the file content
    // stays hidden behind Ctrl-O.
    expect(component.render(80)).toEqual([
      '',
      '[S]✓ [/S]Used \x1b[1m[P]read[/P]\x1b[22m[M] · 3 lines[/M]',
    ])
    component.setExpanded(true)
    expect(component.render(80)).toHaveLength(1 + 1 + 3)
  })

  it('surfaces the bash command in the body behind the kimi shell chrome', () => {
    const item = toolItem({ parsedArguments: { command: 'ls\ncd /tmp' } })
    const lines = new ToolCallComponent(item, tagged(), setup()).render(80)
    expect(lines).toEqual([
      '',
      '● \x1b[1m[P]Running a command[/P]\x1b[22m',
      '  $ [M]ls[/M]',
      '    [M]cd /tmp[/M]',
    ])
  })

  it('truncates an over-wide bash command row to the viewport — the #15 family', () => {
    // A real run crashed pi-tui's width guard on an 186-column grep pipeline
    // (168-column terminal): the composed `$ command` row reached the
    // renderer untruncated. Both the first row and continuations truncate.
    const command = Array.from({ length: 24 }, () => 'very-long-segment').join(' && ')
    const item = toolItem({ parsedArguments: { command: `${command}\n${command}` } })
    const components = setup()
    const rendered = new ToolCallComponent(item, COLORS, components).render(60)
    for (const row of rendered.slice(2)) {
      expect(components.visibleWidth(row)).toBeLessThanOrEqual(60)
    }
    expect(rendered[2]).toContain('...')
  })

  it('caps the collapsed bash command preview and uncaps expanded', () => {
    const item = toolItem({
      parsedArguments: { command: Array.from({ length: 12 }, (_, n) => `c${n}`).join('\n') },
    })
    const component = new ToolCallComponent(item, COLORS, setup())
    const collapsed = component.render(80)
    expect(collapsed).toHaveLength(1 + 1 + 10)
    component.setExpanded(true)
    expect(component.render(80)).toHaveLength(1 + 1 + 12)
  })

  it('omits the command preview for non-bash and malformed arguments', () => {
    // A non-bash card ignores a command argument entirely.
    const probe = toolItem({ name: 'probe', parsedArguments: { command: 'ls' } })
    expect(new ToolCallComponent(probe, COLORS, setup()).render(80)).toHaveLength(2)

    // Non-object arguments and an empty command yield no preview rows.
    const nonObject = toolItem({ parsedArguments: 'not-an-object' })
    expect(new ToolCallComponent(nonObject, COLORS, setup()).render(80)).toHaveLength(2)
    const empty = toolItem({ parsedArguments: { command: '' } })
    expect(new ToolCallComponent(empty, COLORS, setup()).render(80)).toHaveLength(2)
  })
})

describe('ErrorMessageComponent', () => {
  it('renders the marker, code, and message in error color, wrapped', () => {
    const item: TranscriptErrorItem = { kind: 'error', seq: 9, turn: 3, message: '404: no such route', code: 'PI_AI_ERROR' }
    const component = new ErrorMessageComponent(item, tagged(), setup())
    const rows = component.render(80)
    expect(rows[0]).toBe('[E]✗ request failed (PI_AI_ERROR): 404: no such route[/E]')
    component.invalidate()
  })

  it('renders without a code and wraps long messages', () => {
    const item: TranscriptErrorItem = { kind: 'error', seq: 9, turn: 3, message: 'x'.repeat(120) }
    const rows = new ErrorMessageComponent(item, tagged(), setup()).render(40)
    expect(rows.length).toBeGreaterThan(1)
    expect(rows[0]).toContain('[E]✗ request failed:[/E]')
  })
})

describe('InterruptedMarkerComponent', () => {
  it('renders the single muted tombstone row', () => {
    const component = new InterruptedMarkerComponent(tagged())
    expect(component.render(80)).toEqual(['[E]⏹ interrupted[/E]'])
    component.invalidate()
  })
})

describe('StepSummaryComponent', () => {
  const item: TranscriptStepSummaryItem = {
    kind: 'step-summary', seq: 1, turn: 1, step: 2, toolNames: ['Read', 'Read', 'Edit'], thinking: 0,
  }

  it('renders one muted summary line in the kimi wording — tools only', () => {
    const component = new StepSummaryComponent(item, tagged(), setup())
    const lines = component.render(80)
    expect(lines).toEqual(['[T]… step 2 · call 3 tools[/T]'])
    // Width-cached; invalidate forces a rebuild.
    expect(component.render(80)).toBe(lines)
    component.invalidate()
    expect(component.render(80)).toEqual(lines)
  })

  it('counts folded thinking blocks with kimi\'s unconditional pluralization', () => {
    const withThinking: TranscriptStepSummaryItem = {
      ...item, toolNames: ['Read'], thinking: 1,
    }
    expect(new StepSummaryComponent(withThinking, tagged(), setup()).render(80)).toEqual(
      ['[T]… step 2 · thinking 1 times, call 1 tools[/T]'])

    const thinkingOnly: TranscriptStepSummaryItem = { ...item, toolNames: [], thinking: 1 }
    expect(new StepSummaryComponent(thinkingOnly, tagged(), setup()).render(80)).toEqual(
      ['[T]… step 2 · thinking 1 times[/T]'])
  })
})
