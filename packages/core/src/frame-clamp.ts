/**
 * The render-exit width backstop (D48). pi-tui's main-screen guard crashes
 * the process when any rendered line exceeds the terminal width — the right
 * fail-loud behavior for dogfooding, but a user session dies with it. This
 * module clamps every frame line at the one seam that sees the complete
 * flat output before pi-tui's differential writer (the dock-filling
 * `render` wrapper in terminal.ts), so an over-wide component line degrades
 * to a truncated row plus one deduplicated log entry instead of a crash.
 *
 * @module @dsh-blue/blue-core/frame-clamp
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { sliceByColumn, visibleWidth } from './width.ts'

/** One clamped frame line, as logged. `line` doubles as the dedupe key. */
export interface FrameOverflowEntry {
  /** The clamped line's index within the frame. */
  readonly index: number
  /** The viewport width the line was clamped to. */
  readonly columns: number
  /** The line's original visible width. */
  readonly width: number
  /** The original, unclamped line. */
  readonly line: string
}

/** Receives clamped-line records; implementations must never throw. */
export interface OverflowSink {
  record(entry: FrameOverflowEntry): void
}

/**
 * Clamp every line of a rendered frame to `width` visible columns.
 * Over-wide lines are hard-sliced with `sliceByColumn` (strict: a wide
 * character straddling the boundary is dropped, never overflowed — no
 * ellipsis, the last-resort guard stays absolutely safe). A clean frame
 * returns the input array itself (no copy); `sink`, when given, records
 * each clamped line once per call.
 * @param lines - the rendered frame.
 * @param width - the viewport width, the same value pi-tui's guard checks.
 * @param sink - where clamped-line records go; never throws.
 * @returns the frame to hand to pi-tui, every line `visibleWidth <= width`.
 */
export function clampFrame(lines: string[], width: number, sink?: OverflowSink): string[] {
  let clamped: string[] | undefined
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (visibleWidth(line) <= width) continue
    clamped ??= [...lines]
    clamped[index] = sliceByColumn(line, 0, width, true)
    sink?.record({ index, columns: width, width: visibleWidth(line), line })
  }
  return clamped ?? lines
}

/**
 * pi-tui's own log-directory chain (`PI_CODING_AGENT_DIR ?? ~/.pi/agent`),
 * so `blue-overflow.log` lands next to `pi-crash.log`.
 * @returns the directory for the default overflow sink.
 */
export function defaultOverflowDirectory(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
}

/** Options for the file-backed overflow sink. */
export interface FileOverflowSinkOptions {
  /** Directory to create on first write; holds `blue-overflow.log`. */
  readonly directory: string
  /** Cap on distinct logged lines (and so on file lines); default 200. */
  readonly maxEntries?: number
}

/**
 * Deduplicating JSONL overflow log. Each distinct original line is appended
 * once (renders repeat at 16ms; without dedupe a single over-wide row would
 * flood the file), capped at `maxEntries` distinct entries. Every filesystem
 * failure is swallowed — the backstop must never take rendering down with
 * it. Entries look like
 * `{"time":"...","index":3,"columns":40,"width":61,"line":"..."}`.
 * @param options - target directory and cap.
 * @returns the file-backed `OverflowSink`.
 */
export function createFileOverflowSink(options: FileOverflowSinkOptions): OverflowSink {
  const { directory, maxEntries = 200 } = options
  const seen = new Set<string>()
  return {
    record(entry) {
      if (seen.size >= maxEntries || seen.has(entry.line)) return
      seen.add(entry.line)
      try {
        mkdirSync(directory, { recursive: true })
        appendFileSync(
          join(directory, 'blue-overflow.log'),
          `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`,
        )
      } catch {
        // The backstop's own log must never break rendering.
      }
    },
  }
}
