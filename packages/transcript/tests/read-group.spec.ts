/**
 * The ReadGroupComponent: the kimi read-group port — header phases
 * (reading/done/failed), the `├─/└─` tree with per-member line counts,
 * path-less members, attach/rebuild caching, and width discipline.
 */

import { describe, expect, it } from 'vitest'
import type { BlueSemanticColors } from '@dsh-blue/blue-core'
import { ReadGroupComponent } from '../src/read-group.ts'
import type { TranscriptToolItem } from '../src/types.ts'
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

/** Tagged colors for role assertions. */
function tagged(): BlueSemanticColors {
  const tag = (letter: string) => (text: string): string => `[${letter}]${text}[/${letter}]`
  return {
    ...COLORS,
    muted: tag('M'),
    textMuted: tag('T'),
    primary: tag('P'),
    success: tag('S'),
    error: tag('E'),
  }
}

/** One Read member; `path` lands in `file_path` when given. */
function readMember(
  partial: Partial<TranscriptToolItem> & { path?: string } = {},
): TranscriptToolItem {
  const { path, ...rest } = partial
  return {
    kind: 'tool', seq: 1, callId: 'c1', name: 'read', arguments: '{}',
    ...(path === undefined ? {} : { parsedArguments: { file_path: path } }),
    ...rest,
  }
}

/** A settled member with a line count. */
function done(member: TranscriptToolItem, lines: number): TranscriptToolItem {
  member.result = { text: Array.from({ length: lines }, (_, n) => `l${n}`).join('\n'), isError: false }
  return member
}

describe('ReadGroupComponent', () => {
  it('renders the reading header while members run', () => {
    const group = new ReadGroupComponent(readMember({ path: 'a.ts' }), tagged(), fakeBlueComponents())
    group.attach(readMember({ seq: 2, callId: 'c2', path: 'b.ts' }))
    expect(group.render(80)).toEqual([
      '',
      '● \x1b[1m[P]Reading 2 files…[/P]\x1b[22m',
      '  ├─ a.ts[M] · reading…[/M]',
      '  └─ b.ts[M] · reading…[/M]',
    ])
  })

  it('renders the settled header with the line count and the tree', () => {
    const group = new ReadGroupComponent(done(readMember({ path: 'a.ts' }), 3), tagged(), fakeBlueComponents())
    // The second member carries its path through the `path` arg key instead.
    group.attach(done({
      ...readMember({ seq: 2, callId: 'c2' }),
      parsedArguments: { path: 'b.ts' },
    }, 1))
    expect(group.render(80)).toEqual([
      '',
      '[S]✓ [/S]\x1b[1m[P]Read 2 files[/P]\x1b[22m[M] · 4 lines[/M]',
      '  ├─ a.ts[M] · 3 lines[/M]',
      '  └─ b.ts[M] · 1 line[/M]',
    ])
  })

  it('marks failed members in the tree and the header', () => {
    const group = new ReadGroupComponent(done(readMember({ path: 'a.ts' }), 2), tagged(), fakeBlueComponents())
    const failed = readMember({ seq: 2, callId: 'c2', path: 'gone.ts' })
    failed.result = { text: 'missing', isError: true }
    group.attach(failed)
    expect(group.render(80)).toEqual([
      '',
      '[S]✓ [/S]\x1b[1m[P]Read 2 files[/P]\x1b[22m[M] · 2 lines[/M][E] · 1 failed[/E]',
      '  ├─ a.ts[M] · 2 lines[/M]',
      '  └─ gone.ts[E] · failed[/E]',
    ])
  })

  it('renders the all-failed header', () => {
    const member = readMember({ path: 'x.ts' })
    member.result = { text: 'no', isError: true }
    const group = new ReadGroupComponent(member, tagged(), fakeBlueComponents())
    expect(group.render(80)[1]).toBe(
      '[E]✗ [/E]\x1b[1m[E]Read 1 files[/E]\x1b[22m[E] · failed[/E]')
  })

  it('keeps path-less members header-only', () => {
    const group = new ReadGroupComponent(done(readMember(), 1), tagged(), fakeBlueComponents())
    // No parsed arguments at all, an empty path string, and non-object
    // arguments all yield no tree row.
    group.attach(readMember({ seq: 2, callId: 'c2' }))
    group.attach(readMember({ seq: 3, callId: 'c3', parsedArguments: { file_path: '' } }))
    group.attach(readMember({ seq: 4, callId: 'c4', parsedArguments: 'not-an-object' }))
    const lines = group.render(80)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('Reading 4 files…')
  })

  it('rebuilds when a member settles and after attach', () => {
    const components = fakeBlueComponents()
    const member = readMember({ path: 'a.ts' })
    const group = new ReadGroupComponent(member, COLORS, components)
    const pending = group.render(80)
    expect(group.render(80)).toBe(pending)
    done(member, 1)
    expect(group.render(80)).not.toBe(pending)

    const settled = group.render(80)
    group.attach(readMember({ seq: 2, callId: 'c2', path: 'b.ts' }))
    expect(group.render(80)).not.toBe(settled)
  })

  it('keeps every row within the viewport width', () => {
    const components = fakeBlueComponents()
    const member = readMember({ path: 'a-very-long-path-name.ts' })
    done(member, 1)
    const group = new ReadGroupComponent(member, COLORS, components)
    for (const line of group.render(10)) {
      expect(components.visibleWidth(line)).toBeLessThanOrEqual(10)
    }
  })
})
