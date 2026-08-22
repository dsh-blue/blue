// Renders the recorded asciinema .cast (demo-record.mjs) into the promo
// assets: the README hero GIF and PNG stills. The cast replays through
// @xterm/headless (the same engine behind the R2 golden frames), every cell
// is read with its truecolor attributes, and each sampled frame becomes SVG
// (braille cells are redrawn as vector dot grids so the banner stays sharp at
// any zoom, independent of font braille coverage) → PNG via resvg-js → GIF
// via gifenc with a global palette and inter-frame transparency.
// Run: pnpm demo:render            (defaults: docs/assets/demo.cast → demo.gif)
//   --cast <path> --gif <path>     inputs/outputs
//   --png <path> --at <seconds>    single still at a cast timestamp
//   --hold <sec> --tick <sec>      idle clamp (1.5) / merge window (1/12)
//   --scale <f> --pad <px> --font-size <px>

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import headless from '@xterm/headless'
import { Resvg } from '@resvg/resvg-js'
import gifenc from 'gifenc'
import { root } from './smoke-lib.mjs'

const { Terminal } = headless
const { GIFEncoder, quantize, applyPalette } = gifenc

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}
const number = (name, fallback) => Number(flag(name, fallback))

const CAST = flag('cast', join(root, 'docs/assets/demo.cast'))
const GIF_OUT = flag('gif', join(root, 'docs/assets/demo.gif'))
const PNG_OUT = flag('png', undefined)
const AT_SECONDS = flag('at', undefined) === undefined ? undefined : Number(flag('at', undefined))
const END = flag('end', undefined) === undefined ? Infinity : Number(flag('end', undefined))
const HOLD = number('hold', 1.5)
const TICK = number('tick', 1 / 12)
const SCALE = number('scale', 1)
const PAD = number('pad', 24)
const FONT_SIZE = number('font-size', 16)

// ---------------------------------------------------------------------------
// Geometry & palette (JetBrains Mono: 0.6em advance, 1.2em line box)
// ---------------------------------------------------------------------------
const CELL_W = FONT_SIZE * 0.6
const LINE_H = FONT_SIZE * 1.2
const BASELINE_F = 0.8 // baseline as a fraction of the line box (tuned visually)
const FONT_DIR = join(root, 'docs/assets/fonts')
const FONT_FILES = [join(FONT_DIR, 'JetBrainsMono-Regular.ttf'), join(FONT_DIR, 'JetBrainsMono-Bold.ttf')]

const PAGE_BG = '#0b0e1a' // the promo card dark — og.png / social-preview share it
const PAGE_BG_RGB = [0x0b, 0x0e, 0x1a]
const DEFAULT_FG = '#e0e0e0' // theme-dark text token

// ANSI 16 (xterm's classic); Blue paints its colors in truecolor, so this
// table only carries incidental palette-index output (e.g. dim rules).
const ANSI_16 = [
  '#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
  '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff',
]
const hex = value => `#${value.toString(16).padStart(6, '0')}`
const color256 = index => {
  if (index < 16) return ANSI_16[index]
  if (index < 232) {
    const level = n => (n === 0 ? 0 : 55 + n * 40)
    const slots = index - 16
    return hex((level(Math.floor(slots / 36)) << 16) | (level(Math.floor(slots / 6) % 6) << 8) | level(slots % 6))
  }
  const gray = 8 + (index - 232) * 10
  return hex((gray << 16) | (gray << 8) | gray)
}

// ---------------------------------------------------------------------------
// Cast parsing & replay
// ---------------------------------------------------------------------------
const castLines = readFileSync(CAST, 'utf8').trim().split('\n')
const header = JSON.parse(castLines[0])
// Auto-trim: the recorder's exit path prints "press ctrl+c again to exit" —
// the promo GIF ends on the product, not on the quit hint. Everything from
// that event on is dropped (an explicit --end overrides by cutting earlier).
const HINT = 'press ctrl+c again'
let endRaw = END
{
  let raw = 0
  for (const line of castLines.slice(1)) {
    const event = JSON.parse(line)
    if (event[1] !== 'o') continue
    raw = event[0]
    if (event[2].includes(HINT)) { endRaw = Math.min(endRaw, raw); break }
  }
}
const events = castLines.slice(1)
  .map(line => JSON.parse(line))
  .filter(([time, type]) => type === 'o' && time <= endRaw)
const { width: COLS, height: ROWS } = header
if (!Number.isInteger(COLS) || !Number.isInteger(ROWS)) throw new Error(`cast header lacks width/height: ${castLines[0]}`)

const vt = new Terminal({ cols: COLS, rows: ROWS, scrollback: 10_000, allowProposedApi: true })
const flush = () => new Promise(resolve => { vt.write('', resolve) })

// Idle clamp: silences longer than HOLD compress to HOLD — pacing reads
// calmly in the GIF without re-recording, and the cast itself stays honest.
const clamped = []
let previous = 0
let offset = 0
for (const [time, , data] of events) {
  const gap = time - previous
  offset += Math.min(gap, HOLD)
  previous = time
  clamped.push([offset, data])
}

async function screenAt(clampedTime) {
  while (clamped.length > 0 && clamped[0][0] <= clampedTime) {
    vt.write(clamped.shift()[1])
  }
  await flush()
  return readViewport()
}

function readViewport() {
  const buffer = vt.buffer.active
  const lines = []
  for (let y = 0; y < ROWS; y += 1) {
    const line = buffer.getLine(buffer.baseY + y)
    const cells = []
    for (let x = 0; x < COLS; x += 1) {
      const cell = line?.getCell(x)
      if (cell === undefined) break
      cells.push({
        chars: cell.getChars(),
        width: cell.getWidth(),
        fg: cellColor(cell.getFgColor(), cell.isFgRGB(), cell.isFgPalette()),
        bg: cellColor(cell.getBgColor(), cell.isBgRGB(), cell.isBgPalette()),
        bold: cell.isBold() === 1,
        inverse: cell.isInverse() === 1,
      })
    }
    lines.push(cells)
  }
  return lines
}

function cellColor(value, isRGB, isPalette) {
  if (isRGB) return hex(value & 0xffffff)
  if (isPalette) return color256(value)
  return null // default
}

// ---------------------------------------------------------------------------
// SVG painting
// ---------------------------------------------------------------------------
const xmlEscape = text => text
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

// Braille cell → 2×4 dot grid (dot1..8 = bits 0..7), drawn as circles so the
// banner scales crisply even where a font lacks braille glyphs. Dot screen
// rows: dot1/4 top, 2/5 upper, 3/6 lower, 7/8 bottom; left column dots 1-3+7.
const BRAILLE_ROW = [0, 1, 2, 0, 1, 2, 3, 3]
function brailleDots(char, x, y, fill, parts) {
  const code = char.codePointAt(0)
  if (code === undefined || code < 0x2800 || code > 0x28ff) return false
  const xs = [x + CELL_W * 0.25, x + CELL_W * 0.75]
  const ys = [0.125, 0.375, 0.625, 0.875].map(f => y + LINE_H * f)
  const radius = Math.max(0.9, CELL_W * 0.13)
  for (let dot = 0; dot < 8; dot += 1) {
    if ((code & (1 << dot)) === 0) continue
    const cx = xs[dot <= 2 || dot === 6 ? 0 : 1]
    const cy = ys[BRAILLE_ROW[dot]]
    parts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius.toFixed(2)}" fill="${fill}"/>`)
  }
  return true
}

function screenSvg(lines) {
  const viewW = COLS * CELL_W + PAD * 2
  const viewH = ROWS * LINE_H + PAD * 2
  const parts = [`<rect x="0" y="0" width="${viewW}" height="${viewH}" fill="${PAGE_BG}"/>`]
  for (let y = 0; y < lines.length; y += 1) {
    const top = PAD + y * LINE_H
    const cells = lines[y]

    // Background runs (non-default bg only; inverse swaps fg into the seat).
    let run = null
    const flushBg = endX => {
      if (run !== null && run.startX < endX) {
        parts.push(`<rect x="${(PAD + run.startX * CELL_W).toFixed(2)}" y="${top.toFixed(2)}" width="${((endX - run.startX) * CELL_W).toFixed(2)}" height="${LINE_H.toFixed(2)}" fill="${run.color}"/>`)
      }
      run = null
    }
    for (let x = 0; x < cells.length; x += 1) {
      const cell = cells[x]
      const bg = cell.inverse ? (cell.fg ?? DEFAULT_FG) : cell.bg
      if (bg === null) { flushBg(x); continue }
      if (run !== null && run.color === bg) continue
      flushBg(x)
      run = { startX: x, color: bg }
    }
    flushBg(cells.length)

    // Foreground: braille cells as dot groups, everything else as per-run
    // tspans (same fill+weight, contiguous cells).
    let text = null
    const closeText = () => {
      if (text === null) return
      const baseline = (top + LINE_H * BASELINE_F).toFixed(2)
      parts.push(`<text x="${(PAD + text.x * CELL_W).toFixed(2)}" y="${baseline}" font-family="JetBrains Mono" font-size="${FONT_SIZE}"${text.weight}>${text.tspans}</text>`)
      text = null
    }
    for (let x = 0; x < cells.length; x += 1) {
      const cell = cells[x]
      if (cell.width === 0) continue
      const fg = cell.inverse ? (cell.bg ?? PAGE_BG) : (cell.fg ?? DEFAULT_FG)
      const weight = cell.bold ? ' font-weight="700"' : ''
      if (cell.chars !== '' && brailleDots(cell.chars, PAD + x * CELL_W, top, fg, parts)) {
        closeText()
        continue
      }
      if (cell.chars === '') { closeText(); continue }
      if (text !== null && text.fill === fg && text.weight === weight && text.endX === x) {
        text.tspans += xmlEscape(cell.chars)
        text.endX += cell.width
      } else {
        closeText()
        text = { fill: fg, weight, endX: x + cell.width, tspans: xmlEscape(cell.chars), x }
      }
    }
    closeText()
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(viewW * SCALE)}" height="${Math.round(viewH * SCALE)}" viewBox="0 0 ${viewW} ${viewH}">${parts.join('')}</svg>`
}

function rasterize(svg) {
  const resvg = new Resvg(svg, {
    fitTo: SCALE === 1 ? { mode: 'original' } : { mode: 'width', width: Math.round((COLS * CELL_W + PAD * 2) * SCALE) },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'JetBrains Mono' },
  })
  const rendered = resvg.render()
  return { png: rendered.asPng(), pixels: rendered.pixels, width: rendered.width, height: rendered.height }
}

// ---------------------------------------------------------------------------
// Still mode: one PNG at a cast timestamp.
// ---------------------------------------------------------------------------
mkdirSync(dirname(PNG_OUT ?? GIF_OUT), { recursive: true })

if (PNG_OUT !== undefined) {
  if (AT_SECONDS === undefined) throw new Error('--png needs --at <cast seconds>')
  const { png } = rasterize(screenSvg(await screenAt(AT_SECONDS)))
  writeFileSync(PNG_OUT, png)
  console.log(`DEMO_RENDER_STILL png=${PNG_OUT} at=${AT_SECONDS}s`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// GIF pass: sample one screen per tick that received bytes (idle holds ride
// the previous frame's delay), dedupe identical screens by merging their
// durations, encode against a global palette whose slot 0 is the page
// background (the inter-frame transparency slot).
// ---------------------------------------------------------------------------
const samples = []
let frameAt = TICK
while (clamped.length > 0) {
  const screen = await screenAt(frameAt)
  samples.push({ at: frameAt, screen, key: JSON.stringify(screen) })
  if (clamped.length === 0) break
  const nextEvent = clamped[0][0]
  frameAt = Math.max(frameAt + TICK, nextEvent + TICK)
}

// Merge identical consecutive screens; a group's duration runs to the next
// group's timestamp (the last group holds for HOLD).
const groups = []
for (const sample of samples) {
  const previous = groups[groups.length - 1]
  if (previous !== undefined && previous.key === sample.key) continue
  groups.push(sample)
}

// Global palette from a spread of groups.
const sampleStride = Math.max(1, Math.floor(groups.length / 12))
const sampleScreens = groups.filter((_, index) => index % sampleStride === 0).slice(0, 8)
let sampleRgba = new Uint8Array(0)
for (const { screen } of sampleScreens) {
  const { pixels } = rasterize(screenSvg(screen))
  const merged = new Uint8Array(sampleRgba.length + pixels.length)
  merged.set(sampleRgba)
  merged.set(pixels, sampleRgba.length)
  sampleRgba = merged
}
const palette = [PAGE_BG_RGB, ...quantize(sampleRgba, 255, { format: 'rgb565' })].slice(0, 256)

const gif = GIFEncoder()
let previousPixels = null
for (let index = 0; index < groups.length; index += 1) {
  const { at, screen } = groups[index]
  const nextAt = index + 1 < groups.length ? groups[index + 1].at : at + HOLD
  const delay = Math.max(20, Math.round((nextAt - at) * 1000))
  const { pixels, width, height } = rasterize(screenSvg(screen))
  let indexed = applyPalette(pixels, palette, 'rgb565')
  if (previousPixels !== null) {
    indexed = Uint8Array.from(indexed)
    for (let i = 0; i < indexed.length; i += 1) {
      if (pixels[i * 4] === previousPixels[i * 4]
        && pixels[i * 4 + 1] === previousPixels[i * 4 + 1]
        && pixels[i * 4 + 2] === previousPixels[i * 4 + 2]) indexed[i] = 0
    }
  }
  gif.writeFrame(indexed, width, height, {
    palette: index === 0 ? palette : undefined,
    delay,
    transparent: true,
    transparentIndex: 0,
    repeat: 0,
  })
  previousPixels = pixels
}
gif.finish()
writeFileSync(GIF_OUT, gif.bytes())
console.log(`DEMO_RENDER_GIF gif=${GIF_OUT} frames=${groups.length} samples=${samples.length} size=${(gif.bytes().length / 1024 / 1024).toFixed(2)}MB`)
