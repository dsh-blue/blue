/**
 * The banner's pure core — home shortening, adaptive layout boundaries,
 * composition goldens at full/compact/hidden widths, truncation and
 * column-balance edges — plus the component delegation and the plugin's
 * mount lifecycle, and the version-constant guard against `package.json`.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import type {
  BlueComponent,
  BlueOverlayHandle,
  BlueScreen,
  BlueSemanticColors,
} from '@deepseek-ai/dsh-blue-core'
import { describe, expect, it } from 'vitest'
import {
  BANNER_MAX_WIDTH,
  BANNER_MIN_WIDTH,
  BANNER_RIGHT_WIDTH,
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

/** Deterministic facts; cwd and sections drive the width edges below. */
const CONTENT: BannerContent = {
  version: '9.9.9-test',
  model: 'm',
  provider: 'p',
  cwd: '~/dev',
  tips: { heading: 'Tips for getting started', lines: ['tip one', 'tip two'] },
  whatsNew: { heading: "What's new", lines: ['new one'] },
}

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

  it('drops the right column below the full threshold', () => {
    expect(bannerLayout(BANNER_MIN_WIDTH)).toEqual({
      total: BANNER_MIN_WIDTH,
      leftWidth: BANNER_MIN_WIDTH - 2,
      rightWidth: 0,
      withRight: false,
    })
    expect(bannerLayout(99)).toEqual({ total: 99, leftWidth: 97, rightWidth: 0, withRight: false })
  })

  it('joins the fixed right column at the full threshold', () => {
    expect(bannerLayout(100)).toEqual({
      total: 100,
      leftWidth: 100 - 2 - BANNER_RIGHT_WIDTH - 1,
      rightWidth: BANNER_RIGHT_WIDTH,
      withRight: true,
    })
  })

  it('caps the box width on wide terminals', () => {
    expect(bannerLayout(150)?.total).toBe(BANNER_MAX_WIDTH)
    expect(bannerLayout(BANNER_MAX_WIDTH).total).toBe(BANNER_MAX_WIDTH)
  })
})

describe('composeBannerLines', () => {
  it('renders nothing below the minimum width', () => {
    expect(composeBannerLines(DEPS, CONTENT, BANNER_MIN_WIDTH - 1)).toEqual([])
  })

  it('composes the golden full box at one hundred columns', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 100)
    // 1 top + 14 body (the left column's height) + 1 bottom.
    expect(lines).toHaveLength(16)
    expect(lines.map(line => line.length)).toEqual(Array.from({ length: 16 }, () => 100))
    const title = `blue v${CONTENT.version}`
    expect(lines[0]).toBe(`╭─── ${title} ${'─'.repeat(100 - 7 - title.length)}╮`)
    expect(lines[1]).toBe(`│${' '.repeat(45)}│${' '.repeat(52)}│`)
    expect(lines[2]).toBe(`│${' '.repeat(16)}Welcome back!${' '.repeat(16)}│ Tips for getting started${' '.repeat(27)}│`)
    expect(lines[5]).toContain('        ▄   ▄       ')
    expect(lines.join('\n')).toContain('  ▄▄▄██▀█████▀██▄▄  ')
    expect(lines.join('\n')).toContain('m · p')
    expect(lines.join('\n')).toContain('~/dev')
    expect(lines.join('\n')).toContain('│ Tips for getting started')
    expect(lines.join('\n')).toContain('│ tip one')
    expect(lines.join('\n')).toContain(`│ ${'─'.repeat(50)} `)
    expect(lines.join('\n')).toContain("│ What's new")
    expect(lines[15]).toBe(`╰${'─'.repeat(98)}╯`)
  })

  it('drops the right column at eighty columns', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 80)
    expect(lines.map(line => line.length)).toEqual(Array.from({ length: lines.length }, () => 80))
    expect(lines).toHaveLength(16)
    expect(lines.join('\n')).not.toContain('Tips for getting started')
    expect(lines[2]).toBe(`│${' '.repeat(32)}Welcome back!${' '.repeat(33)}│`)
  })

  it('caps the box on very wide terminals', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 200)
    expect(lines[0]?.length).toBe(BANNER_MAX_WIDTH)
  })

  it('truncates an over-long cwd to the left cell', () => {
    const lines = composeBannerLines(DEPS, { ...CONTENT, cwd: 'd'.repeat(200) }, 100)
    const joined = lines.join('\n')
    expect(joined).toContain(`${'d'.repeat(42)}...`)
    expect(lines.map(line => line.length)).toEqual(Array.from({ length: lines.length }, () => 100))
  })

  it('truncates an over-long model line to the left cell', () => {
    const lines = composeBannerLines(DEPS, { ...CONTENT, model: 'm'.repeat(60) }, 100)
    expect(lines.join('\n')).toContain(`${'m'.repeat(42)}...`)
    expect(lines.join('\n')).not.toContain('m'.repeat(43))
  })

  it('truncates over-long right-column lines to the right cell', () => {
    const lines = composeBannerLines(
      DEPS,
      { ...CONTENT, tips: { heading: 'Tips for getting started', lines: ['t'.repeat(80)] } },
      100,
    )
    expect(lines.join('\n')).toContain(`│ ${'t'.repeat(48)}...`)
    expect(lines.map(line => line.length)).toEqual(Array.from({ length: lines.length }, () => 100))
  })

  it('truncates an over-long title inside the top rule', () => {
    const lines = composeBannerLines(DEPS, { ...CONTENT, version: 'v'.repeat(100) }, 40)
    expect(lines[0]?.length).toBe(40)
  })

  it('pads the left column when the right column is taller', () => {
    const lines = composeBannerLines(
      DEPS,
      { ...CONTENT, tips: { heading: 'Tips for getting started', lines: Array.from({ length: 20 }, (_, i) => `tip ${i}`) } },
      100,
    )
    // Right column: 1 blank + 1 heading + 20 lines + 1 divider + 1 heading + 1 line.
    expect(lines).toHaveLength(2 + 25)
    const lastBody = lines[lines.length - 2] ?? ''
    expect(lastBody.startsWith(`│${' '.repeat(45)}│ new one`)).toBe(true)
    expect(lines.map(line => line.length)).toEqual(Array.from({ length: lines.length }, () => 100))
  })
})

/** Records scroll mounts and render requests; the other mounts throw. */
class BannerFakeScreen implements BlueScreen {
  readonly children: BlueComponent[] = []
  readonly renderRequests: (boolean | undefined)[] = []
  readonly columns = 80

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
    expect(joined).toContain('Welcome back!')
    expect(joined).toContain(`blue v${BLUE_VERSION}`)
    expect(joined).toContain('m · p')
    expect(joined).toContain(shortenHome(process.cwd(), homedir()))
    // The banner is stateless; invalidation is a covered no-op.
    expect(() => screen.children[0]?.invalidate()).not.toThrow()
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
