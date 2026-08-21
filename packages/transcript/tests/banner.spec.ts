/**
 * The banner's pure core — home shortening, layout boundaries, composition
 * goldens at full/compact/hidden widths, truncation edges — plus the
 * component delegation and the plugin's mount lifecycle, and the
 * version-constant guard against `package.json`.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
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
import { fakeBlueComponents } from './helpers.ts'
import { COLORS } from './status-fakes.ts'

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

/** The placeholder logo, mirrored from `banner-art.ts`'s literal. */
const LOGO = ['▐█▛█▛█▌', '▐█████▌']

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

  it('spans the full width with the inset content cell at the minimum', () => {
    expect(bannerLayout(BANNER_MIN_WIDTH)).toEqual({
      total: BANNER_MIN_WIDTH,
      innerWidth: BANNER_MIN_WIDTH - 4,
    })
  })

  it('never caps: the box fills very wide terminals', () => {
    expect(bannerLayout(200)).toEqual({ total: 200, innerWidth: 196 })
  })
})

describe('composeBannerLines', () => {
  it('renders nothing below the minimum width', () => {
    expect(composeBannerLines(DEPS, CONTENT, BANNER_MIN_WIDTH - 1)).toEqual([])
  })

  it('composes the golden full-width box at one hundred columns', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 100)
    // 1 top + 8 body (blank, the two logo-headed lines, blank, the three
    // label rows, blank) + 1 bottom.
    expect(lines).toHaveLength(10)
    expect(lines.map(line => line.length)).toEqual(Array.from({ length: 10 }, () => 100))
    expect(lines[0]).toBe(`╭${'─'.repeat(98)}╮`)
    expect(lines[1]).toBe(`│${' '.repeat(98)}│`)
    expect(lines[2]).toBe(`│  ${LOGO[0]}  Welcome to Blue!${' '.repeat(71)}│`)
    expect(lines[3]).toBe(`│  ${LOGO[1]}  Send /help for help information.${' '.repeat(55)}│`)
    expect(lines[4]).toBe(`│${' '.repeat(98)}│`)
    expect(lines[5]).toBe(`│  Directory: ~/dev${' '.repeat(80)}│`)
    expect(lines[6]).toBe(`│  Model:     m · p${' '.repeat(80)}│`)
    expect(lines[7]).toBe(`│  Version:   9.9.9-test${' '.repeat(75)}│`)
    expect(lines[8]).toBe(`│${' '.repeat(98)}│`)
    expect(lines[9]).toBe(`╰${'─'.repeat(98)}╯`)
  })

  it('composes the same single column at eighty columns', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 80)
    expect(lines).toHaveLength(10)
    expect(lines.map(line => line.length)).toEqual(Array.from({ length: 10 }, () => 80))
    expect(lines.join('\n')).toContain('Welcome to Blue!')
    expect(lines.join('\n')).toContain('Send /help for help information.')
    expect(lines.join('\n')).toContain('Directory: ~/dev')
  })

  it('composes the same single column on narrow terminals', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 48)
    expect(lines).toHaveLength(10)
    expect(lines.map(line => line.length)).toEqual(Array.from({ length: 10 }, () => 48))
    expect(lines.join('\n')).toContain('Welcome to Blue!')
    expect(lines.join('\n')).toContain('Model:     m · p')
  })

  it('fills very wide terminals without a cap', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 200)
    expect(lines[0]?.length).toBe(200)
  })

  it('truncates the /help line once the header budget runs out', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 40)
    // innerWidth 36 − logo 7 − gap 2 = 27 columns for the header text.
    expect(lines.join('\n')).toContain('Send /help for help info...')
    expect(lines.join('\n')).not.toContain('information.')
    expect(lines.map(line => line.length)).toEqual(Array.from({ length: lines.length }, () => 40))
  })

  it('truncates an over-long cwd to the value budget', () => {
    const lines = composeBannerLines(DEPS, { ...CONTENT, cwd: 'd'.repeat(200) }, 100)
    // innerWidth 96 − label 11 = 85 columns for every info value.
    expect(lines.join('\n')).toContain(`${'d'.repeat(82)}...`)
    expect(lines.join('\n')).not.toContain('d'.repeat(83))
    expect(lines.map(line => line.length)).toEqual(Array.from({ length: lines.length }, () => 100))
  })

  it('truncates an over-long model line to the value budget', () => {
    const lines = composeBannerLines(DEPS, { ...CONTENT, model: 'm'.repeat(100) }, 100)
    expect(lines.join('\n')).toContain(`${'m'.repeat(82)}...`)
    expect(lines.join('\n')).not.toContain('m'.repeat(83))
  })

  it('truncates an over-long version value to the value budget', () => {
    const lines = composeBannerLines(DEPS, { ...CONTENT, version: 'v'.repeat(100) }, 100)
    expect(lines.join('\n')).toContain(`Version:   ${'v'.repeat(82)}...`)
    expect(lines.join('\n')).not.toContain('v'.repeat(83))
    expect(lines.map(line => line.length)).toEqual(Array.from({ length: lines.length }, () => 100))
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

/** Boot the banner plugin on a fresh root context with faked services. */
async function bootBanner(): Promise<{ screen: BannerFakeScreen; dispose(): Promise<void> }> {
  const ctx = new Context()
  const screen = new BannerFakeScreen()
  ctx.reflect.provide('blueScreen', screen)
  ctx.reflect.provide('blueTheme', { colors: COLORS })
  ctx.reflect.provide('blueComponents', fakeBlueComponents())
  ctx.reflect.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) })
  const fiber = await ctx.plugin(banner)
  return { screen, dispose: () => fiber.dispose() }
}

describe('blue-banner plugin', () => {
  it('declares its name and injects', () => {
    expect(name).toBe('blue-banner')
    expect(inject).toEqual(['blueScreen', 'blueTheme', 'blueComponents', 'agentDefaultModel'])
  })

  it('mounts one scroll child with the snapshotted facts and requests a render', async () => {
    const { screen } = await bootBanner()
    expect(screen.children).toHaveLength(1)
    expect(screen.renderRequests.length).toBeGreaterThan(0)
    const joined = screen.children[0]?.render(100).join('\n') ?? ''
    expect(joined).toContain('Welcome to Blue!')
    expect(joined).toContain(`Version:   ${BLUE_VERSION}`)
    expect(joined).toContain('m · p')
    // The value cell budgets ninety-six minus the eleven-column label: a
    // cwd that fits renders whole, while a deeper checkout (this spec also
    // runs from worktree copies) survives as its clipped prefix.
    const cwd = shortenHome(process.cwd(), homedir())
    expect(joined).toContain(cwd.length <= 85 ? cwd : cwd.slice(0, 82))
    // The banner is stateless; invalidation is a covered no-op.
    expect(() => screen.children[0]?.invalidate()).not.toThrow()
  })

  it('re-derives the model line on session and model changes', async () => {
    const ctx = new Context()
    const screen = new BannerFakeScreen()
    ctx.reflect.provide('blueScreen', screen)
    ctx.reflect.provide('blueTheme', { colors: COLORS })
    ctx.reflect.provide('blueComponents', fakeBlueComponents())
    ctx.reflect.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) })
    let selection: { provider: string, model: string } | undefined
    ctx.reflect.provide('blueSession', {
      get current() { return { id: 'a' } },
      get modelRef() {
        return selection === undefined ? undefined : { get current() { return selection! } }
      },
    })
    await ctx.plugin(banner)
    expect(screen.children[0]?.render(100).join('\n')).toContain('m · p')
    // A committed pick shows through the live ref.
    selection = { provider: 'mock', model: 'mock-pro' }
    ctx.emit('blue/model-changed')
    expect(screen.children[0]?.render(100).join('\n')).toContain('mock-pro · mock')
    // A session switch without a published ref falls back to the default.
    selection = undefined
    ctx.emit('blue/session-changed', { id: 'a' })
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
