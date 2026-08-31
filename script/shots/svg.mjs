#!/usr/bin/env node
/**
 * Styled terminal cell buffer → deterministic SVG painter.
 *
 * Reads an `@xterm/headless` Terminal's active buffer cell by cell and paints
 * it as a fixed-grid SVG: one canvas rect, coalesced background-color rects
 * per row where a cell's background differs from the canvas, and coalesced
 * `<text>` runs per (fg, bold, italic, underline, dim) style. Every run pins
 * `textLength` so viewer font metrics cannot shift alignment. The JetBrains
 * Mono WOFF2 pair is subset with harfbuzz (`subset-font`, pure wasm) to the
 * exact codepoints the frame paints, then embedded as base64 data URIs, so
 * output is a single self-contained file. No random ids, no timestamps, no
 * wall clock — the output is byte-deterministic for a given buffer.
 *
 * @module script/shots/svg
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// subset-font@2 ships CJS-only; harfbuzzjs is a wasm module with no build step.
const subsetFont = require('subset-font')

// Pinned layout: JetBrains Mono at 14px has a 0.6em advance (8.4px).
const FONT_SIZE = 14
const CELL_W = 8.4
const CELL_H = 19
const BASELINE = 14
const PAD = 12
const HEADER_H = 26
const RADIUS = 6

// Pinned dark window chrome and default cell colors (the shot canvas doubles
// as the terminal's default background).
const CANVAS_BG = '#1e1e2e'
const DEFAULT_FG = '#e0e0e0'
const DOT_COLORS = ['#ff5f57', '#febc2e', '#28c840']

// xterm.js attribute color modes (Attributes.CM_*).
const CM_P16 = 1 << 24
const CM_P256 = 2 << 24
const CM_RGB = 3 << 24

function hex2(value) {
  return value.toString(16).padStart(2, '0')
}

// Standard xterm 256-color palette: 16 base colors, the 6×6×6 cube at levels
// [0, 95, 135, 175, 215, 255], then 24 grays from #080808 upward.
const PALETTE = (() => {
  const base = [
    '#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
    '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff',
  ]
  const levels = [0, 95, 135, 175, 215, 255]
  const table = [...base]
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) table.push(`#${hex2(levels[r])}${hex2(levels[g])}${hex2(levels[b])}`)
    }
  }
  for (let i = 0; i < 24; i++) table.push(`#${hex2(8 + i * 10)}${hex2(8 + i * 10)}${hex2(8 + i * 10)}`)
  return table
})()

/** Resolve one cell color attribute to `#rrggbb`, or null for the default. */
function resolveColor(mode, value) {
  if (mode === CM_RGB) return `#${hex2((value >> 16) & 0xff)}${hex2((value >> 8) & 0xff)}${hex2(value & 0xff)}`
  if (mode === CM_P16 || mode === CM_P256) return PALETTE[value & 0xff] ?? null
  return null
}

/** Fixed 2-decimal formatting: deterministic across machines and locales. */
function fmt(value) {
  return String(Number(value.toFixed(2)))
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const FONT_FACES = [
  { file: 'JetBrainsMono-Regular.woff2', weight: 'normal' },
  { file: 'JetBrainsMono-Bold.woff2', weight: 'bold' },
]

/**
 * Subset one embedded font to the frame's codepoints and build its @font-face
 * rule. The subset input is the sorted codepoint union, so identical frames
 * produce identical bytes.
 */
async function subsetFontFace(file, weight, codepoints) {
  const buffer = readFileSync(new URL(`assets/${file}`, import.meta.url))
  const subset = await subsetFont(buffer, codepoints, { targetFormat: 'woff2' })
  const data = Buffer.from(subset).toString('base64')
  return `@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:${weight};` +
    `src:url(data:font/woff2;base64,${data}) format('woff2')}`
}

/**
 * Paint a Terminal buffer as a self-contained SVG string.
 * @param {object} term - an `@xterm/headless` Terminal with the rows written.
 * @param {object} geometry - `{ cols, rows }` of the rendered frame.
 * @returns {Promise<string>} the SVG document.
 */
export async function paintTerminalSvg(term, { cols, rows }) {
  const width = PAD * 2 + cols * CELL_W
  const height = PAD * 2 + HEADER_H + rows * CELL_H
  const contentTop = PAD + HEADER_H
  // Two paint streams: SVG is painter's order, so every background rect must
  // precede every text run or a selected-row bg would cover its own label.
  const backgrounds = []
  const texts = []
  // Every codepoint painted into a <text> run, for the font subset.
  const usedCodepoints = new Set()

  for (let row = 0; row < rows; row++) {
    const line = term.buffer.active.getLine(row)
    if (!line) continue
    const y = contentTop + row * CELL_H + BASELINE

    // Coalesced background rects where a run's bg differs from the canvas.
    let bgRun = null
    const flushBg = endCol => {
      if (!bgRun) return
      backgrounds.push(
        `<rect x="${fmt(PAD + bgRun.start * CELL_W)}" y="${fmt(contentTop + row * CELL_H)}" ` +
        `width="${fmt((endCol - bgRun.start) * CELL_W)}" height="${fmt(CELL_H)}" fill="${bgRun.bg}"/>`,
      )
      bgRun = null
    }

    // Coalesced text runs per resolved style.
    let textRun = null
    const flushText = () => {
      if (!textRun) return
      const attrs = [
        `x="${fmt(PAD + textRun.start * CELL_W)}"`,
        `y="${fmt(y)}"`,
        `textLength="${fmt(textRun.cells * CELL_W)}"`,
        'lengthAdjust="spacingAndGlyphs"',
        `fill="${textRun.fg}"`,
      ]
      if (textRun.bold) attrs.push('font-weight="bold"')
      if (textRun.italic) attrs.push('font-style="italic"')
      if (textRun.underline) attrs.push('text-decoration="underline"')
      if (textRun.dim) attrs.push('fill-opacity="0.6"')
      texts.push(`<text ${attrs.join(' ')}>${escapeXml(textRun.text)}</text>`)
      for (const char of textRun.text) usedCodepoints.add(char)
      textRun = null
    }

    for (let col = 0; col < cols; col++) {
      const cell = line.getCell(col)
      if (!cell) break
      const cellWidth = cell.getWidth()
      if (cellWidth === 0) continue // wide-glyph continuation cell
      const inverse = Boolean(cell.isInverse())
      let fg = resolveColor(cell.getFgColorMode(), cell.getFgColor())
      let bg = resolveColor(cell.getBgColorMode(), cell.getBgColor())
      if (inverse) [fg, bg] = [bg ?? CANVAS_BG, fg ?? DEFAULT_FG]
      fg = fg ?? DEFAULT_FG

      if (bg === null || bg === CANVAS_BG) {
        flushBg(col)
      } else {
        if (!bgRun || bgRun.bg !== bg) {
          flushBg(col)
          bgRun = { start: col, bg }
        }
        bgRun.end = col + cellWidth
      }

      const chars = cell.getChars() || ' '
      if (chars === ' ') {
        flushText()
        continue
      }
      const style = {
        fg,
        bold: Boolean(cell.isBold()),
        italic: Boolean(cell.isItalic()),
        underline: Boolean(cell.isUnderline()),
        dim: Boolean(cell.isDim()),
      }
      const same = textRun !== null && textRun.fg === style.fg && textRun.bold === style.bold &&
        textRun.italic === style.italic && textRun.underline === style.underline && textRun.dim === style.dim
      if (!same) {
        flushText()
        textRun = { start: col, cells: 0, text: '', ...style }
      }
      textRun.text += chars
      textRun.cells += cellWidth
    }
    flushBg(cols)
    flushText()
  }

  const dots = DOT_COLORS.map((color, index) =>
    `<circle cx="${fmt(PAD + 6 + index * 18)}" cy="${fmt(PAD + HEADER_H / 2)}" r="6" fill="${color}"/>`,
  )
  // Sorted union keeps the subset input (and therefore the embedded bytes)
  // stable; the space guarantees a non-empty input for frames without text.
  const codepoints = [' ', ...usedCodepoints].sort().join('')
  const fontFaces = (await Promise.all(
    FONT_FACES.map(({ file, weight }) => subsetFontFace(file, weight, codepoints)),
  )).join('')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}" height="${fmt(height)}" ` +
      `viewBox="0 0 ${fmt(width)} ${fmt(height)}" xml:space="preserve">`,
    `<defs><style>${fontFaces}</style></defs>`,
    `<rect width="${fmt(width)}" height="${fmt(height)}" rx="${RADIUS}" fill="${CANVAS_BG}"/>`,
    ...dots,
    `<g font-family="'JetBrains Mono',monospace" font-size="${FONT_SIZE}">`,
    ...backgrounds,
    ...texts,
    '</g>',
    '</svg>',
    '',
  ].join('\n')
}
