/**
 * L0 terminal runtime: lifecycle, Blue-typed delegation through the stable
 * reference, overlay focus discipline on a real `TuiMainScreen`, the OSC 11
 * probe ordering, terminal color-scheme forwarding, and the
 * `installFailLoud` release factory.
 */

import { describe, expect, it } from 'vitest'
import type { TUI } from '@earendil-works/pi-tui'
import type { BlueComponent, BlueFocusable, BlueRgbColor } from '../src/types.ts'
import { createStableTuiReference, createTerminalRelease, startBlueTerminal } from '../src/terminal.ts'
import { FakeTerminal, waitForRender } from './fake-terminal.ts'

/** A background probe that never answers, for tests indifferent to it. */
function noProbe(): Promise<BlueRgbColor | undefined> {
  return Promise.resolve(undefined)
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
