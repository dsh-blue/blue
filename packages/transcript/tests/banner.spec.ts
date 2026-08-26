/**
 * The banner's pure core — home shortening, layout boundaries, composition
 * goldens at full/compact/hidden widths, truncation edges — plus the
 * component delegation and the plugin's mount lifecycle, and the
 * version-constant guard against `package.json`.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import type { BlueSessionSnapshot } from '@dsh-blue/blue-api'
import type {
  BlueComponent,
  BlueOverlayHandle,
  BlueScreen,
  BlueSemanticColors,
} from '@dsh-blue/blue-core'
import { describe, expect, it } from 'vitest'
import {
  BANNER_MIN_WIDTH,
  bannerLayout,
  composeBannerLines,
  inject,
  name,
  shortenHome,
  type BannerContent,
  type BannerDeps,
} from '../src/banner.ts'
import { BLUE_VERSION } from '../src/banner-content.ts'
import * as banner from '../src/banner.ts'
import { LOGO_COLS, LOGO_GRADIENT } from '../src/banner-art.ts'
import { visibleWidth, truncateToWidth } from '../../core/src/width.ts'
import { fakeBlueComponents } from './helpers.ts'
import { COLORS } from './status-fakes.ts'

/** Wrap a whale row in its brand-blue gradient ANSI, as the banner paints it. */
function wrapLogo(row: string, index: number): string {
  const hex = LOGO_GRADIENT[index]!
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `\x1b[38;2;${r};${g};${b}m${row}\x1b[39m`
}

/** The whale logo's uniform column width from banner-art. */
const LOGO_WIDTH_COLS = LOGO_COLS


/** Identity deps: structure assertions see text, not escape codes. */
const components = fakeBlueComponents()
const DEPS: BannerDeps = {
  colors: COLORS as BlueSemanticColors,
  truncate: (text, width) => components.truncateToWidth(text, width),
  visibleWidth: text => components.visibleWidth(text),
}

/** Deterministic facts; cwd and version drive the width edges below. */
const CONTENT: BannerContent = {
  version: '9.9.9-test',
  model: 'm',
  provider: 'p',
  cwd: '~/dev',
}

/** The whale logo, mirrored from `banner-art.ts`'s literal. */
const LOGO = [
  '   ⢀⣀⣰⣰⣰⣰⣰⣼⣼⠜   ⣺⣵⡀    ⢀⡀',
  ' ⢀⣸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣵⣐  ⢯⣿⣿⣵⣸⣼⣼⣿⠕',
  '⢨⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣽⣐⠂⠯⣿⣿⣿⣿⠿⠇',
  '⣿⡟⠃⠃⠋⠏⠿⣿⣿⣿⣿⣿⣿⠯⢿⣿⣽⣴⣿⣿⡕',
  '⣿⣿      ⠋⢿⣿⣿⣿⣿ ⠋⣿⣿⣿⣿⠁',
  '⢯⣿⣵       ⠫⣿⣿⣿⣽⣼⣿⣿⣿⠗',
  '⠂⢯⣿⣵⡀   ⣰⣀ ⠊⢿⣿⣿⣿⣿⡿⠇',
  '  ⠋⣿⣿⣼⣰⣰⣻⣿⣽⣰⣀⠋⢿⣿⣿⣼⣰⡀',
  '    ⠃⠏⠿⣿⣿⣿⣿⣿⠿⠟⠇⠂⠃⠃⠃',
]

describe('shortenHome', () => {
  it('collapses the exact home to ~', () => {
    expect(shortenHome('/home/x', '/home/x')).toBe('~')
  })

  it('collapses a child path to ~/rest', () => {
    expect(shortenHome('/home/x/dev/blue', '/home/x')).toBe('~/dev/blue')
  })

  it('keeps paths outside home and home-prefix lookalikes', () => {
    expect(shortenHome('/home/other', '/home/x')).toBe('/home/other')
    expect(shortenHome('/home/x-dev', '/home/x')).toBe('/home/x-dev')
  })

  it('keeps the path for an empty home', () => {
    expect(shortenHome('/a', '')).toBe('/a')
  })
})

describe('bannerLayout', () => {
  it('renders nothing below the minimum width', () => {
    expect(bannerLayout(BANNER_MIN_WIDTH - 1)).toBeNull()
  })

  it('leaves a two-column value cell at the minimum width', () => {
    // The logo block (25) plus the gap (2) plus the widest label (11) leave
    // the rest of the viewport to the status value.
    expect(bannerLayout(BANNER_MIN_WIDTH)).toEqual({
      total: BANNER_MIN_WIDTH,
      valueWidth: 2,
    })
  })

  it('never caps: the banner fills very wide terminals', () => {
    // 200 − 25 (logo) − 2 (gap) − 11 (label) = 162 columns of value.
    expect(bannerLayout(200)).toEqual({ total: 200, valueWidth: 162 })
  })
})

describe('composeBannerLines', () => {
  it('renders nothing below the minimum width', () => {
    expect(composeBannerLines(DEPS, CONTENT, BANNER_MIN_WIDTH - 1)).toEqual([])
  })

  it('composes the frameless whale banner at one hundred columns', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 100)
    // Nine whale rows; the status column leads with the welcome/help lines
    // then the three labels, vertically centered.
    expect(lines).toHaveLength(9)
    // The frameless block stacks the whale rows; the status column leads
    // with the welcome/help lines and the three labels, vertically centered.
    expect(lines[0]).toBe(`${wrapLogo(LOGO[0]!.padEnd(LOGO_COLS), 0)}  `)
    expect(lines[1]).toContain('Welcome to Blue!')
    expect(lines[1].startsWith(wrapLogo(LOGO[1]!.padEnd(LOGO_COLS), 1))).toBe(true)
    expect(lines[2]).toContain('Send /help for help information.')
    expect(lines[4]).toContain('Directory: ~/dev')
    expect(lines[5]).toContain('Model:     m · p')
    expect(lines[6]).toContain('Version:   9.9.9-test')
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(100)
  })

  it('composes the same frameless block at eighty columns', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 80)
    expect(lines).toHaveLength(9)
    expect(lines.join('\n')).toContain('Welcome to Blue!')
    expect(lines.join('\n')).toContain('Send /help for help information.')
    expect(lines.join('\n')).toContain('Directory: ~/dev')
  })

  it('composes the same frameless block on narrow terminals', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 48)
    expect(lines).toHaveLength(9)
    expect(lines.join('\n')).toContain('Welcome')
    expect(lines.join('\n')).toContain('Model')
  })

  it('leaves the whale rows at their natural width on wide terminals', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 200)
    // The logo rows are frameless: they never stretch to the viewport width.
    expect(visibleWidth(lines[0]!)).toBe(LOGO_WIDTH_COLS + 2)
  })

  it('truncates the /help line once the value budget runs out', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 40)
    // valueWidth 2 collapses every status line to the ellipsis.
    expect(lines.join('\n')).toContain('\x1b[0m..\x1b[0m')
    expect(lines.join('\n')).not.toContain('information.')
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40)
  })

  it('truncates an over-long cwd to the value budget', () => {
    const lines = composeBannerLines(DEPS, { ...CONTENT, cwd: 'd'.repeat(200) }, 100)
    // valueWidth 62 at width 100, minus the 11-column label, gives 51 value
    // columns plus the pi-tui ellipsis reset.
    expect(lines.join('\n')).toContain(`Directory: ${'d'.repeat(48)}\x1b[0m...\x1b[0m`)
    expect(lines.join('\n')).not.toContain('d'.repeat(61))
  })

  it('truncates an over-long model line to the value budget', () => {
    const lines = composeBannerLines(DEPS, { ...CONTENT, model: 'm'.repeat(100) }, 100)
    expect(lines.join('\n')).toContain(`Model:     ${'m'.repeat(48)}\x1b[0m...\x1b[0m`)
    expect(lines.join('\n')).not.toContain('m'.repeat(61))
  })

  it('truncates an over-long version value to the value budget', () => {
    const lines = composeBannerLines(DEPS, { ...CONTENT, version: 'v'.repeat(100) }, 100)
    expect(lines.join('\n')).toContain(`Version:   ${'v'.repeat(48)}\x1b[0m...\x1b[0m`)
    expect(lines.join('\n')).not.toContain('v'.repeat(61))
  })
})

/** Records scroll mounts and render requests; the other mounts throw. */
class BannerFakeScreen implements BlueScreen {
  readonly children: BlueComponent[] = []
  readonly renderRequests: (boolean | undefined)[] = []
  readonly columns = 80
  readonly rows = 24

  addChild(component: BlueComponent): () => void {
    this.children.push(component)
    let done = false
    return () => {
      if (done) return
      done = true
      const index = this.children.indexOf(component)
      if (index !== -1) this.children.splice(index, 1)
    }
  }

  addBottomChild(): () => void {
    throw new Error('fake addBottomChild is out of scope for banner plugin tests')
  }

  removeChild(): void {}

  setFocus(): void {}

  showOverlay(): BlueOverlayHandle {
    throw new Error('fake showOverlay is out of scope for banner plugin tests')
  }

  requestRender(force?: boolean): void {
    this.renderRequests.push(force)
  }

  /** S31 seam: pass-through; the banner suite never suspends the screen. */
  suspend<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }

  setTitle(): void {}
}

/** Renderer-neutral current-session reader used by the banner plugin fixture. */
function bannerSessionReader(initial: BlueSessionSnapshot | null = null): {
  service: { current(): BlueSessionSnapshot | null, subscribe(listener: (session: BlueSessionSnapshot | null) => void): { readonly disposed: boolean, dispose(): void } }
  publish(session: BlueSessionSnapshot | null): void
} {
  let current = initial
  const listeners = new Set<(session: BlueSessionSnapshot | null) => void>()
  return {
    service: {
      current: () => current,
      subscribe(listener) {
        listeners.add(listener)
        listener(current)
        let disposed = false
        return {
          get disposed() { return disposed },
          dispose() { disposed = true; listeners.delete(listener) },
        }
      },
    },
    publish(session) {
      current = session
      for (const listener of listeners) listener(session)
    },
  }
}

/** Boot the banner plugin on a fresh root context with faked services. */
async function bootBanner(config: banner.Config = {}): Promise<{ screen: BannerFakeScreen; dispose(): Promise<void> }> {
  const ctx = new Context()
  const screen = new BannerFakeScreen()
  ctx.reflect.provide('blueScreen', screen)
  ctx.reflect.provide('blueTheme', { colors: COLORS })
  ctx.reflect.provide('blueComponents', fakeBlueComponents())
  ctx.reflect.provide('blueSessionReader', bannerSessionReader().service)
  ctx.reflect.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) })
  const fiber = await ctx.plugin(banner, config)
  return { screen, dispose: () => fiber.dispose() }
}

describe('blue-banner plugin', () => {
  it('declares its name and injects', () => {
    expect(name).toBe('blue-banner')
    expect(inject).toEqual(['blueScreen', 'blueTheme', 'blueComponents', 'blueSessionReader', 'agentDefaultModel'])
  })

  it('mounts one scroll child with the snapshotted facts and requests a render', async () => {
    const { screen } = await bootBanner()
    expect(screen.children).toHaveLength(1)
    expect(screen.renderRequests.length).toBeGreaterThan(0)
    const joined = screen.children[0]?.render(100).join('\n') ?? ''
    expect(joined).toContain('Welcome to Blue!')
    expect(joined).toContain(`Version:   ${BLUE_VERSION}`)
    expect(joined).toContain('m · p')
    // The frameless banner's status value budget at render(100) is
    // The mounted child is a GutterComponent (one column each side), so the
    // banner composes at width−2 and its info rows clip label+value TOGETHER
    // to the value-column budget (bannerLayout(98) = 98 − 25 logo block − 2
    // gap − 11 label = 60 columns); the pi-tui truncation appends a
    // reset-wrapped ellipsis inside it. Deriving the expectation from the
    // same primitives keeps the assertion honest for a deep checkout too
    // (this spec also runs from worktree copies): a cwd that fits renders
    // whole, a deeper one as its exact clipped row text.
    const budget = banner.bannerLayout(98)!.valueWidth
    const row = `${banner.DIRECTORY_LABEL}${shortenHome(process.cwd(), homedir())}`
    expect(joined).toContain(truncateToWidth(row, budget))
    // The banner is stateless; invalidation is a covered no-op.
    expect(() => screen.children[0]?.invalidate()).not.toThrow()
  })

  it('shows a profile-local identity without changing the release version', async () => {
    const displayVersion = `${BLUE_VERSION}+frontend-runtime.test`
    const { screen } = await bootBanner({ displayVersion })
    const joined = screen.children[0]?.render(100).join('\n') ?? ''
    expect(joined).toContain(`Version:   ${displayVersion}`)
    expect(BLUE_VERSION).toBe('0.1.0-rc.8')
  })

  it('re-derives the model line on session and model changes', async () => {
    const ctx = new Context()
    const screen = new BannerFakeScreen()
    ctx.reflect.provide('blueScreen', screen)
    ctx.reflect.provide('blueTheme', { colors: COLORS })
    ctx.reflect.provide('blueComponents', fakeBlueComponents())
    ctx.reflect.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) })
    const sessions = bannerSessionReader()
    ctx.reflect.provide('blueSessionReader', sessions.service)
    await ctx.plugin(banner)
    expect(screen.children[0]?.render(100).join('\n')).toContain('m · p')
    // A committed pick shows through the live ref.
    sessions.publish({ id: 'a', cwd: '/tmp', status: 'idle', mode: 'normal', model: { id: 'mock-pro', provider: 'mock' } })
    expect(screen.children[0]?.render(100).join('\n')).toContain('mock-pro · mock')
    // A session switch without a published ref falls back to the default.
    sessions.publish({ id: 'b', cwd: '/tmp', status: 'idle', mode: 'normal' })
    expect(screen.children[0]?.render(100).join('\n')).toContain('m · p')
  })

  it('unmounts the child when the fiber disposes', async () => {
    const { screen, dispose } = await bootBanner()
    await dispose()
    expect(screen.children).toHaveLength(0)
  })
})

describe('BLUE_VERSION', () => {
  it('matches the package version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(BLUE_VERSION).toBe(pkg.version)
  })
})
