/**
 * L0 terminal runtime: lifecycle, Blue-typed delegation through the stable
 * reference, overlay focus discipline on a real `TuiMainScreen`, the OSC 11
 * probe ordering, terminal color-scheme forwarding, the suspend/resume seam
 * (S31), and the `installFailLoud` release factory.
 */

import { describe, expect, it } from 'vitest'
import type { TUI } from '@earendil-works/pi-tui'
import type { BlueComponent, BlueFocusable, BlueRgbColor } from '../src/types.ts'
import { createStableTuiReference, createTerminalRelease, normalizeWheelInput, startBlueTerminal } from '../src/terminal.ts'
import type { FrameOverflowEntry } from '../src/frame-clamp.ts'
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

  it('leaves a full viewport of content untouched', async () => {
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
    // Thirty-one rendered lines: no filler, the dock right after the content.
    expect(rows).toHaveLength(31)
    expect(rows[30]).toContain('dock-row')
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
