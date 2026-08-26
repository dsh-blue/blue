/**
 * L0 terminal runtime: lifecycle, Blue-typed delegation through the stable
 * reference, overlay focus discipline on a real `TuiMainScreen`, the OSC 11
 * probe ordering, terminal color-scheme forwarding, the suspend/resume seam
 * (S31), and the `installFailLoud` release factory.
 */

import { describe, expect, it } from 'vitest'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { CURSOR_MARKER, type TUI } from '@earendil-works/pi-tui'
import type { BlueComponent, BlueFocusable, BlueRgbColor } from '../src/types.ts'
import { createStableTuiReference, createTerminalRelease, normalizeWheelInput, startBlueTerminal } from '../src/terminal.ts'
import type { FrameOverflowEntry } from '../src/frame-clamp.ts'
import type { AmbientOutputStream } from '../src/output-recovery.ts'
import { visibleWidth } from '../src/width.ts'
import { FakeTerminal, waitForRender } from './fake-terminal.ts'

/** A background probe that never answers, for tests indifferent to it. */
function noProbe(): Promise<BlueRgbColor | undefined> {
  return Promise.resolve(undefined)
}

/**
 * Drop the writer-level control wrappers pi-tui adds around raw writes but
 * never includes in the frame lines its width guard checks: the
 * synchronized-output mode (CSI ? 2026 h/l) — whose `?` private parameter
 * `visibleWidth` does not strip — and the OSC 8 hyperlink close.
 */
function stripWriterWrappers(row: string): string {
  return row.replace(/\x1b\[\?2026[hl]/g, '').replace(/\x1b\]8;;\x07/g, '')
}

function textComponent(text: string): BlueComponent {
  return {
    render: () => [text],
    invalidate: () => {},
  }
}

function focusableComponent(text: string): BlueFocusable {
  return {
    focused: false,
    render: () => [text],
    invalidate: () => {},
  }
}

class AltScreenTerminal extends FakeTerminal {
  private readonly vt: HeadlessTerminal

  constructor(columns = 40, rows = 10) {
    super(columns, rows)
    this.vt = new HeadlessTerminal({ cols: columns, rows, scrollback: 1000, allowProposedApi: true })
  }

  override write(data: string): void {
    super.write(data)
    this.vt.write(data)
  }

  externalWrite(data: string): void {
    this.vt.write(data)
  }

  async screen(): Promise<string[]> {
    await new Promise<void>(resolve => this.vt.write('', resolve))
    const buffer = this.vt.buffer.active
    return Array.from({ length: this.vt.rows }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? '')
  }

  async bufferType(): Promise<string> {
    await new Promise<void>(resolve => this.vt.write('', resolve))
    return this.vt.buffer.active.type
  }

  dispose(): void {
    this.vt.dispose()
  }
}

class TerminalOutputStream implements AmbientOutputStream {
  constructor(private readonly terminal: AltScreenTerminal) {}

  write = ((chunk: string | Uint8Array, encodingOrCallback?: BufferEncoding | (() => void), callback?: () => void): boolean => {
    this.terminal.externalWrite(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
    if (typeof encodingOrCallback === 'function') encodingOrCallback()
    callback?.()
    return true
  }) as NodeJS.WriteStream['write']
}

describe('startBlueTerminal', () => {
  it('starts the renderer on the given terminal', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    expect(terminal.startCount).toBe(1)
    expect(runtime.columns).toBe(80)
    expect(runtime.rows).toBe(24)
    terminal.resize(100, 40)
    expect(runtime.rows).toBe(40)
    return runtime.stop()
  })

  it('leaves mouse reporting disabled so native terminal selection remains available', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)

    expect(terminal.output).not.toContain('\x1b[?1000h')
    expect(terminal.output).not.toContain('\x1b[?1002h')
    expect(terminal.output).not.toContain('\x1b[?1004h')
    expect(terminal.output).not.toContain('\x1b[?1006h')

    await runtime.stop()

    expect(terminal.output).not.toContain('\x1b[?1000l')
    expect(terminal.output).not.toContain('\x1b[?1002l')
    expect(terminal.output).not.toContain('\x1b[?1004l')
    expect(terminal.output).not.toContain('\x1b[?1006l')
  })

  it('runs the probe before the terminal starts and maps the reply', async () => {
    const terminal = new FakeTerminal()
    let startCountAtProbe = -1
    const probe = () => {
      startCountAtProbe = terminal.startCount
      return Promise.resolve({ r: 255, g: 255, b: 255 })
    }
    const runtime = await startBlueTerminal(terminal, probe)
    expect(startCountAtProbe).toBe(0)
    expect(runtime.background).toBe('light')
    await runtime.stop()

    const dark = await startBlueTerminal(new FakeTerminal(), () => Promise.resolve({ r: 0, g: 0, b: 0 }))
    expect(dark.background).toBe('dark')
    await dark.stop()

    const unknown = await startBlueTerminal(new FakeTerminal(), noProbe)
    expect(unknown.background).toBeUndefined()
    await unknown.stop()
  })

  it('exposes the Kitty protocol state and the stable TUI reference', async () => {
    const terminal = new FakeTerminal()
    terminal.kittyActive = true
    const runtime = await startBlueTerminal(terminal, noProbe)
    expect(runtime.kittyKeyboard).toBe(true)
    expect(runtime.tui.children).toEqual([])
    await runtime.stop()
  })

  it('writes a sanitized OSC 0 title straight through the terminal', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    runtime.setTitle('fix the login\x1b]0;pwned\x07 bug')
    // The title write is the terminal's latest: one raw write carries the
    // whole sequence, its payload sanitized (the injected OSC and BEL
    // vanish), so the title slot stays the only sequence in it.
    expect(terminal.written.at(-1)).toBe('\x1b]0;fix the login]0;pwned bug\x07')
    await runtime.stop()
  })

  it('enables scheme notifications and forwards reports through the callback', async () => {
    const terminal = new FakeTerminal()
    const schemes: ('dark' | 'light')[] = []
    const runtime = await startBlueTerminal(terminal, noProbe, scheme => schemes.push(scheme))
    // Mode 2031 notifications are requested right after start.
    expect(terminal.output).toContain('\x1b[?2031h')

    terminal.sendInput('\x1b[?997;2n')
    terminal.sendInput('\x1b[?997;1n')
    expect(schemes).toEqual(['light', 'dark'])

    await runtime.stop()
    // Stopping disables the notification mode again.
    expect(terminal.output).toContain('\x1b[?2031l')
  })

  it('tolerates scheme reports without a registered callback', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    terminal.sendInput('\x1b[?997;2n')
    await runtime.stop()
  })

  it('renders mounted components to the terminal', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    runtime.addChild(textComponent('hello blue'))
    runtime.requestRender()
    await waitForRender()
    expect(terminal.output).toContain('hello blue')

    runtime.removeChild(textComponent('never mounted'))
    runtime.requestRender(true)
    await waitForRender()
    await runtime.stop()
  })

  it('renders bottom-pinned components after content mounted later', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    // The editor pins first; transcript rows mount afterwards (session start)
    // and must still render above it.
    const editor = textComponent('bottom-editor')
    runtime.addBottomChild(editor)
    runtime.addChild(textComponent('transcript-one'))
    runtime.addChild(textComponent('transcript-two'))
    runtime.requestRender()
    await waitForRender()
    const output = terminal.output
    expect(output.indexOf('transcript-one')).toBeLessThan(output.indexOf('bottom-editor'))
    expect(output.indexOf('transcript-two')).toBeLessThan(output.indexOf('bottom-editor'))
    expect(output.indexOf('transcript-one')).toBeLessThan(output.indexOf('transcript-two'))

    // Unmounting the pin leaves plain mounts intact: the forced redraw's
    // final write carries the transcript rows and no bottom-editor.
    runtime.removeChild(editor)
    runtime.requestRender(true)
    await waitForRender()
    const redraw = terminal.written.at(-1) ?? ''
    expect(redraw).toContain('transcript-one')
    expect(redraw).toContain('transcript-two')
    expect(redraw).not.toContain('bottom-editor')
    await runtime.stop()
  })

  it('sinks the bottom dock to the last rows when content is shorter than the viewport', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    runtime.addBottomChild(textComponent('dock-row'))
    runtime.addChild(textComponent('content-row'))
    runtime.requestRender(true)
    await waitForRender()
    const frame = terminal.written.at(-1) ?? ''
    const rows = frame.split('\r\n')
    // Twenty-four terminal rows: content first, blank filler between, the
    // dock on the very last row.
    expect(rows).toHaveLength(24)
    expect(rows[0]).toContain('content-row')
    expect(rows.findIndex(row => row.includes('dock-row'))).toBe(23)
    await runtime.stop()
  })

  it('keeps the bottom dock visible when content exceeds the viewport', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    runtime.addBottomChild(textComponent('dock-row'))
    runtime.addChild({
      render: () => Array.from({ length: 30 }, (_, index) => `row-${index}`),
      invalidate: () => {},
    })
    runtime.requestRender(true)
    await waitForRender()
    const frame = terminal.written.at(-1) ?? ''
    const rows = frame.split('\r\n')
    // The newest content rows are retained, while the dock remains visible in
    // the terminal tail instead of being pushed below the viewport.
    expect(rows).toHaveLength(24)
    expect(rows[23]).toContain('dock-row')
    expect(rows[0]).toContain('row-7')
    await runtime.stop()
  })

  it('routes keyboard scroll input through the content handler', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    runtime.addBottomChild(textComponent('dock-row'))
    runtime.addChild({
      render: () => Array.from({ length: 30 }, (_, index) => `row-${index}`),
      invalidate: () => {},
    })
    runtime.setContentScrollHandler(data => data === '\x1b[A' && runtime.scrollContent('up'))
    runtime.requestRender(true)
    await waitForRender()
    expect(runtime.tui.render(80)[0]).toContain('row-7')
    terminal.sendInput('\x1b[A')
    await waitForRender()
    expect(runtime.tui.render(80)[0]).toContain('row-6')
    await runtime.stop()
  })

  it('pads nothing while no component is mounted', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    runtime.requestRender(true)
    await waitForRender()
    // An empty tree renders no lines at all — no blank flood at boot.
    expect(terminal.written.at(-1) ?? '').not.toContain('\r\n')
    await runtime.stop()
  })

  it('pads nothing without a bottom-pinned component', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    runtime.addChild(textComponent('content-row'))
    runtime.requestRender(true)
    await waitForRender()
    const frame = terminal.written.at(-1) ?? ''
    expect(frame.split('\r\n')).toHaveLength(1)
    await runtime.stop()
  })

  it('clamps over-wide component lines instead of crashing the guard', async () => {
    // Pre-D48 this render died in pi-tui's differential writer: the frame
    // line exceeds the 40-column viewport and the width guard throws out of
    // the render timer. The exit backstop hard-slices it instead.
    const terminal = new FakeTerminal(40)
    const runtime = await startBlueTerminal(terminal, noProbe)
    runtime.addChild({
      render: () => ['x'.repeat(60), '中文'.repeat(30), 'fits'],
      invalidate: () => {},
    })
    runtime.requestRender(true)
    await waitForRender()
    const frame = terminal.written.at(-1) ?? ''
    for (const row of frame.split('\r\n')) {
      expect(visibleWidth(stripWriterWrappers(row))).toBeLessThanOrEqual(40)
    }
    expect(frame).toContain('fits')
    await runtime.stop()
  })

  it('records clamped lines through the injected overflow sink', async () => {
    const terminal = new FakeTerminal(40)
    const entries: FrameOverflowEntry[] = []
    const runtime = await startBlueTerminal(terminal, noProbe, undefined, {
      record: entry => entries.push(entry),
    })
    runtime.addChild(textComponent('y'.repeat(55)))
    runtime.requestRender(true)
    await waitForRender()
    expect(entries).toEqual([{ index: 0, columns: 40, width: 55, line: 'y'.repeat(55) }])
    await runtime.stop()
  })

  it('clamps the dock-filler frame path as well', async () => {
    const terminal = new FakeTerminal(40)
    const runtime = await startBlueTerminal(terminal, noProbe)
    runtime.addBottomChild(textComponent('z'.repeat(52)))
    runtime.addChild(textComponent('content'))
    runtime.requestRender(true)
    await waitForRender()
    const frame = terminal.written.at(-1) ?? ''
    const rows = frame.split('\r\n')
    expect(rows).toHaveLength(24)
    for (const row of rows) {
      expect(visibleWidth(stripWriterWrappers(row))).toBeLessThanOrEqual(40)
    }
    await runtime.stop()
  })

  it('stops idempotently: drains input once and stops the terminal once', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    await runtime.stop()
    await runtime.stop()
    expect(terminal.drainCount).toBe(1)
    expect(terminal.stopCount).toBe(1)
  })

  it('keeps only the newest runtime active for the release', async () => {
    const first = await startBlueTerminal(new FakeTerminal(), noProbe)
    const secondTerminal = new FakeTerminal()
    await startBlueTerminal(secondTerminal, noProbe)
    await first.stop()
    await createTerminalRelease()()
    expect(secondTerminal.stopCount).toBe(1)
  })
})

describe('alternate-screen runtime', () => {
  it('restores editor and footer cells overwritten by a large ambient JSON write', async () => {
    const terminal = new AltScreenTerminal(40, 12)
    const stdout = new TerminalOutputStream(terminal)
    const stderr = new TerminalOutputStream(terminal)
    const runtime = await startBlueTerminal(
      terminal,
      noProbe,
      undefined,
      undefined,
      'alternate',
      { stdout, stderr },
    )
    runtime.addChild({
      render: () => Array.from({ length: 30 }, (_, index) => `transcript-${String(index).padStart(2, '0')}`),
      invalidate: () => {},
    })
    runtime.addBottomChild(textComponent('editor-top'))
    runtime.addBottomChild(textComponent(`editor-draft ${CURSOR_MARKER}`))
    runtime.addBottomChild(textComponent('editor-bottom'))
    runtime.addBottomChild(textComponent('footer-model'), 'bottom')
    runtime.addBottomChild(textComponent('footer-hints'), 'bottom')
    runtime.requestRender(true)
    await waitForRender()

    const clean = await terminal.screen()
    expect(clean.slice(-5)).toEqual([
      'editor-top',
      'editor-draft ',
      'editor-bottom',
      'footer-model',
      'footer-hints',
    ])

    const ambientJson = Array.from({ length: 10 }, (_, index) => {
      return JSON.stringify({ code: `host-${String(index)}-${'x'.repeat(80)}` })
    }).join('\r\n')
    terminal.externalWrite(ambientJson)
    const polluted = await terminal.screen()
    expect(polluted.join('\n')).toContain('host-')

    runtime.requestRender(true)
    await waitForRender()
    stdout.write(ambientJson)
    await waitForRender()
    const recovered = await terminal.screen()
    expect(recovered.join('\n')).not.toContain('host-')
    expect(recovered.slice(-5)).toEqual(clean.slice(-5))

    await runtime.stop()
    terminal.dispose()
  })

  it('releases ambient output during suspend and restores it on resume and stop', async () => {
    const terminal = new AltScreenTerminal(40, 8)
    const stdout = new TerminalOutputStream(terminal)
    const stderr = new TerminalOutputStream(terminal)
    const originalStdoutWrite = stdout.write
    const originalStderrWrite = stderr.write
    const runtime = await startBlueTerminal(
      terminal,
      noProbe,
      undefined,
      undefined,
      'alternate',
      { stdout, stderr },
    )
    const activeStdoutWrite = stdout.write
    expect(activeStdoutWrite).not.toBe(originalStdoutWrite)
    expect(stderr.write).not.toBe(originalStderrWrite)

    await runtime.suspend(async () => {
      expect(stdout.write).toBe(originalStdoutWrite)
      expect(stderr.write).toBe(originalStderrWrite)
    })
    expect(stdout.write).not.toBe(originalStdoutWrite)
    expect(stdout.write).toBe(activeStdoutWrite)

    await runtime.stop()
    expect(stdout.write).toBe(originalStdoutWrite)
    expect(stderr.write).toBe(originalStderrWrite)
    terminal.dispose()
  })

  it('keeps raw wheel reports for the native viewport when no editor handler is installed', async () => {
    const terminal = new AltScreenTerminal(40, 10)
    const runtime = await startBlueTerminal(terminal, noProbe, undefined, undefined, 'alternate')
    runtime.addChild({
      render: () => Array.from({ length: 20 }, (_, index) => `row-${index}`),
      invalidate: () => {},
    })
    runtime.requestRender(true)
    await waitForRender()

    const before = (runtime.tui as TUI & { viewportTop?: number }).viewportTop ?? 0
    expect(before).toBeGreaterThan(0)
    terminal.sendInput('\x1b[<64;1;1M')
    await waitForRender()
    expect((runtime.tui as TUI & { viewportTop?: number }).viewportTop).toBe(before - 3)

    await runtime.stop()
    terminal.dispose()
  })

  it('keeps a focused editor from receiving wheel reports at the scroll boundary', async () => {
    const terminal = new AltScreenTerminal(40, 10)
    const runtime = await startBlueTerminal(terminal, noProbe, undefined, undefined, 'alternate')
    const received: string[] = []
    const editor: BlueFocusable & { handleInput(data: string): void } = {
      focused: false,
      render: () => ['editor'],
      invalidate: () => {},
      handleInput: data => received.push(data),
    }
    runtime.addBottomChild(editor)
    runtime.addChild({
      render: () => Array.from({ length: 20 }, (_, index) => `row-${index}`),
      invalidate: () => {},
    })
    runtime.setFocus(editor)
    runtime.setContentScrollHandler(data => {
      const wheel = normalizeWheelInput(data)
      if (wheel === undefined) return false
      runtime.scrollContent(wheel === '\x1b[A' ? 'up' : 'down', 3)
      return true
    })
    runtime.requestRender(true)
    await waitForRender()

    terminal.sendInput('\x1b[<65;1;1M')
    await waitForRender()
    expect(received).toEqual([])

    await runtime.stop()
    terminal.dispose()
  })

  it('keeps the dock fixed while wheel input scrolls the transcript by three rows', async () => {
    const terminal = new AltScreenTerminal(40, 10)
    const runtime = await startBlueTerminal(terminal, noProbe, undefined, undefined, 'alternate')
    runtime.addBottomChild(textComponent('dock-row'), 'bottom')
    runtime.addChild({
      render: () => Array.from({ length: 20 }, (_, index) => `row-${index}`),
      invalidate: () => {},
    })
    runtime.setContentScrollHandler(data => {
      const normalized = normalizeWheelInput(data)
      return normalized === '\x1b[A' && runtime.scrollContent('up', 3)
    })
    runtime.requestRender(true)
    await waitForRender()

    expect(runtime.tui.mode).toBe('fullscreen')
    expect(terminal.output).toContain('\x1b[?1049h')
    expect(terminal.output).toContain('\x1b[?1002h')
    const tail = await terminal.screen()
    expect(tail.at(-1)).toContain('dock-row')
    expect(tail[0]).toContain('row-11')

    const fullRedraws = runtime.tui.fullRedraws
    const outputAtScroll = terminal.output.length
    terminal.sendInput('\x1b[<64;1;1M')
    await waitForRender()
    const scrolled = await terminal.screen()
    expect(scrolled.at(-1)).toContain('dock-row')
    expect(scrolled[0]).toContain('row-8')
    expect(runtime.tui.fullRedraws).toBe(fullRedraws)
    expect(terminal.output.slice(outputAtScroll)).not.toContain('\x1b[2J')
    expect(runtime.contentChanged()).toBe(true)

    runtime.followContent()
    await waitForRender()
    expect(runtime.contentChanged()).toBe(false)
    await runtime.stop()
    expect(await terminal.bufferType()).toBe('normal')
    expect(terminal.output).toContain('\x1b[?1049l')
    terminal.dispose()
  })

  it('reuses the clamped content frame while child row arrays stay stable', async () => {
    const terminal = new AltScreenTerminal(40, 10)
    const overflows: FrameOverflowEntry[] = []
    const rows = ['x'.repeat(50)]
    const runtime = await startBlueTerminal(
      terminal,
      noProbe,
      undefined,
      { record: entry => overflows.push(entry) },
      'alternate',
    )
    runtime.addChild({ render: () => rows, invalidate: () => {} })
    runtime.requestRender(true)
    await waitForRender()
    const scanned = overflows.length
    expect(scanned).toBeGreaterThan(0)

    runtime.requestRender()
    await waitForRender()
    expect(overflows).toHaveLength(scanned)

    await runtime.stop()
    terminal.dispose()
  })

  it('routes wheel and page keys to a focused replacement panel', async () => {
    const terminal = new FakeTerminal(40, 10)
    const runtime = await startBlueTerminal(terminal, noProbe, undefined, undefined, 'alternate')
    const received: string[] = []
    const panel: BlueFocusable & { handleInput(data: string): void } = {
      focused: false,
      render: () => ['panel'],
      invalidate: () => {},
      handleInput: data => received.push(data),
    }
    runtime.addBottomChild(panel)
    runtime.setFocus(panel)
    runtime.setContentScrollHandler(() => false)

    terminal.sendInput('\x1b[A')
    terminal.sendInput('\x1b[B')
    terminal.sendInput('\x1b[<65;1;1M')
    terminal.sendInput('\x1b[6~')

    expect(received).toEqual(['\x1b[A', '\x1b[B', '\x1b[B', '\x1b[6~'])
    await runtime.stop()
  })

  it('copies a mouse drag selection through OSC 52 outside tmux', async () => {
    const savedTmux = process.env.TMUX
    delete process.env.TMUX
    const terminal = new AltScreenTerminal(40, 8)
    const runtime = await startBlueTerminal(terminal, noProbe, undefined, undefined, 'alternate')
    try {
      runtime.addBottomChild(textComponent('dock-row'))
      runtime.addChild(textComponent('select this text'))
      runtime.requestRender(true)
      await waitForRender()

      terminal.sendInput('\x1b[<0;1;1M')
      terminal.sendInput('\x1b[<32;7;1M')
      terminal.sendInput('\x1b[<0;7;1m')
      await waitForRender()

      expect(terminal.output).toContain('\x1b]52;c;')
      expect(terminal.output).not.toContain('\x1bPtmux;')
      expect(terminal.output).toContain('Copied!')
    } finally {
      if (savedTmux === undefined) delete process.env.TMUX
      else process.env.TMUX = savedTmux
      await runtime.stop()
      terminal.dispose()
    }
  })

  it('reports a failed application-owned clipboard write without breaking selection', async () => {
    const savedTmux = process.env.TMUX
    delete process.env.TMUX
    class FailingClipboardTerminal extends AltScreenTerminal {
      override write(data: string): void {
        if (data.includes('\x1b]52;c;')) throw new Error('clipboard unavailable')
        super.write(data)
      }
    }
    const terminal = new FailingClipboardTerminal(40, 8)
    const runtime = await startBlueTerminal(terminal, noProbe, undefined, undefined, 'alternate')
    try {
      runtime.addChild(textComponent('select this text'))
      runtime.requestRender(true)
      await waitForRender()

      terminal.sendInput('\x1b[<0;1;1M')
      terminal.sendInput('\x1b[<32;7;1M')
      terminal.sendInput('\x1b[<0;7;1m')
      await waitForRender()

      expect(terminal.output).toContain('Copy failed')
    } finally {
      if (savedTmux === undefined) delete process.env.TMUX
      else process.env.TMUX = savedTmux
      await runtime.stop()
      terminal.dispose()
    }
  })

  it('preserves the main screen during suspend and re-enters fullscreen afterwards', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe, undefined, undefined, 'alternate')
    await runtime.suspend(async () => {
      expect(terminal.output.lastIndexOf('\x1b[?1049l')).toBeGreaterThan(terminal.output.lastIndexOf('\x1b[?1049h'))
    })
    expect(terminal.output.lastIndexOf('\x1b[?1049h')).toBeGreaterThan(terminal.output.lastIndexOf('\x1b[?1049l'))
    await runtime.stop()
  })

  it('clamps alternate-screen content through the injected overflow sink', async () => {
    const terminal = new FakeTerminal(20, 8)
    const entries: FrameOverflowEntry[] = []
    const runtime = await startBlueTerminal(terminal, noProbe, undefined, {
      record: entry => entries.push(entry),
    }, 'alternate')
    runtime.addChild(textComponent('x'.repeat(30)))
    runtime.requestRender(true)
    await waitForRender()
    expect(entries).toEqual([{ index: 0, columns: 20, width: 30, line: 'x'.repeat(30) }])
    await runtime.stop()
  })
})

describe('suspend', () => {
  it('releases the renderer around fn and resumes with a full repaint', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    runtime.addChild(textComponent('suspend-frame'))
    runtime.requestRender()
    await waitForRender()
    const startCountBefore = terminal.startCount
    const stopCountBefore = terminal.stopCount

    await expect(runtime.suspend(async () => 42)).resolves.toBe(42)
    expect(terminal.stopCount).toBe(stopCountBefore + 1)
    expect(terminal.startCount).toBe(startCountBefore + 1)
    // Mode 2031 notifications: disabled by the suspend stop, re-armed by the
    // resume — the re-arm must come after the disable.
    const output = terminal.output
    expect(output.lastIndexOf('\x1b[?2031h')).toBeGreaterThan(output.lastIndexOf('\x1b[?2031l'))
    // The forced repaint lands with the mounted content visible again.
    await waitForRender()
    expect(terminal.written.at(-1) ?? '').toContain('suspend-frame')
    await runtime.stop()
  })

  it('runs fn with the renderer already stopped', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    let stopCountInside = -1
    await runtime.suspend(async () => {
      stopCountInside = terminal.stopCount
      // No input handler is attached while suspended; simulated input is a
      // silent no-op, not an error.
      terminal.sendInput('x')
    })
    expect(stopCountInside).toBe(1)
    await runtime.stop()
  })

  it('propagates fn failures after resuming the renderer', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    const startCountBefore = terminal.startCount
    await expect(runtime.suspend(async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')
    expect(terminal.startCount).toBe(startCountBefore + 1)
    await runtime.stop()
  })

  it('rejects a second suspend while one is in flight', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    await runtime.suspend(async () => {
      await expect(runtime.suspend(async () => 1)).rejects.toThrow('already in flight')
    })
    await runtime.stop()
  })

  it('a stop during suspend tears down without draining or re-stopping the renderer', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    const value = await runtime.suspend(async () => {
      await runtime.stop()
      // A child owns the tty: no drain, and the renderer's own suspend stop
      // is the only stop — no teardown-sequence replay.
      expect(terminal.drainCount).toBe(0)
      expect(terminal.stopCount).toBe(1)
      return 'settled'
    })
    // The settlement propagates unchanged and the resume skipped restart.
    expect(value).toBe('settled')
    expect(terminal.startCount).toBe(1)
    // A later stop stays idempotent.
    await runtime.stop()
    expect(terminal.drainCount).toBe(0)
    expect(terminal.stopCount).toBe(1)
  })

  it('a superseded runtime stopping mid-suspend leaves the successor alone', async () => {
    const first = await startBlueTerminal(new FakeTerminal(), noProbe)
    const secondTerminal = new FakeTerminal()
    await first.suspend(async () => {
      // A newer stack registers while the first is suspended (the mirror of
      // "keeps only the newest runtime active", raced against a suspend).
      await startBlueTerminal(secondTerminal, noProbe)
      await first.stop()
      // The stop unregisters the superseded runtime only.
      expect(secondTerminal.stopCount).toBe(0)
    })
  })

  it('refuses to suspend a stopped runtime', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    await runtime.stop()
    await expect(runtime.suspend(async () => 1)).rejects.toThrow('stopped; suspend refused')
  })

  it('drains and stops normally after a resumed suspend', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    await runtime.suspend(async () => undefined)
    await runtime.stop()
    expect(terminal.drainCount).toBe(1)
    expect(terminal.stopCount).toBe(2)
  })
})

describe('overlay focus discipline', () => {
  it('focuses a shown overlay and restores the previous focus on hide', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    const base = focusableComponent('base')
    runtime.addChild(base)
    runtime.setFocus(base)
    expect(base.focused).toBe(true)

    const overlay = focusableComponent('overlay')
    const handle = runtime.showOverlay(overlay, { width: 40, maxHeight: 10 })
    expect(overlay.focused).toBe(true)
    expect(base.focused).toBe(false)
    expect(handle.isFocused()).toBe(true)
    expect(handle.isHidden()).toBe(false)

    handle.hide()
    expect(overlay.focused).toBe(false)
    expect(base.focused).toBe(true)
    await runtime.stop()
  })

  it('supports temporary hide/show and focus/unfocus through the handle', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    const overlay = focusableComponent('modal')
    const handle = runtime.showOverlay(overlay)

    handle.setHidden(true)
    expect(handle.isHidden()).toBe(true)
    expect(handle.isFocused()).toBe(false)

    handle.setHidden(false)
    expect(handle.isHidden()).toBe(false)
    expect(handle.isFocused()).toBe(true)

    handle.unfocus()
    expect(handle.isFocused()).toBe(false)

    handle.focus()
    expect(handle.isFocused()).toBe(true)

    handle.hide()
    await runtime.stop()
  })

  it('does not capture focus for a nonCapturing overlay', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    const base = focusableComponent('editor')
    runtime.addChild(base)
    runtime.setFocus(base)

    const overlay = focusableComponent('hint')
    const handle = runtime.showOverlay(overlay, { nonCapturing: true, anchor: 'bottom-center', offsetY: -1 })
    expect(handle.isFocused()).toBe(false)
    expect(base.focused).toBe(true)
    handle.hide()
    await runtime.stop()
  })
})

describe('input listeners on the stable reference', () => {
  it('normalizes SGR and legacy wheel reports at the core input boundary', () => {
    expect(normalizeWheelInput('\x1b[<64;10;4M')).toBe('\x1b[A')
    expect(normalizeWheelInput('\x1b[<65;10;4M')).toBe('\x1b[B')
    expect(normalizeWheelInput(`\x1b[M${String.fromCharCode(96)}${String.fromCharCode(33)}${String.fromCharCode(33)}`)).toBe('\x1b[A')
    expect(normalizeWheelInput('\x1b[<0;10;4M')).toBeUndefined()
    expect(normalizeWheelInput('\x1b[<66;10;4M')).toBeUndefined()
  })

  it('routes normalized wheel input to the focused component', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    const received: string[] = []
    const focused: BlueFocusable & { handleInput(data: string): void } = {
      focused: false,
      render: () => ['editor'],
      invalidate: () => {},
      handleInput: data => received.push(data),
    }
    runtime.addChild(focused)
    runtime.setFocus(focused)

    terminal.sendInput('\x1b[<65;1;1M')
    expect(received).toEqual(['\x1b[B'])
    await runtime.stop()
  })

  it('runs listeners before focus routing and honors consume/dispose', async () => {
    const terminal = new FakeTerminal()
    const runtime = await startBlueTerminal(terminal, noProbe)
    const received: string[] = []
    const focused: BlueFocusable & { handleInput(data: string): void } = {
      focused: false,
      render: () => ['editor'],
      invalidate: () => {},
      handleInput: (data) => received.push(data),
    }
    runtime.addChild(focused)
    runtime.setFocus(focused)

    let consume = true
    const remove = runtime.tui.addInputListener(data => (data === '\x0f' && consume ? { consume: true } : undefined))

    // A consumed sequence never reaches the focused component.
    terminal.sendInput('\x0f')
    expect(received).toEqual([])

    // A pass-through result (undefined) delegates to focus routing.
    terminal.sendInput('a')
    expect(received).toEqual(['a'])

    // The returned disposer detaches the listener.
    consume = false
    remove()
    terminal.sendInput('\x0f')
    expect(received).toEqual(['a', '\x0f'])
    await runtime.stop()
  })
})

describe('createTerminalRelease', () => {
  it('is a no-op before any terminal stack is active and after it stops', async () => {
    const release = createTerminalRelease()
    await release()

    const terminal = new FakeTerminal()
    await startBlueTerminal(terminal, noProbe)
    await release()
    expect(terminal.stopCount).toBe(1)

    await release()
    expect(terminal.stopCount).toBe(1)
  })
})

describe('createStableTuiReference', () => {
  function stubTui(label: string): TUI {
    return {
      mode: 'regular',
      label,
      ping(): string {
        return `${label}-pong`
      },
    } as unknown as TUI
  }

  it('resolves properties and methods against the current renderer at call time', () => {
    let current = stubTui('a')
    const stable = createStableTuiReference(() => current)

    expect(stable.mode).toBe('regular')
    expect((stable as unknown as { label: string }).label).toBe('a')

    const ping = (stable as unknown as { ping: () => string }).ping
    expect(ping()).toBe('a-pong')

    current = stubTui('b')
    expect(ping()).toBe('b-pong')
    expect((stable as unknown as { label: string }).label).toBe('b')
  })

  it('throws when a method turns non-callable across a renderer swap', () => {
    const a = stubTui('a')
    const b = { mode: 'regular', ping: 'not-a-function' } as unknown as TUI
    let current = a
    const stable = createStableTuiReference(() => current)
    const ping = (stable as unknown as { ping: () => string }).ping
    expect(ping()).toBe('a-pong')
    current = b
    expect(() => ping()).toThrow(TypeError)
  })

  it('forwards set, has, and getPrototypeOf to the current renderer', () => {
    const current = stubTui('a')
    const stable = createStableTuiReference(() => current)
    ;(stable as unknown as { extra: string }).extra = 'value'
    expect((current as unknown as { extra: string }).extra).toBe('value')
    expect('mode' in stable).toBe(true)
    expect(Object.getPrototypeOf(stable)).toBe(Object.getPrototypeOf(current))
  })
})
