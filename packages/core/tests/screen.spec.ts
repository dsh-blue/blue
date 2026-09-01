/**
 * `ctx.blueScreen` service: registration and disposal on the fiber, and
 * delegation of every `BlueScreen` method to the terminal runtime.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { BlueScreenService } from '../src/screen.ts'
import type { BlueTerminalRuntime } from '../src/terminal.ts'
import type { BlueComponent, BlueDockOptions, BlueOverlayHandle } from '../src/types.ts'

interface Recorded {
  added: BlueComponent[]
  bottomAdded: BlueComponent[]
  dockAdded: { component: BlueComponent, options: BlueDockOptions | undefined }[]
  removed: BlueComponent[]
  focused: (BlueComponent | null)[]
  overlays: { component: BlueComponent; options?: unknown }[]
  renders: (boolean | undefined)[]
  suspends: unknown[]
  titles: string[]
  scrolls: { direction: 'up' | 'down', amount: number | undefined }[]
  contentChanges: number
}

function recordingRuntime(): BlueTerminalRuntime & Recorded {
  const handle: BlueOverlayHandle = {
    hide: () => {},
    setHidden: () => {},
    isHidden: () => false,
    focus: () => {},
    unfocus: () => {},
    isFocused: () => true,
  }
  const recorded: Recorded = { added: [], bottomAdded: [], dockAdded: [], removed: [], focused: [], overlays: [], renders: [], suspends: [], titles: [], scrolls: [], contentChanges: 0 }
  return {
    ...recorded,
    get contentChanges() { return recorded.contentChanges },
    columns: 120,
    rows: 24,
    addChild(component) {
      recorded.added.push(component)
    },
    addBottomChild(component) {
      recorded.bottomAdded.push(component)
    },
    addDockChild(component, options) {
      recorded.dockAdded.push({ component, options })
    },
    removeChild(component) {
      recorded.removed.push(component)
    },
    setFocus(component) {
      recorded.focused.push(component)
    },
    showOverlay(component, options) {
      recorded.overlays.push(options === undefined ? { component } : { component, options })
      return handle
    },
    requestRender(force) {
      recorded.renders.push(force)
    },
    scrollContent(direction, amount) {
      recorded.scrolls.push({ direction, amount })
      return true
    },
    contentChanged() {
      recorded.contentChanges += 1
      return true
    },
    async suspend<T>(fn: () => Promise<T>): Promise<T> {
      const value = await fn()
      recorded.suspends.push(value)
      return value
    },
    setTitle(title) {
      recorded.titles.push(title)
    },
    stop: () => Promise.resolve(),
  }
}

const component: BlueComponent = {
  render: () => ['row'],
  invalidate: () => {},
}

describe('BlueScreenService', () => {
  it('registers as ctx.blueScreen and unregisters when the fiber disposes', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(BlueScreenService, recordingRuntime())
    await fiber
    expect(ctx.get('blueScreen')).toBeInstanceOf(BlueScreenService)
    await fiber.dispose()
    expect(ctx.get('blueScreen')).toBeUndefined()
  })

  it('delegates mounts, focus, overlays, and renders to the runtime', async () => {
    const runtime = recordingRuntime()
    const ctx = new Context()
    await ctx.plugin(BlueScreenService, runtime)
    const screen = ctx.blueScreen

    expect(screen.columns).toBe(120)
    expect(screen.rows).toBe(24)

    const dispose = screen.addChild(component)
    expect(runtime.added).toEqual([component])
    screen.removeChild(component)
    expect(runtime.removed).toEqual([component])
    dispose()
    expect(runtime.removed).toEqual([component, component])

    const bottomDispose = screen.addBottomChild(component)
    expect(runtime.bottomAdded).toEqual([component])
    bottomDispose()
    expect(runtime.removed).toEqual([component, component, component])

    const dockDispose = screen.addDockChild?.(component, { priority: 40 })
    expect(runtime.dockAdded).toEqual([{ component, options: { priority: 40 } }])
    dockDispose?.()
    expect(runtime.removed).toEqual([component, component, component, component])

    screen.setFocus(component)
    screen.setFocus(null)
    expect(runtime.focused).toEqual([component, null])

    const handle = screen.showOverlay(component, { width: '50%', anchor: 'top-center' })
    expect(handle.isFocused()).toBe(true)
    expect(runtime.overlays).toEqual([{ component, options: { width: '50%', anchor: 'top-center' } }])

    screen.requestRender()
    screen.requestRender(true)
    expect(runtime.renders).toEqual([undefined, true])

    expect(screen.scrollContent('up', 3)).toBe(true)
    expect(runtime.scrolls).toEqual([{ direction: 'up', amount: 3 }])
    expect(screen.contentChanged()).toBe(true)
    expect(runtime.contentChanges).toBe(1)

    await expect(screen.suspend(async () => 'ok')).resolves.toBe('ok')
    expect(runtime.suspends).toEqual(['ok'])

    screen.setTitle('fix the login bug')
    expect(runtime.titles).toEqual(['fix the login bug'])
  })
})
