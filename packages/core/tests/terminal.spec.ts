/**
 * L0 terminal runtime: lifecycle, Blue-typed delegation through the stable
 * reference, overlay focus discipline on a real `TuiMainScreen`, and the
 * `installFailLoud` release factory.
 */

import { describe, expect, it } from 'vitest'
import type { TUI } from '@earendil-works/pi-tui'
import type { BlueComponent, BlueFocusable } from '../src/types.ts'
import { createStableTuiReference, createTerminalRelease, startBlueTerminal } from '../src/terminal.ts'
import { FakeTerminal, waitForRender } from './fake-terminal.ts'

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
  it('starts the renderer on the given terminal immediately', () => {
    const terminal = new FakeTerminal()
    const runtime = startBlueTerminal(terminal)
    expect(terminal.startCount).toBe(1)
    expect(runtime.columns).toBe(80)
    return runtime.stop()
  })

  it('renders mounted components to the terminal', async () => {
    const terminal = new FakeTerminal()
    const runtime = startBlueTerminal(terminal)
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
    const runtime = startBlueTerminal(terminal)
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
    const runtime = startBlueTerminal(terminal)
    await runtime.stop()
    await runtime.stop()
    expect(terminal.drainCount).toBe(1)
    expect(terminal.stopCount).toBe(1)
  })

  it('keeps only the newest runtime active for the release', async () => {
    const first = startBlueTerminal(new FakeTerminal())
    const secondTerminal = new FakeTerminal()
    startBlueTerminal(secondTerminal)
    await first.stop()
    await createTerminalRelease()()
    expect(secondTerminal.stopCount).toBe(1)
  })
})

describe('overlay focus discipline', () => {
  it('focuses a shown overlay and restores the previous focus on hide', async () => {
    const terminal = new FakeTerminal()
    const runtime = startBlueTerminal(terminal)
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
    const runtime = startBlueTerminal(terminal)
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
    const runtime = startBlueTerminal(terminal)
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

describe('createTerminalRelease', () => {
  it('is a no-op before any terminal stack is active and after it stops', async () => {
    const release = createTerminalRelease()
    await release()

    const terminal = new FakeTerminal()
    startBlueTerminal(terminal)
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
