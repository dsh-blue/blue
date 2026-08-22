/**
 * The width-truth property gate (D45): every invariant the `BlueComponent`
 * contract ("visible width must not exceed `width`") and the render-exit
 * clamp depend on holds only because pi-tui's `visibleWidth` and
 * `truncateToWidth` agree with each other on every input shape — ASCII,
 * CJK, emoji, combining marks, multi-segment SGR, OSC 8, tabs. These tests
 * deliberately pin the dependency's semantics: a pi-tui upgrade that breaks
 * any of them must turn this suite red before it can crash a session. The
 * fakes that used to cover this space counted codepoints and were exact
 * only for ASCII (the D39 lesson).
 */

import { describe, expect, it } from 'vitest'
import { truncateToWidth, visibleWidth } from '../src/width.ts'

/**
 * Deterministic corpus: every width-interestful input shape, each carrying
 * the shapes a component can realistically assemble into one row.
 */
const CORPUS: ReadonlyArray<{ name: string, text: string }> = [
  { name: 'ascii-short', text: 'hello blue' },
  { name: 'ascii-unbroken-200', text: 'x'.repeat(200) },
  {
    name: 'bash-24-segments (#18 shape)',
    text: Array.from({ length: 24 }, (_, n) => `grep -rn -i "publish\\|npm publish" docs/p${n} 2>/dev/null`).join(' && '),
  },
  { name: 'cjk-long', text: '你好，世界。'.repeat(8) },
  { name: 'cjk-mixed', text: '在 blue 里跑 dsh 的 插件 — 渲染宽度守卫 崩溃族 #18 修复' },
  { name: 'fullwidth-forms', text: '！？ＡＢＣ１２３' },
  { name: 'emoji-bmp', text: '👍✅✨ done 👍✅✨' },
  { name: 'emoji-zwj-family', text: '👨‍👩‍👧‍👦 running 👨‍👩‍👧‍👦' },
  { name: 'emoji-skin-tone', text: '✌🏽 peace ✌🏽' },
  { name: 'emoji-flags', text: '🇨🇳🇩🇪 flags' },
  { name: 'combining-marks', text: 'é́ café' },
  {
    name: 'sgr-multi-segment',
    text: '\x1b[38;2;189;147;249m$\x1b[39m \x1b[38;2;136;136;136mcd docs && grep -rn "publish" .\x1b[39m\x1b[0m',
  },
  {
    name: 'sgr-at-boundary',
    text: `\x1b[31m${'a'.repeat(20)}\x1b[39m\x1b[1m${'b'.repeat(20)}\x1b[22m${'c'.repeat(20)}`,
  },
  { name: 'osc8-hyperlink', text: '\x1b]8;;https://example.com/a/very/long/path/segment\x07link text\x1b]8;;\x07 tail' },
  { name: 'tabs', text: 'col1\tcol2\tvalue-with-tabs' },
  { name: 'empty-and-newlineish', text: '' },
]

describe('width utilities (pi-tui semantics)', () => {
  it('measures CJK and styled CJK as two columns', () => {
    expect(visibleWidth('中')).toBe(2)
    expect(visibleWidth('\x1b[31m中\x1b[0m')).toBe(2)
    expect(visibleWidth('中文')).toBe(4)
    // Combining marks add nothing; the base character stands alone.
    expect(visibleWidth('é')).toBe(1)
  })

  it('truncation never exceeds the width, at any width for any corpus shape', () => {
    for (const { name, text } of CORPUS) {
      for (let width = 1; width <= 120; width += 1) {
        const truncated = truncateToWidth(text, width)
        const measured = visibleWidth(truncated)
        expect(measured, `${name} at width ${width}: ${JSON.stringify(truncated)}`).toBeLessThanOrEqual(width)
      }
    }
  })

  it('truncation is idempotent: a truncated row re-truncates to itself', () => {
    for (const { name, text } of CORPUS) {
      const once = truncateToWidth(text, 40)
      expect(truncateToWidth(once, 40), name).toBe(once)
    }
  })

  it('fits pass through untouched', () => {
    const text = 'short row'
    expect(truncateToWidth(text, 40)).toBe(text)
  })

  it('the custom ellipsis is honored and still width-bounded', () => {
    for (const { text } of CORPUS) {
      const truncated = truncateToWidth(text, 30, '…')
      expect(visibleWidth(truncated)).toBeLessThanOrEqual(30)
    }
  })
})

/** mulberry32, mirroring the harness mock-server's seededRandom. */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61)
    return ((mixed ^ mixed >>> 14) >>> 0) / 0x1_0000_0000
  }
}

describe('width property under seeded random strings', () => {
  const SEED = 0xc0ffee

  /** Character pools covering the width classes the corpus holds. */
  const POOLS = [
    () => 'abcdefghijklmnopqrstuvwxyz0123456789 .-$|&"\'',
    () => '中文汉字全角！？。',
    () => '👍✨✅✌🏽👨‍👩‍👧‍👦🇨🇳',
    () => '\x1b[31m\x1b[39m\x1b[1m\x1b[22m\x1b[0m',
    () => '\t',
  ] as const

  function randomString(random: () => number, length: number): string {
    let out = ''
    for (let n = 0; n < length; n += 1) {
      const pool = POOLS[Math.floor(random() * POOLS.length)]!()
      out += pool[Math.floor(random() * pool.length)]!
    }
    return out
  }

  it(`seed ${SEED}: 500 random strings never truncate past their width`, () => {
    const random = seededRandom(SEED)
    for (let n = 0; n < 500; n += 1) {
      const text = randomString(random, 1 + Math.floor(random() * 180))
      for (let width = 1; width <= 120; width += 7) {
        const truncated = truncateToWidth(text, width)
        const measured = visibleWidth(truncated)
        expect(measured, `seed ${SEED} sample ${n} width ${width}: ${JSON.stringify(text)}`).toBeLessThanOrEqual(width)
      }
    }
  })
})
