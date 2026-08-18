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
import type { BlueSemanticColors, BlueTheme } from '../src/types.ts'
import { FakeTerminal } from './fake-terminal.ts'

const ROLES: (keyof BlueSemanticColors)[] = [
  'text',
  'textStrong',
  'muted',
  'accent',
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
    expect(output).toContain('«mdHeading:')
    expect(output).toContain('«textStrong:strong»')
    expect(output).toContain('«mdCode:code»')
    expect(output).toContain('«mdListBullet:')
    expect(output).toContain('«mdQuote:')
    expect(output).toContain('«mdHr:')
    expect(output).toContain('«mdLink:')
    expect(output).toContain('«mdLinkUrl:')
    expect(output).toContain('«mdCodeBlock:')
    expect(output).toContain('«mdCodeBlockBorder:')
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
    // The selected row takes accent; the unselected row's description is muted.
    expect(output).toMatch(/«muted:\s*second»/)
    expect(output).toContain('«accent:')

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
    // the description muted, and the cursor is the accented marker.
    expect(output).toContain('«accent:Mode»')
    expect(output).toContain('«accent:a»')
    expect(output).toContain('«text:Note»')
    expect(output).toContain('«muted:plain»')
    expect(output).toContain('«muted:  the mode»')
    expect(output).toContain('«accent:❯ »')

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
