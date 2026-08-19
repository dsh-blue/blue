/**
 * `ctx.blueComponents` service: delegation of the four factories to the
 * real pi-tui components, the palette → renderer-theme mapping, and the
 * re-exported width helpers' parity with pi-tui.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  TuiMainScreen,
  truncateToWidth as piTruncateToWidth,
  visibleWidth as piVisibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui'
import { BlueComponentsService } from '../src/components.ts'
import type {
  BlueAutocompleteItem,
  BlueAutocompleteProvider,
  BlueSemanticColors,
  BlueTheme,
} from '../src/types.ts'
import { FakeTerminal, waitForRender } from './fake-terminal.ts'

/** A 1x1 PNG. */
const PNG_1X1 = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
  0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 100, 248, 207, 80, 15,
  0, 3, 134, 1, 128, 90, 52, 125, 107, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
])

/** A 1x1 GIF. */
const GIF_1X1 = new Uint8Array([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 255, 255, 255, 0, 0, 0, 33, 249, 4, 1, 0, 0,
  0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
])

const ROLES: (keyof BlueSemanticColors)[] = [
  'text',
  'textStrong',
  'muted',
  'textMuted',
  'accent',
  'primary',
  'border',
  'borderFocus',
  'success',
  'error',
  'warning',
  'selectedBg',
  'roleUser',
  'shellMode',
  'mdHeading',
  'mdLink',
  'mdLinkUrl',
  'mdCode',
  'mdCodeBlock',
  'mdCodeBlockBorder',
  'mdQuote',
  'mdQuoteBorder',
  'mdHr',
  'mdListBullet',
  'diffAdded',
  'diffRemoved',
  'diffAddedStrong',
  'diffRemovedStrong',
  'diffGutter',
  'diffMeta',
]

/** A palette whose every token tags its text, so mappings show in output. */
function taggedTheme(): BlueTheme {
  const colors = Object.fromEntries(
    ROLES.map(role => [role, (text: string) => `«${role}:${text}»`]),
  ) as unknown as BlueSemanticColors
  return { colors }
}

/** Boot a real renderer over a FakeTerminal for the editor factory. */
function bootTui(): { tui: TuiMainScreen; terminal: FakeTerminal; stop(): void } {
  const terminal = new FakeTerminal()
  const tui = new TuiMainScreen(terminal)
  tui.start()
  return { tui, terminal, stop: () => tui.stop() }
}

function createService(tui: TuiMainScreen): BlueComponentsService {
  return new BlueComponentsService(new Context(), { theme: taggedTheme(), tui })
}

describe('BlueComponentsService registration', () => {
  it('registers as ctx.blueComponents and unregisters when the fiber disposes', async () => {
    const { tui, stop } = bootTui()
    const ctx = new Context()
    const fiber = ctx.plugin(BlueComponentsService, { theme: taggedTheme(), tui })
    await fiber
    expect(ctx.get('blueComponents')).toBeInstanceOf(BlueComponentsService)
    await fiber.dispose()
    expect(ctx.get('blueComponents')).toBeUndefined()
    stop()
  })
})

describe('createEditor', () => {
  it('delegates text, history, submit, and change to a real Editor', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const editor = components.createEditor({ paddingX: 2 })

    editor.setText('hello')
    expect(editor.getText()).toBe('hello')

    const changes: string[] = []
    editor.onChange = text => changes.push(text)
    editor.setText('hello!')
    expect(changes).toEqual(['hello!'])
    expect(editor.onChange).toBeDefined()
    editor.onChange = undefined
    editor.setText('hello')
    expect(changes).toEqual(['hello!'])

    const submits: string[] = []
    editor.onSubmit = text => submits.push(text)
    editor.handleInput('\r')
    expect(submits).toEqual(['hello'])
    expect(editor.onSubmit).toBeDefined()
    editor.onSubmit = undefined

    // Submitted text clears; disabling submit keeps Enter from submitting.
    editor.setText('draft')
    expect(editor.disableSubmit).toBe(false)
    editor.disableSubmit = true
    editor.handleInput('\r')
    expect(submits).toEqual(['hello'])
    expect(editor.getText()).toBe('draft')

    editor.addToHistory('earlier prompt')
    editor.setText('')
    editor.handleInput('\x1b[A')
    expect(editor.getText()).toBe('earlier prompt')

    editor.focused = true
    expect(editor.focused).toBe(true)

    editor.invalidate()
    stop()
  })

  it('intercepts input through onKey before delegating to the real Editor', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const editor = components.createEditor()

    // A true result consumes the input; the pi-tui Editor never sees it.
    editor.onKey = () => true
    editor.handleInput('x')
    expect(editor.getText()).toBe('')

    // A false result delegates normally.
    editor.onKey = () => false
    editor.handleInput('x')
    expect(editor.getText()).toBe('x')

    // Clearing the hook restores plain delegation.
    editor.onKey = undefined
    editor.handleInput('y')
    expect(editor.getText()).toBe('xy')
    stop()
  })

  it('renders the palette border and honors setBorderColor', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const editor = components.createEditor()
    editor.setText('x')
    const before = editor.render(40).join('\n')
    expect(before).toContain('«border:')

    editor.setBorderColor(text => `[[${text}]]`)
    const after = editor.render(40).join('\n')
    expect(after).toContain('[[')
    expect(after).not.toContain('«border:')
    stop()
  })

  it('forwards the autocomplete provider to the real Editor with structural parity', async () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const editor = components.createEditor()

    const suggestionCalls: {
      lines: string[]
      cursorLine: number
      cursorCol: number
      options: { signal: AbortSignal, force?: boolean }
    }[] = []
    const completionCalls: {
      lines: string[]
      cursorLine: number
      cursorCol: number
      item: BlueAutocompleteItem
      prefix: string
    }[] = []
    const fileChecks: { lines: string[], cursorLine: number, cursorCol: number }[] = []
    const provider: BlueAutocompleteProvider = {
      triggerCharacters: ['@'],
      getSuggestions: (lines, cursorLine, cursorCol, options) => {
        suggestionCalls.push({ lines, cursorLine, cursorCol, options })
        return Promise.resolve({
          items: [
            { value: 'alpha', label: 'Alpha', description: 'first item' },
            { value: 'beta', label: 'Beta' },
          ],
          prefix: '/',
        })
      },
      applyCompletion: (lines, cursorLine, cursorCol, item, prefix) => {
        completionCalls.push({ lines, cursorLine, cursorCol, item, prefix })
        const applied = `${prefix}${item.value} `
        return { lines: [applied], cursorLine: 0, cursorCol: applied.length }
      },
      shouldTriggerFileCompletion: (lines, cursorLine, cursorCol) => {
        fileChecks.push({ lines, cursorLine, cursorCol })
        return true
      },
    }
    editor.setAutocompleteProvider(provider)

    expect(editor.isShowingAutocomplete()).toBe(false)
    // Typing '/' at the start of the buffer auto-triggers slash completion.
    editor.handleInput('/')
    await waitForRender()
    expect(editor.isShowingAutocomplete()).toBe(true)
    expect(suggestionCalls).toHaveLength(1)
    expect(suggestionCalls[0]?.lines).toEqual(['/'])
    expect(suggestionCalls[0]?.cursorLine).toBe(0)
    expect(suggestionCalls[0]?.cursorCol).toBe(1)
    expect(suggestionCalls[0]?.options.signal).toBeInstanceOf(AbortSignal)
    expect(suggestionCalls[0]?.options.force).toBe(false)

    // Tab accepts the highlighted completion through the provider.
    editor.handleInput('\t')
    expect(completionCalls).toHaveLength(1)
    expect(completionCalls[0]?.lines).toEqual(['/'])
    expect(completionCalls[0]?.cursorLine).toBe(0)
    expect(completionCalls[0]?.cursorCol).toBe(1)
    expect(completionCalls[0]?.item).toEqual({ value: 'alpha', label: 'Alpha', description: 'first item' })
    expect(completionCalls[0]?.prefix).toBe('/')
    expect(editor.getText()).toBe('/alpha ')
    // Accepting the completion closes the dropdown.
    expect(editor.isShowingAutocomplete()).toBe(false)

    // Tab outside a token routes through shouldTriggerFileCompletion, forcing.
    editor.setText('open ')
    editor.handleInput('\t')
    await waitForRender()
    expect(fileChecks).toEqual([{ lines: ['open '], cursorLine: 0, cursorCol: 5 }])
    expect(suggestionCalls).toHaveLength(2)
    expect(suggestionCalls[1]?.options.force).toBe(true)
    stop()
  })

  it('expands paste markers in getExpandedText while getText shows the marker', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const editor = components.createEditor()

    // A paste over ten lines collapses to a marker in the buffer.
    const pasted = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n')
    editor.handleInput(`\x1b[200~${pasted}\x1b[201~`)
    expect(editor.getText()).toBe('[paste #1 +12 lines]')
    expect(editor.getExpandedText()).toBe(pasted)

    // Small pastes stay inline; there is no marker to expand.
    editor.setText('')
    editor.handleInput('\x1b[200~short\x1b[201~')
    expect(editor.getText()).toBe('short')
    expect(editor.getExpandedText()).toBe('short')
    stop()
  })

  it('inserts text atomically at the cursor via insertText', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const editor = components.createEditor()

    // Insertion lands at the cursor, including mid-buffer.
    editor.setText('ac')
    editor.handleInput('\x1b[D')
    editor.insertText('b')
    expect(editor.getText()).toBe('abc')

    // The cursor advances past the inserted text, so the next insert lands
    // right after it — still mid-buffer.
    editor.insertText('z')
    expect(editor.getText()).toBe('abzc')

    // After setText the cursor sits at the end, so insertion appends.
    editor.setText('xy')
    editor.insertText('!')
    expect(editor.getText()).toBe('xy!')

    // An empty insertion is a no-op.
    editor.insertText('')
    expect(editor.getText()).toBe('xy!')
    stop()
  })
})

describe('createMarkdown', () => {
  it('maps the palette onto markdown constructs', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const markdown = components.createMarkdown({
      text: '# Title\n\n**strong** and *em* and ~~gone~~ and `code`\n\n- item\n\n> quote\n\n---\n\n[link](https://example.com)\n\n```js\nconst x = 1\n```\n',
      paddingX: 1,
      paddingY: 0,
    })
    const output = markdown.render(60).join('\n')
    // Headings carry their level through bold on top of the palette color.
    expect(output).toContain('\x1b[1m«mdHeading:')
    expect(output).toContain('«textStrong:strong»')
    expect(output).toContain('«mdCode:code»')
    // Unordered markers are normalized to `•` before the palette runs.
    expect(output).toContain('«mdListBullet:• ')
    expect(output).toContain('«mdQuote:')
    expect(output).toContain('«mdHr:')
    expect(output).toContain('«mdLink:')
    expect(output).toContain('«mdLinkUrl:')
    expect(output).toContain('«mdCodeBlockBorder:')
    // The js fence goes through cli-highlight: plain runs take the palette
    // tag while keyword runs carry cli-highlight SGR; line count is kept.
    expect(output).toContain('const')
    markdown.invalidate()
    stop()
  })

  it('streams via setText with internal caching, defaulting to empty', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const markdown = components.createMarkdown()
    expect(markdown.render(40).join('\n').trim()).toBe('')
    markdown.setText('first chunk')
    expect(markdown.render(40).join('\n')).toContain('first chunk')
    markdown.setText('first chunk second')
    expect(markdown.render(40).join('\n')).toContain('first chunk second')
    stop()
  })
})

describe('createSelectList', () => {
  const items = [
    { value: '1', label: 'One', description: 'first' },
    { value: '2', label: 'Two', description: 'second' },
  ]

  it('wires selection callbacks and renders the palette', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const selected: string[] = []
    const changed: string[] = []
    let cancelled = 0
    const list = components.createSelectList({
      items,
      maxVisible: 5,
      onSelect: item => selected.push(item.value),
      onCancel: () => cancelled++,
      onSelectionChange: item => changed.push(item.value),
    })

    const output = list.render(80).join('\n')
    expect(output).toContain('One')
    // The selected row takes primary; the unselected row's description is
    // textMuted.
    expect(output).toMatch(/«textMuted:\s*second»/)
    expect(output).toContain('«primary:')

    expect(list.getSelectedItem()?.value).toBe('1')
    list.handleInput('\x1b[B')
    expect(changed).toEqual(['2'])
    expect(list.getSelectedItem()?.value).toBe('2')

    list.handleInput('\r')
    expect(selected).toEqual(['2'])
    list.handleInput('\x1b')
    expect(cancelled).toBe(1)

    list.invalidate()
    stop()
  })

  it('works without callbacks and reports null for an empty list', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const list = components.createSelectList({ items: [] })
    expect(list.getSelectedItem()).toBeNull()
    list.handleInput('\x1b[B')
    list.handleInput('\r')
    list.handleInput('\x1b')
    list.render(40)
    stop()
  })
})

describe('createSettingsList', () => {
  it('renders the palette and wires change/cancel callbacks', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const changes: [string, string][] = []
    let cancelled = 0
    const list = components.createSettingsList({
      items: [
        { id: 'mode', label: 'Mode', description: 'the mode', currentValue: 'a', values: ['a', 'b'] },
        { id: 'note', label: 'Note', currentValue: 'plain' },
      ],
      onChange: (id, newValue) => changes.push([id, newValue]),
      onCancel: () => cancelled++,
    })

    const output = list.render(60).join('\n')
    // The selected row's label and value take accent, the other row text,
    // the description muted, and the cursor is the primary marker.
    expect(output).toContain('«accent:Mode»')
    expect(output).toContain('«accent:a»')
    expect(output).toContain('«text:Note»')
    expect(output).toContain('«muted:plain»')
    expect(output).toContain('«muted:  the mode»')
    expect(output).toContain('«primary:❯ »')

    // Enter cycles the first item's value; Escape cancels.
    list.handleInput('\r')
    expect(changes).toEqual([['mode', 'b']])
    list.handleInput('\x1b[B')
    list.handleInput('\x1b')
    expect(cancelled).toBe(1)

    list.invalidate()
    stop()
  })

  it('supports the search variant', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const list = components.createSettingsList({
      items: [{ id: 'mode', label: 'Mode', currentValue: 'a', values: ['a', 'b'] }],
      maxVisible: 3,
      enableSearch: true,
      onChange: () => {},
      onCancel: () => {},
    })
    expect(list.render(60).join('\n')).toContain('Mode')
    stop()
  })
})

describe('createImage', () => {
  it('renders the styled text fallback on a terminal without an image protocol', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    // Under vitest no Kitty/iTerm2 environment is present, so render(width)
    // returns pi-tui's muted fallback line.
    const image = components.createImage({
      data: PNG_1X1,
      mediaType: 'image/png',
      filename: 'pic.png',
      maxWidthCells: 20,
      maxHeightCells: 5,
    })
    const lines = image.render(40)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('«muted:[Image: pic.png [image/png] 1x1]»')

    // invalidate drops the render cache; the next render rebuilds identically.
    image.invalidate()
    expect(image.render(40)).toEqual(lines)
    stop()
  })

  it('falls back to the MIME type alone when no filename is given', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const image = components.createImage({ data: GIF_1X1, mediaType: 'image/gif' })
    expect(image.render(40)).toEqual(['«muted:[Image: [image/gif] 1x1]»'])
    image.invalidate()
    stop()
  })
})

describe('imageDimensions', () => {
  it('decodes PNG and GIF literals and rejects garbage', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    expect(components.imageDimensions(PNG_1X1)).toEqual({ width: 1, height: 1 })
    expect(components.imageDimensions(GIF_1X1)).toEqual({ width: 1, height: 1 })
    expect(components.imageDimensions(new Uint8Array([1, 2, 3, 4]))).toBeUndefined()
    stop()
  })
})

describe('width helpers', () => {
  it('pass through to pi-tui verbatim', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const styled = '\x1b[31mhello\x1b[39m world'
    expect(components.visibleWidth(styled)).toBe(piVisibleWidth(styled))
    expect(components.visibleWidth(styled)).toBe(11)
    expect(components.wrapText(styled, 5)).toEqual(wrapTextWithAnsi(styled, 5))
    expect(components.truncateToWidth(styled, 8)).toBe(piTruncateToWidth(styled, 8))
    expect(components.truncateToWidth(styled, 8, '…')).toBe(piTruncateToWidth(styled, 8, '…'))
    stop()
  })
})
