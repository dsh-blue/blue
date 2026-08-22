/**
 * The width-scan contract harness (D48): renders a component at a sweep of
 * viewport widths against adversarial content and asserts the
 * `BlueComponent` contract — every output line's VISIBLE width stays within
 * the width it was given (core/src/types.ts states it; the render-exit
 * clamp backstops it, but a clamped row is still a component bug). Shared
 * across packages by relative import, the temp-dir.ts pattern.
 *
 * @module blue-core-tests/width-scan
 */

import { expect } from 'vitest'
import { visibleWidth } from '../src/width.ts'

/** Viewports every scanned component must survive, wide to brutally narrow. */
export const SCAN_WIDTHS = [120, 80, 60, 40, 20, 10, 5, 3, 2] as const

/** Adversarial content shapes, named for the failure they hunt. */
export const ADVERSARIAL: ReadonlyArray<{ name: string, text: string }> = [
  {
    name: 'bash-24-segments (#18)',
    text: Array.from(
      { length: 24 },
      (_, n) => `grep -rn -i "publish\\|npm publish" docs/p${n} 2>/dev/null | grep -iv "published npm release" | head -40`,
    ).join(' && '),
  },
  { name: 'unbroken-200', text: 'x'.repeat(200) },
  { name: 'cjk-heavy', text: '你好，世界。宽度守卫崩溃族修复：中文长句不会被截断工具正确处理时的形状。'.repeat(2) },
  { name: 'emoji-zwj', text: '👨‍👩‍👧‍👦✌🏽🇨🇳 ✨👍 family flags tone spark' },
  {
    name: 'ansi-laden',
    text: '\x1b[38;2;189;147;249mstyled\x1b[39m \x1b[1mbold\x1b[22m \x1b[31mred\x1b[0m \x1b[3mital\x1b[23m tail' ,
  },
  { name: 'osc8-link', text: '\x1b]8;;https://example.com/very/long/link/path\x07label\x1b]8;;\x07 rest' },
  { name: 'tabbed', text: 'col1\tcol2\ttail' },
  { name: 'path-long', text: '/home/x/dev/deepseek-harness-plugin/blue/blue/.claude/worktrees/some-deep-checkout-name/src' },
]

/**
 * Assert a rendered frame honors the width contract.
 * @param componentName - the component under scan, for the failure message.
 * @param lines - the component's `render(width)` output.
 * @param width - the width it was rendered at.
 */
export function expectLinesFit(componentName: string, lines: string[], width: number): void {
  for (const [index, line] of lines.entries()) {
    const measured = visibleWidth(line)
    expect(
      measured,
      `${componentName} rendered row ${index} at ${measured} columns for width ${width}: ${JSON.stringify(line)}`,
    ).toBeLessThanOrEqual(width)
  }
}
