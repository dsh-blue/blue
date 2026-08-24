/**
 * `ctx.blueComponents` service: delegation of the four factories to the
 * real pi-tui components, the palette → renderer-theme mapping, the
 * re-exported width helpers' parity with pi-tui, and the S14 completion
 * polish on the editor — the wrapping slash dropdown (vs. the stock list on
 * other prefixes), Enter accepting-and-submitting a slash completion, the
 * bold leading slash token, the argument-hint ghost, and the fuzzy
 * re-exports. The S22 mention additions: the `createFileMentionProvider`
 * factory (stateless apply math, fd delegation) and the editor adapter's
 * mention drill-down reopen hook.
 */

import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
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
import { mkdtempTracked, registerTempDirCleanup } from './temp-dir.ts'


registerTempDirCleanup()

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

/**
 * A theme for the chrome specs: the two roles the editor frame consumes emit
 * real SGR sequences, because the chrome post-processing locates visible
 * columns by stripping SGR runs (the «role:» tags above are opaque to it).
 */
const SGR = { border: '\x1b[38;5;240m', shellMode: '\x1b[38;5;99m' }
const RESET = '\x1b[0m'

function sgrTheme(): BlueTheme {
  const identity = (text: string): string => text
  const colors = Object.fromEntries(
    ROLES.map(role => [
      role,
      role === 'border' || role === 'shellMode'
        ? (text: string) => SGR[role] + text + RESET
        : identity,
    ]),
  ) as unknown as BlueSemanticColors
  return { colors }
}

function createSgrService(tui: TuiMainScreen): BlueComponentsService {
  return new BlueComponentsService(new Context(), { theme: sgrTheme(), tui })
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
    // The history read-back (the structural cast over pi-tui's private
    // field, pinned here against 0.84.2) returns the entries oldest first.
    editor.addToHistory('second prompt')
    // pi-tui prepends: index 0 is the newest submission.
    expect(editor.getHistory()).toEqual(['second prompt', 'earlier prompt'])
    expect(editor.removeLatestHistory?.('not newest')).toBe(false)
    expect(editor.removeLatestHistory?.('second prompt')).toBe(true)
    expect(editor.getHistory()).toEqual(['earlier prompt'])

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
    // The idle frame is the neutral border; contextual recolors go through
    // setBorderColor (the S11 rounded-box default, kimi treatment).
    expect(before).toContain('«border:')
    expect(before).not.toContain('«primary:')

    editor.setBorderColor(text => `[[${text}]]`)
    const after = editor.render(40).join('\n')
    expect(after).toContain('[[')
    expect(after).not.toContain('«border:')
    stop()
  })

  it('renders a rounded box with side bars over the bare rules', () => {
    const { tui, stop } = bootTui()
    const components = createSgrService(tui)
    const editor = components.createEditor({ paddingX: 4 })
    editor.setText('hi')
    const lines = editor.render(20)
    // The per-dash rule is repainted as one box-drawn span.
    expect(lines[0]).toBe(`${SGR.border}╭${'─'.repeat(18)}╮${RESET}`)
    // The content row carries `hi`, the inverse-video cursor right behind
    // it, and a side bar at each end (the four padding spaces feed them).
    expect(lines[1]).toBe(`${SGR.border}│${RESET}   hi\x1b[7m \x1b[0m${' '.repeat(12)}${SGR.border}│${RESET}`)
    expect(lines.at(-1)).toBe(`${SGR.border}╰${'─'.repeat(18)}╯${RESET}`)
    stop()
  })

  it('overlays the > prompt symbol unpainted and the ! through the border color', () => {
    const { tui, stop } = bootTui()
    const components = createSgrService(tui)
    const editor = components.createEditor({ paddingX: 4 })
    editor.setPromptSymbol('>')
    const plain = editor.render(20)
    // Column 2 carries the bare `>` (no SGR around it); column 0 is the bar.
    expect(plain[1]).toBe(`${SGR.border}│${RESET} > \x1b[7m \x1b[0m${' '.repeat(14)}${SGR.border}│${RESET}`)

    editor.setPromptSymbol('!')
    const bash = editor.render(20)
    // The bash symbol shares the border hue (kimi rule).
    expect(bash[1]).toBe(`${SGR.border}│${RESET} ${SGR.border}!${RESET} \x1b[7m \x1b[0m${' '.repeat(14)}${SGR.border}│${RESET}`)

    editor.setPromptSymbol(undefined)
    const cleared = editor.render(20)
    expect(cleared[1]).toBe(`${SGR.border}│${RESET}   \x1b[7m \x1b[0m${' '.repeat(14)}${SGR.border}│${RESET}`)
    stop()
  })

  it('leaves the prompt off when the first content row lacks the padding', () => {
    const { tui, stop } = bootTui()
    const components = createSgrService(tui)
    // paddingX defaults to 0: content rows start at column 0, so the symbol
    // has nowhere to land and the row renders unchanged.
    const editor = components.createEditor()
    editor.setPromptSymbol('>')
    const lines = editor.render(20)
    expect(lines[1]).not.toContain('>')
    stop()
  })

  it('lays the border label into the top rule and opens connected corners', () => {
    const { tui, stop } = bootTui()
    const components = createSgrService(tui)
    const editor = components.createEditor({ paddingX: 4 })
    editor.setBorderLabel(`${SGR.shellMode}! shell mode${RESET}`)
    const labeled = editor.render(30)
    // The label's visible width is 12, leaving 28 - 12 dashes of the rule.
    expect(labeled[0]).toBe(
      `${SGR.border}╭${RESET}${SGR.shellMode}! shell mode${RESET}${SGR.border}${'─'.repeat(16)}${RESET}${SGR.border}╮${RESET}`,
    )

    editor.setConnectedAbove(true)
    const connected = editor.render(30)
    expect(connected[0]?.startsWith(`${SGR.border}├${RESET}`)).toBe(true)
    expect(connected.at(-1)).toBe(`${SGR.border}╰${'─'.repeat(28)}╯${RESET}`)
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

  it('accepts and submits a slash completion on a single Enter (0.84.2 semantics)', async () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const editor = components.createEditor()
    const submits: string[] = []
    editor.onSubmit = text => submits.push(text)
    const completions: { item: BlueAutocompleteItem, prefix: string }[] = []
    const provider: BlueAutocompleteProvider = {
      triggerCharacters: ['@'],
      getSuggestions: () =>
        Promise.resolve({
          items: [{ value: 'btw', label: '/btw', description: 'ask a side question' }],
          // The S14 provider contract: the prefix carries its leading slash.
          prefix: '/btw',
        }),
      applyCompletion: (_lines, _line, _col, item, prefix) => {
        completions.push({ item, prefix })
        const applied = `${prefix} `
        return { lines: [applied], cursorLine: 0, cursorCol: applied.length }
      },
    }
    editor.setAutocompleteProvider(provider)
    editor.handleInput('/')
    await waitForRender()
    expect(editor.isShowingAutocomplete()).toBe(true)

    // Enter applies the selected item, closes the dropdown, and falls
    // through to submit — one keystroke, not two.
    editor.handleInput('\r')
    expect(completions).toEqual([
      { item: { value: 'btw', label: '/btw', description: 'ask a side question' }, prefix: '/btw' },
    ])
    // submitValue trims the buffer, so the apply's trailing space drops.
    expect(submits).toEqual(['/btw'])
    expect(editor.getText()).toBe('')
    expect(editor.isShowingAutocomplete()).toBe(false)
    stop()
  })

  it('swaps the wrapping dropdown in for slash prefixes and the stock list otherwise', async () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const editor = components.createEditor({ paddingX: 4 })
    const provider: BlueAutocompleteProvider = {
      triggerCharacters: ['@'],
      getSuggestions: lines =>
        Promise.resolve(lines[0]?.startsWith('@')
          ? {
              items: [{ value: 'pkg', label: '@pkg', description: 'aaaa bbbb cccc dddd eeee ffff' }],
              prefix: '@pkg',
            }
          : {
              items: [{ value: 'btw', label: '/btw', description: 'aaaa bbbb cccc dddd eeee ffff' }],
              prefix: '/btw',
            }),
      applyCompletion: () => ({ lines: [''], cursorLine: 0, cursorCol: 0 }),
    }
    editor.setAutocompleteProvider(provider)

    // Slash prefix: the WrappingSelectList carries the description onto a
    // second indented line, both under the selected paint (content width 42,
    // description column 26 — the probe numbers of the wrapping spec).
    editor.handleInput('/')
    await waitForRender()
    const slash = editor.render(50)
    expect(slash).toHaveLength(5)
    expect(slash.join('\n')).toContain('«primary:→ /btw        aaaa bbbb cccc dddd eeee»')
    expect(slash.join('\n')).toContain(`«primary:${' '.repeat(14)}ffff»`)

    // Any other prefix keeps pi-tui's stock single-row truncation.
    editor.setText('')
    editor.handleInput('@')
    await waitForRender()
    const plain = editor.render(50)
    expect(plain).toHaveLength(4)
    expect(plain.join('\n')).toContain('@pkg')
    expect(plain.join('\n')).not.toContain(`«primary:${' '.repeat(14)}ffff»`)
    stop()
  })

  it('paints the leading slash token bold-primary outside bash mode', () => {
    const { tui, stop } = bootTui()
    const components = createSgrService(tui)
    const editor = components.createEditor({ paddingX: 4 })
    editor.setText('/btw')
    const painted = editor.render(30).join('\n')
    // The token paints bold; with the SGR theme primary is identity, so the
    // bold SGR pair is the visible marker.
    expect(painted).toContain('\x1b[1m/btw\x1b[22m')

    // The bash `!` proxy: while the bash prompt symbol is set, a leading
    // slash is a path separator and stays unpainted.
    editor.setPromptSymbol('!')
    const bash = editor.render(30).join('\n')
    expect(bash).not.toContain('\x1b[1m/btw\x1b[22m')

    // A buffer whose first row carries no slash (the slash sits on a later
    // line) leaves the row untouched.
    editor.setPromptSymbol(undefined)
    editor.setText('  \n/bt')
    const declined = editor.render(30).join('\n')
    expect(declined).not.toContain('\x1b[1m')
    stop()
  })

  it('splices the argument-hint ghost after the cursor and clears it', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const editor = components.createEditor({ paddingX: 4 })
    // Non-slash text isolates the ghost from the slash-token paint.
    editor.setText('hello')
    editor.setGhostHint(' <world>')
    const ghosted = editor.render(30).join('\n')
    expect(ghosted).toContain('hello\x1b[7m \x1b[0m«textMuted: <world>»')

    editor.setGhostHint(undefined)
    const cleared = editor.render(30).join('\n')
    expect(cleared).not.toContain('<world>')
    stop()
  })

  it('declines the ghost while history recall parks the cursor at the start', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const editor = components.createEditor({ paddingX: 4 })
    // Recall the entry through the real history path: Up parks the cursor
    // on the text's first character (an inverse-video glyph, not the
    // end-of-input space), and the ghost must decline — the splice math
    // would otherwise land inside the zero-width hardware-cursor marker
    // and eat the recalled text (the S16 dogfood garble).
    editor.addToHistory('/theme')
    editor.setGhostHint(' [dark|light]')
    editor.handleInput('\x1b[A')
    const recalled = editor.render(30).join('\n')
    expect(recalled).not.toContain('[dark|light]')
    // The recalled text itself renders whole behind the start cursor.
    expect(recalled).toContain('theme')
    stop()
  })

  it('declines the ghost while the cursor sits on a later line of the input', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const editor = components.createEditor({ paddingX: 4 })
    // A multi-line buffer parks the cursor at the end of its LAST line;
    // the ghost belongs only at the end of the single-line input.
    editor.setText('hello\nworld')
    editor.setGhostHint(' <ghost>')
    const rendered = editor.render(30).join('\n')
    expect(rendered).not.toContain('<ghost>')
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

  it('re-paints the width-capped horizontal rule to the full render width', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const markdown = components.createMarkdown({
      text: `---\n\nplain body\n\n\`\`\`js\n${'─'.repeat(80)}\n\`\`\`\n`,
    })
    const output = markdown.render(100).join('\n')
    // pi-tui caps the rule at 80; the adapter re-paints it to the render
    // width (the user's S17 dogfood ruling: the rule spans the body text).
    expect(output).toContain(`«mdHr:${'─'.repeat(100)}»`)
    // A fenced code line of exactly 80 dashes keeps its own highlight
    // styling — the exact-match path never touches it.
    expect(output).not.toContain(`«mdHr:${'─'.repeat(80)}»`)
    expect(output).toContain('plain body')
    // Below the 80-column cap the rule passes through unchanged. The
    // tagged test theme adds visible width, so pi-tui wraps the rule at
    // the render width here (in production the SGR wrap is zero-width);
    // the joined lines reassemble the full tag.
    const narrow = markdown.render(60).join('\n').replaceAll('\n', '')
    expect(narrow).toContain(`«mdHr:${'─'.repeat(60)}»`)
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
    // The selected row's label and value take the interaction primary (S12
    // closes the S10 review item), the other row's label AND value take
    // plain text (the S38 contrast ruling: the value column is content, not
    // de-emphasis), the description muted, and the cursor the primary
    // marker.
    expect(output).toContain('«primary:Mode»')
    expect(output).toContain('«primary:a»')
    expect(output).toContain('«text:Note»')
    expect(output).toContain('«text:plain»')
    expect(output).toContain('«muted:  the mode»')
    expect(output).toContain('«primary:❯ »')

    // updateValue rewrites one entry's displayed value in place.
    list.updateValue('note', 'edited')
    expect(list.render(60).join('\n')).toContain('«text:edited»')

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

describe('fuzzy helpers', () => {
  it('re-export pi-tui fuzzyMatch and fuzzyFilter semantics', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    // Subsequence match with a lower-is-better score; a miss scores 0.
    const hit = components.fuzzyMatch('bw', '/btw')
    expect(hit.matches).toBe(true)
    expect(hit.score).toBeLessThan(0)
    expect(components.fuzzyMatch('zz', '/btw')).toEqual({ matches: false, score: 0 })

    // All whitespace-separated tokens must match; survivors sort ascending
    // by score (better first), ties keeping input order.
    const filtered = components.fuzzyFilter(
      [{ n: '/theme' }, { n: '/btw' }, { n: '/sessions' }],
      'th',
      item => item.n,
    )
    expect(filtered.map(item => item.n)).toEqual(['/theme'])

    const ordered = components.fuzzyFilter(
      [{ n: '/a ab' }, { n: '/ab a' }, { n: '/zz' }],
      'a ab',
      item => item.n,
    )
    expect(ordered.map(item => item.n)).toEqual(['/ab a', '/a ab'])
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

describe('createFileMentionProvider', () => {
  it('returns null suggestions without an fd backend and applies completions statelessly', async () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const provider = components.createFileMentionProvider(process.cwd(), null)
    await expect(provider.getSuggestions(['@any'], 0, 4, { signal: new AbortController().signal })).resolves.toBeNull()
    // The apply math is fd-independent: directories keep the cursor for
    // drill-down (no trailing space), files append one.
    const directory = provider.applyCompletion(['see @sr'], 0, 7, { value: '@src/', label: 'src/' }, '@sr')
    expect(directory).toEqual({ lines: ['see @src/'], cursorLine: 0, cursorCol: 9 })
    const file = provider.applyCompletion(['see @sr'], 0, 7, { value: '@src/a.ts', label: 'a.ts' }, '@sr')
    expect(file).toEqual({ lines: ['see @src/a.ts '], cursorLine: 0, cursorCol: 14 })
    stop()
  })

  it('keeps the cursor inside the closing quote of a quoted directory', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const provider = components.createFileMentionProvider(process.cwd(), null)
    const applied = provider.applyCompletion(
      ['see @"a'],
      0,
      7,
      { value: '@"a b/"', label: 'a b/' },
      '@"a',
    )
    expect(applied).toEqual({ lines: ['see @"a b/"'], cursorLine: 0, cursorCol: 10 })
    stop()
  })

  it('delegates to a spawned fd through the renderer pipeline', async () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const root = mkdtempTracked('blue-core-mention-')
    const bin = mkdtempTracked('blue-core-mention-bin-')
    const fd = join(bin, 'fd')
    // The fake ignores fd's arguments and prints one directory line; the
    // pipeline's own handling (trailing-slash kind detection, the
    // @-carrying value, the basename label) is the contract pinned here.
    writeFileSync(fd, '#!/bin/sh\nprintf "src/\\n"\n')
    chmodSync(fd, 0o755)
    const provider = components.createFileMentionProvider(root, fd)
    const suggestions = await provider.getSuggestions(['@sr'], 0, 3, { signal: new AbortController().signal })
    expect(suggestions).toEqual({
      items: [{ value: '@src/', label: 'src/', description: 'src' }],
      prefix: '@sr',
    })
    stop()
  })
})

describe('EditorAdapter mention drill-down reopen', () => {
  /** A stub provider whose every round returns one directory item. */
  function stubProvider(onApply: (context: {
    line: string
    cursorCol: number
    item: BlueAutocompleteItem
    prefix: string
  }) => { lines: string[], cursorLine: number, cursorCol: number }) {
    const getSuggestions = vi.fn(async () => ({
      items: [{ value: '@src/', label: 'src/' }],
      prefix: '@',
    }))
    const provider: BlueAutocompleteProvider = {
      triggerCharacters: ['@'],
      getSuggestions,
      applyCompletion: (lines, _cursorLine, cursorCol, item, prefix) =>
        onApply({ line: lines[0] ?? '', cursorCol, item, prefix }),
    }
    return { getSuggestions, provider }
  }

  it('re-opens the dropdown after accepting a directory mention', async () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const editor = components.createEditor()
    const { getSuggestions, provider } = stubProvider(({ line, cursorCol, item, prefix }) => {
      const before = line.slice(0, cursorCol - prefix.length)
      return {
        lines: [`${before}${item.value}`],
        cursorLine: 0,
        cursorCol: before.length + item.value.length,
      }
    })
    editor.setAutocompleteProvider(provider)
    // The mention sits mid-line: the reopen gate scans back over the
    // leading text to find the token boundary.
    editor.handleInput('see @')
    await vi.waitFor(() => {
      expect(getSuggestions).toHaveBeenCalledTimes(1)
    })
    expect(editor.isShowingAutocomplete()).toBe(true)
    // Tab accepts the directory: the buffer becomes 'see @src/' with the
    // dropdown cancelled, and the adapter's reopen hook fires a second
    // suggestion round through 0.84.2's private tryTriggerAutocomplete
    // (the structural cast pinned here, the getHistory precedent).
    editor.handleInput('\t')
    expect(editor.getText()).toBe('see @src/')
    await vi.waitFor(() => {
      expect(getSuggestions).toHaveBeenCalledTimes(2)
    })
    // While the dropdown is showing, further input routes through the
    // editor's own update path — the hook's guard returns early.
    editor.handleInput('x')
    await vi.waitFor(() => {
      expect(getSuggestions).toHaveBeenCalledTimes(3)
    })
    stop()
  })

  it('does not reopen after accepting a file mention', async () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const editor = components.createEditor()
    const { getSuggestions, provider } = stubProvider(() => ({
      lines: ['@src/a.ts '],
      cursorLine: 0,
      cursorCol: 11,
    }))
    editor.setAutocompleteProvider(provider)
    editor.handleInput('@')
    await vi.waitFor(() => {
      expect(getSuggestions).toHaveBeenCalledTimes(1)
    })
    editor.handleInput('\t')
    expect(editor.getText()).toBe('@src/a.ts ')
    await new Promise(resolve => setImmediate(resolve))
    // The file accept leaves a trailing space, not a separator: no reopen.
    expect(getSuggestions).toHaveBeenCalledTimes(1)
    stop()
  })

  it('leaves non-mention input alone', () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const editor = components.createEditor()
    const { getSuggestions, provider } = stubProvider(({ item }) => ({
      lines: [item.value],
      cursorLine: 0,
      cursorCol: item.value.length,
    }))
    editor.setAutocompleteProvider(provider)
    editor.handleInput('a')
    editor.handleInput('/')
    expect(editor.getText()).toBe('a/')
    expect(getSuggestions).not.toHaveBeenCalled()
    stop()
  })

  it('backstops a bare @ that reached the buffer without the editor trigger', async () => {
    const { tui, stop } = bootTui()
    const components = createService(tui)
    const editor = components.createEditor()
    const { getSuggestions, provider } = stubProvider(({ item }) => ({
      lines: [item.value],
      cursorLine: 0,
      cursorCol: item.value.length,
    }))
    editor.setAutocompleteProvider(provider)
    // Programmatic insertion bypasses insertCharacter, so the renderer's
    // own trigger never runs; the next inert input (cursor-right) lets the
    // adapter hook open the mention dropdown on the bare '@'.
    editor.setText('@')
    editor.handleInput('\x1b[C')
    await vi.waitFor(() => {
      expect(getSuggestions).toHaveBeenCalledTimes(1)
    })
    stop()
  })
})
