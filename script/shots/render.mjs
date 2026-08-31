#!/usr/bin/env node
/**
 * Scenario → headless Terminal renderer.
 *
 * Compiles one public `ui.*` wire node through the BUILT core compiler
 * (`packages/core/lib`) with the real dark theme palette
 * (`packages/core/lib/theme-dark.js`), renders it to ANSI rows, asserts the
 * D48 width contract on every row, then parses the rows into an
 * `@xterm/headless` Terminal for the SVG painter. Width math delegates to the
 * same pi-tui helpers core re-exports from `src/width.ts` — nothing is
 * re-implemented here (D48). No PTY, no wall clock: output is deterministic.
 *
 * @module script/shots/render
 */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// @xterm/headless@6 ships CJS-only; the ESM namespace lacks named exports.
const { Terminal } = require('@xterm/headless')

const coreLibUrl = new URL('../../packages/core/lib/index.js', import.meta.url)
if (!existsSync(coreLibUrl)) {
  throw new Error('packages/core/lib is missing — run `pnpm build` before the shots pipeline')
}
const { compileBlueUiNode } = await import(coreLibUrl.href)
const { DARK_COLORS } = await import(new URL('../../packages/core/lib/theme-dark.js', import.meta.url).href)
// Resolve pi-tui through core's own node_modules so the width helpers are the
// exact instance core's `src/width.ts` re-exports (D48 single width truth).
const { CURSOR_MARKER, truncateToWidth, visibleWidth, wrapTextWithAnsi } =
  await import(new URL('../../packages/core/node_modules/@earendil-works/pi-tui/dist/index.js', import.meta.url).href)

/** Minimal deterministic BlueEditor fake, mirrored from core's ui-compiler spec. */
function createTestEditor() {
  let value = ''
  let cursor = 0
  const editor = {
    focused: false,
    onSubmit: undefined,
    onChange: undefined,
    onKey: undefined,
    disableSubmit: false,
    setSubmitBarrier: () => {},
    submit: () => { if (!editor.disableSubmit) editor.onSubmit?.(value) },
    getText: () => value,
    getExpandedText: () => value,
    setText: text => { value = text; cursor = text.length },
    renderContent: (width, masked = false) => {
      const shown = masked ? '•'.repeat(value.length) : value
      const row = `${shown.slice(0, cursor)}${editor.focused ? CURSOR_MARKER : ''}${shown.slice(cursor)}`
      return [truncateToWidth(row, width)]
    },
    handleInput: data => {
      if (editor.onKey?.(data) === true) return
      if (data === '\r') { if (!editor.disableSubmit) editor.onSubmit?.(value); return }
      if (data === '\x1b[D') { cursor = Math.max(0, cursor - 1); return }
      if (data === '\x1b[C') { cursor = Math.min(value.length, cursor + 1); return }
      if (data === '\x7f' || data === '\b') {
        if (cursor > 0) {
          const before = Array.from(value.slice(0, cursor))
          before.pop()
          const prefix = before.join('')
          value = `${prefix}${value.slice(cursor)}`
          cursor = prefix.length
          editor.onChange?.(value)
        }
        return
      }
      const inserted = /^[^\x00-\x1f\x7f-\x9f]+$/u.test(data) ? data : ''
      if (inserted.length === 0) return
      value = `${value.slice(0, cursor)}${inserted}${value.slice(cursor)}`
      cursor += inserted.length
      editor.onChange?.(value)
    },
    addToHistory: () => {},
    getHistory: () => [],
    setBorderColor: () => {},
    setPromptSymbol: () => {},
    setBorderLabel: () => {},
    setConnectedAbove: () => {},
    setGhostHint: () => {},
    setAutocompleteProvider: () => {},
    isShowingAutocomplete: () => false,
    refreshAutocomplete: () => {},
    insertText: text => { value = `${value.slice(0, cursor)}${text}${value.slice(cursor)}`; cursor += text.length; editor.onChange?.(value) },
    render: width => editor.renderContent(width),
    invalidate: () => {},
  }
  return editor
}

const components = {
  visibleWidth,
  wrapText: wrapTextWithAnsi,
  truncateToWidth,
  createEditor: createTestEditor,
  createMarkdown: (options) => {
    let value = options?.text ?? ''
    return {
      setText: text => { value = text },
      render: width => wrapTextWithAnsi(value, width),
      invalidate: () => {},
    }
  },
}

/**
 * Compile and render one scenario to a headless Terminal.
 * @param {object} scenario - manifest entry: `{ id, width, build, drive? }`.
 * @param {object} ui - the built `@dsh-blue/blue-ui` builder namespace.
 * @param {Function} defineBlueComponent - the built component factory.
 * @returns {Promise<{ term: object, cols: number, rows: number }>}
 */
export async function renderScenario(scenario, ui, defineBlueComponent) {
  const width = scenario.width
  const node = scenario.build(ui, defineBlueComponent)
  const events = []
  const result = compileBlueUiNode(node, {
    components,
    colors: DARK_COLORS,
    getViewport: () => ({ columns: width, rows: 24 }),
    screenMode: 'alternate',
    emit: event => events.push(event),
  })
  if (!result.ok) throw new Error(`${scenario.id}: compile failed — ${result.message}`)
  const compiled = result.value

  const focus = compiled.focusTarget
  if (focus) {
    focus.focused = true
    scenario.drive?.(focus)
  }

  const rows = compiled.component.render(width)
  for (const [index, row] of rows.entries()) {
    const rowWidth = visibleWidth(row)
    if (rowWidth > width) {
      throw new Error(`${scenario.id}: row ${index} overflows (${rowWidth} > ${width}) — D48 contract violation`)
    }
  }

  // pi-tui marks the cursor with an APC (`\x1b_pi:c\x07`) that headless xterm
  // cannot parse; paint it as a reverse-video block over the cell it sits on —
  // the way a real terminal's hardware cursor would show up in a screenshot.
  // The marker precedes its cell, so invert the following char (a full row
  // falls back to inverting the preceding char to avoid growing the row).
  const paintCursor = (row, pattern, replacement) =>
    row.replace(pattern, (...args) => replacement(args[1] || ' '))
  const painted = rows.map(row => {
    if (!row.includes(CURSOR_MARKER)) return row
    const follow = paintCursor(row, /\x1b_pi:c\x07(.?)/su, ch => `\x1b[7m${ch}\x1b[27m`)
    if (visibleWidth(follow) <= width) return follow
    const precede = paintCursor(row, /(.?)\x1b_pi:c\x07/su, ch => `\x1b[7m${ch}\x1b[27m`)
    if (visibleWidth(precede) <= width) return precede
    throw new Error(`${scenario.id}: cursor block does not fit at either side of the marker`)
  })

  const lineCount = Math.max(1, painted.length)
  const term = new Terminal({ cols: width, rows: lineCount, scrollback: 0, allowProposedApi: true })
  await new Promise((resolve, reject) => {
    try {
      term.write(painted.join('\r\n'), resolve)
    } catch (error) {
      reject(error)
    }
  })
  return { term, cols: width, rows: lineCount }
}
