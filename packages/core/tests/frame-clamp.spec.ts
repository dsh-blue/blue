/**
 * The render-exit width backstop (D48): `clampFrame` line surgery, the
 * file sink's dedupe/cap/error posture, and the log-directory chain.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { visibleWidth } from '../src/width.ts'
import {
  clampFrame,
  createFileOverflowSink,
  defaultOverflowDirectory,
  type FrameOverflowEntry,
} from '../src/frame-clamp.ts'
import { mkdtempTracked, registerTempDirCleanup } from './temp-dir.ts'

registerTempDirCleanup()

/** A recorder sink: keeps every entry, never throws. */
function recordingSink(): { entries: FrameOverflowEntry[]; sink: { record(entry: FrameOverflowEntry): void } } {
  const entries: FrameOverflowEntry[] = []
  return { entries, sink: { record: (entry) => entries.push(entry) } }
}

describe('clampFrame', () => {
  it('returns a clean frame untouched, as the same array', () => {
    const lines = ['short', '', '\x1b[31mstyled\x1b[0m']
    expect(clampFrame(lines, 10)).toBe(lines)
  })

  it('handles the empty frame and a missing sink', () => {
    expect(clampFrame([], 10)).toEqual([])
    expect(clampFrame(['over-wide'.repeat(10)], 10)).toHaveLength(1)
  })

  it('hard-slices an over-wide ASCII line to the width and records it', () => {
    const { entries, sink } = recordingSink()
    const line = 'x'.repeat(60)
    const frame = clampFrame(['keep', line], 40, sink)
    expect(frame[0]).toBe('keep')
    expect(visibleWidth(frame[1]!)).toBe(40)
    expect(frame[1]).toBe('x'.repeat(40))
    expect(entries).toEqual([{ index: 1, columns: 40, width: 60, line }])
  })

  it('drops a wide character straddling the boundary instead of overflowing', () => {
    // Three full-width characters: 6 visible columns clamped to 5 must lose
    // the third (strict slice) rather than render 6 columns.
    const frame = clampFrame(['中文呢'], 5)
    expect(visibleWidth(frame[0]!)).toBeLessThanOrEqual(5)
    expect(frame[0]).toBe('中文')
  })

  it('clamps through multi-segment SGR styling without exceeding the width', () => {
    const line = `\x1b[38;2;189;147;249m$\x1b[39m \x1b[38;2;136;136;136m${'grep -rn "publish" docs/ | head -40 '.repeat(4)}\x1b[39m\x1b[0m`
    const frame = clampFrame([line], 40)
    expect(visibleWidth(frame[0]!)).toBeLessThanOrEqual(40)
    expect(frame[0]).toContain('grep')
  })

  it('keeps clean neighbors and their positions when one line clamps', () => {
    const frame = clampFrame(['a', 'bb', 'ccc'.repeat(20), 'dd'], 10)
    expect(frame[0]).toBe('a')
    expect(frame[1]).toBe('bb')
    expect(visibleWidth(frame[2]!)).toBeLessThanOrEqual(10)
    expect(frame[3]).toBe('dd')
  })
})

describe('defaultOverflowDirectory', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.PI_CODING_AGENT_DIR
  })

  it('honors PI_CODING_AGENT_DIR, matching pi-tui\'s own chain', () => {
    vi.stubEnv('PI_CODING_AGENT_DIR', '/tmp/blue-spec-agent')
    expect(defaultOverflowDirectory()).toBe('/tmp/blue-spec-agent')
  })

  it('falls back to ~/.pi/agent when the variable is unset', () => {
    delete process.env.PI_CODING_AGENT_DIR
    expect(defaultOverflowDirectory()).toContain(join('.pi', 'agent'))
  })
})

describe('createFileOverflowSink', () => {
  it('appends each distinct line once as JSONL and creates the directory', () => {
    const root = mkdtempTracked('blue-clamp-sink-')
    const directory = join(root, 'nested', 'logs')
    const sink = createFileOverflowSink({ directory })
    const entry: FrameOverflowEntry = { index: 3, columns: 40, width: 61, line: 'over-wide row' }
    sink.record(entry)
    sink.record(entry)
    const file = join(directory, 'blue-overflow.log')
    expect(existsSync(file)).toBe(true)
    const rows = readFileSync(file, 'utf8').trim().split('\n')
    expect(rows).toHaveLength(1)
    const parsed = JSON.parse(rows[0]!) as { time: string } & FrameOverflowEntry
    expect(parsed).toMatchObject({ index: 3, columns: 40, width: 61, line: 'over-wide row' })
    expect(typeof parsed.time).toBe('string')

    sink.record({ ...entry, line: 'another row' })
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2)
  })

  it('stops writing once maxEntries distinct lines are logged', () => {
    const directory = mkdtempTracked('blue-clamp-cap-')
    const sink = createFileOverflowSink({ directory, maxEntries: 2 })
    for (let n = 0; n < 4; n += 1) {
      sink.record({ index: n, columns: 40, width: 50, line: `row-${n}` })
    }
    const rows = readFileSync(join(directory, 'blue-overflow.log'), 'utf8').trim().split('\n')
    expect(rows).toHaveLength(2)
  })

  it('swallows filesystem failures without throwing', () => {
    // A regular file where the directory should be: mkdirSync cannot win.
    const root = mkdtempTracked('blue-clamp-err-')
    const blocked = join(root, 'blocked')
    writeFileSync(blocked, 'not a directory')
    const sink = createFileOverflowSink({ directory: join(blocked, 'logs') })
    expect(() => sink.record({ index: 0, columns: 40, width: 41, line: 'x'.repeat(41) })).not.toThrow()
  })
})
