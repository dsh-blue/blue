/**
 * The VT snapshot harness (R2): a FakeTerminal subclass that mirrors every
 * byte the renderer writes into a real headless terminal (@xterm/headless),
 * so a golden frame is exactly what a real terminal's screen grid would
 * hold — the layout regression lock the logical-layer specs cannot provide
 * (the D48 width-crash family shipped green through them). The recording
 * semantics (`written`, `sendInput`, `resize`) stay intact for the e2e
 * helpers, so `bootBlue({ terminal: new VtTerminal(...) })` boots the same
 * tree with the grid attached. Golden frames are normalized through
 * `cwdNormalizer` (the banner and the footer paint the checkout's cwd in
 * three shapes; snapshots must not vary by worktree name).
 */

import { Terminal } from '@xterm/headless'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import { FakeTerminal } from '../../../core/tests/fake-terminal.ts'
import { shortenCwd } from '../../../transcript/src/status-cwd.ts'
import { shortenHome } from '../../../transcript/src/banner.ts'

export class VtTerminal extends FakeTerminal {
  private readonly vt: Terminal

  constructor(columns = 80, rows = 24) {
    super(columns, rows)
    // Deep scrollback: a golden frame dumps the whole buffer (the transcript
    // can exceed the viewport), and a forced full repaint clears it first.
    // allowProposedApi: buffer.type (the alt-screen guard) is proposed API.
    this.vt = new Terminal({ cols: columns, rows, scrollback: 10_000, allowProposedApi: true })
  }

  override write(data: string): void {
    super.write(data)
    this.vt.write(data)
  }

  override resize(columns: number, rows: number): void {
    super.resize(columns, rows)
    this.vt.resize(columns, rows)
  }

  /**
   * Resolve once every byte written so far has been parsed: the callback
   * fires after the parser drains the queue.
   */
  flush(): Promise<void> {
    return new Promise<void>(resolve => { this.vt.write('', resolve) })
  }

  /**
   * The whole screen as text: every buffer line (scrollback included,
   * trimmed right) joined by newlines. Refuses the alternate buffer — Blue
   * is main-screen-only by design, and entering alt would mean a renderer
   * regression worth failing on.
   */
  async frame(normalize?: (row: string) => string): Promise<string> {
    await this.flush()
    const buffer = this.vt.buffer.active
    if (buffer.type !== 'normal') throw new Error('VT entered the alternate buffer — Blue renders on the main screen')
    const rows: string[] = []
    for (let y = 0; y < buffer.baseY + this.vt.rows; y += 1) {
      rows.push(buffer.getLine(y)?.translateToString(true) ?? '')
    }
    const text = rows.join('\n')
    return normalize === undefined ? text : text.split('\n').map(normalize).join('\n')
  }

  /** The width class of one viewport cell (2 wide, 0 trailing, 1 normal). */
  cellWidth(x: number, y: number): number {
    const buffer = this.vt.buffer.active
    return buffer.getLine(buffer.baseY + y)?.getCell(x)?.getWidth() ?? 0
  }

  /** The characters of one viewport cell. */
  cellChar(x: number, y: number): string {
    const buffer = this.vt.buffer.active
    return buffer.getLine(buffer.baseY + y)?.getCell(x)?.getChars() ?? ''
  }

  dispose(): void {
    this.vt.dispose()
  }
}

/**
 * Replace every shape this checkout's cwd paints with stable tokens: the
 * banner's home-tilde path, the footer's last-segments abbreviation, and
 * bare names — each possibly TRUNCATED at any segment boundary by a narrow
 * viewport, so the substitution runs over every path-segment prefix
 * (longest first) and a truncation still collapses to `«cwd»/…` (a single token: which shape a given slot paints is the golden's own fact, and per-shape tokens drifted by checkout depth).
 */
export function cwdNormalizer(): (row: string) => string {
  const cwd = process.cwd()
  const home = homedir()
  const homeShape = shortenHome(cwd, home)
  const cwdShape = shortenCwd(cwd, home)
  const substitutions: Array<[string, string]> = []
  const collect = (shape: string, token: string): void => {
    const segments = shape.split('/')
    for (let end = segments.length; end >= 2; end -= 1) {
      const prefix = segments.slice(0, end).join('/')
      if (prefix.length >= 2) substitutions.push([prefix, token])
    }
  }
  collect(homeShape, '«cwd»')
  collect(cwdShape, '«cwd»')
  collect(cwd, '«cwd»')
  substitutions.push([basename(cwd), '«cwd»'])
  substitutions.sort((left, right) => right[0].length - left[0].length)
  const seen = new Set<string>()
  const unique = substitutions.filter(([from]) => {
    if (seen.has(from)) return false
    seen.add(from)
    return true
  })
  return row => {
    let out = row
    for (const [from, to] of unique) out = out.replaceAll(from, to)
    // Truncation tails vary by path LENGTH (a deep checkout truncates, a
    // shallow one shows whole), so collect every stub/tail form into the
    // bare token — the truncation threshold itself is unit-tested upstream.
    out = out.replace(/«cwd»\/[A-Za-z0-9._-]{1,12}\.\.\./g, '«cwd»')
    out = out.replace(/«cwd»(\/…|\.\.\.|…)/g, '«cwd»')
    return out.trimEnd()
  }
}
