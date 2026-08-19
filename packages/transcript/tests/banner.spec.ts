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
  BANNER_LEFT_WIDTH,
  BANNER_LOGO_WIDTH,
  BANNER_MIN_WIDTH,
  BANNER_RIGHT_MIN,
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
}

/** The packed whale art, mirrored from `banner-art.ts`'s golden. */
const WHALE = [
  '     ▀  ▀  ▀    ',
  '       ▄  ▄     ',
  '    ▄▄▄▄▄▄▄▄▄   ',
  '  ▄▄█▀████▀█▄▄  ',
  '  ███▄████▄███  ',
  '   ██████████   ',
  '   ▀▀▀▀▀▀▀▀▀▀   ',
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

  it('spans the full width, the logo cell hugging the whale', () => {
    expect(bannerLayout(BANNER_MIN_WIDTH)).toEqual({
      total: BANNER_MIN_WIDTH,
      logoWidth: BANNER_LOGO_WIDTH,
      infoWidth: BANNER_MIN_WIDTH - 2 - BANNER_LOGO_WIDTH - 1,
      rightWidth: 0,
      withRight: false,
    })
    expect(BANNER_LOGO_WIDTH).toBe(16)
  })

  it('joins the tips cell once the viewport leaves it enough room', () => {
    // The tips cell is `width − frame(2) − separator(1) − LEFT(44)`.
    expect(bannerLayout(BANNER_LEFT_WIDTH + BANNER_RIGHT_MIN + 2).withRight).toBe(false)
    expect(bannerLayout(BANNER_LEFT_WIDTH + BANNER_RIGHT_MIN + 3).withRight).toBe(true)
    expect(bannerLayout(BANNER_LEFT_WIDTH + BANNER_RIGHT_MIN + 3).rightWidth).toBe(BANNER_RIGHT_MIN)
  })

  it('never caps: the box fills very wide terminals', () => {
    expect(bannerLayout(200)?.total).toBe(200)
  })
})

describe('composeBannerLines', () => {
  it('renders nothing below the minimum width', () => {
    expect(composeBannerLines(DEPS, CONTENT, BANNER_MIN_WIDTH - 1)).toEqual([])
  })

  it('composes the golden full-width box at one hundred columns', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 100)
    // 1 top + 7 body (the whale's height) + 1 bottom.
    expect(lines).toHaveLength(9)
    expect(lines.map(line => line.length)).toEqual(Array.from({ length: 9 }, () => 100))
    const title = `blue v${CONTENT.version}`
    expect(lines[0]).toBe(`╭─── ${title} ${'─'.repeat(100 - 7 - title.length)}╮`)
    // Body rows: the whale's bubble spray and back beside the info stack
    // (one space between the cells), the tips padding their cell.
    expect(lines[1]).toBe(`│${WHALE[0]} ${' Welcome back!'}${' '.repeat(13)}│ Tips for getting started${' '.repeat(28)}│`)
    expect(lines[2]).toBe(`│${WHALE[1]} ${' m · p'}${' '.repeat(21)}│ tip one${' '.repeat(45)}│`)
    expect(lines[3]).toBe(`│${WHALE[2]} ${' ~/dev'}${' '.repeat(21)}│ tip two${' '.repeat(45)}│`)
    expect(lines[4]).toBe(`│${WHALE[3]}${' '.repeat(28)}│${' '.repeat(53)}│`)
    expect(lines[5]).toBe(`│${WHALE[4]}${' '.repeat(28)}│${' '.repeat(53)}│`)
    expect(lines[6]).toBe(`│${WHALE[5]}${' '.repeat(28)}│${' '.repeat(53)}│`)
    expect(lines[7]).toBe(`│${WHALE[6]}${' '.repeat(28)}│${' '.repeat(53)}│`)
    expect(lines[8]).toBe(`╰${'─'.repeat(98)}╯`)
  })

  it('joins the tips at eighty columns too — the tips cell is 33 wide', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 80)
    expect(lines).toHaveLength(9)
    expect(lines.map(line => line.length)).toEqual(Array.from({ length: 9 }, () => 80))
    expect(lines.join('\n')).toContain('Welcome back!')
    expect(lines.join('\n')).toContain('Tips for getting started')
  })

  it('drops the tips cell on narrow terminals, the info absorbing the width', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 48)
    expect(lines).toHaveLength(9)
    expect(lines.map(line => line.length)).toEqual(Array.from({ length: 9 }, () => 48))
    expect(lines.join('\n')).toContain('Welcome back!')
    expect(lines[1]).toBe(`│${WHALE[0]} ${' Welcome back!'}${' '.repeat(15)}│`)
    expect(lines.join('\n')).not.toContain('Tips for getting started')
  })

  it('fills very wide terminals without a cap', () => {
    const lines = composeBannerLines(DEPS, CONTENT, 200)
    expect(lines[0]?.length).toBe(200)
  })

  it('truncates an over-long cwd to the info cell', () => {
    const lines = composeBannerLines(DEPS, { ...CONTENT, cwd: 'd'.repeat(200) }, 100)
    expect(lines.join('\n')).toContain(`${'d'.repeat(23)}...`)
    expect(lines.join('\n')).not.toContain('d'.repeat(24))
    expect(lines.map(line => line.length)).toEqual(Array.from({ length: lines.length }, () => 100))
  })

  it('truncates an over-long model line to the info cell', () => {
    const lines = composeBannerLines(DEPS, { ...CONTENT, model: 'm'.repeat(100) }, 100)
    expect(lines.join('\n')).toContain(`${'m'.repeat(23)}...`)
    expect(lines.join('\n')).not.toContain('m'.repeat(24))
  })

  it('truncates over-long tips lines to the tips cell', () => {
    const lines = composeBannerLines(
      DEPS,
      { ...CONTENT, tips: { heading: 'Tips for getting started', lines: ['t'.repeat(90)] } },
      100,
    )
    expect(lines.join('\n')).toContain(`│ ${'t'.repeat(49)}...`)
    expect(lines.map(line => line.length)).toEqual(Array.from({ length: lines.length }, () => 100))
  })

  it('truncates an over-long title inside the top rule', () => {
    const lines = composeBannerLines(DEPS, { ...CONTENT, version: 'v'.repeat(100) }, 40)
    expect(lines[0]?.length).toBe(40)
  })

  it('pads with blank whale and info rows when the tips column is taller', () => {
    const lines = composeBannerLines(
      DEPS,
      { ...CONTENT, tips: { heading: 'Tips for getting started', lines: Array.from({ length: 20 }, (_, i) => `tip ${i}`) } },
      100,
    )
    // Tips column: 1 heading + 20 lines; the whale stays top-aligned.
    expect(lines).toHaveLength(2 + 21)
    expect(lines[8]).toBe(`│${' '.repeat(44)}│ tip 6${' '.repeat(47)}│`)
    const lastBody = lines[lines.length - 2] ?? ''
    expect(lastBody.startsWith(`│${' '.repeat(44)}│ tip 19`)).toBe(true)
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
    // The info cell is 27 columns wide once the tips cell joins, so the
    // banner shows the cwd's head, truncated.
    expect(joined).toContain(shortenHome(process.cwd(), homedir()).slice(0, 23))
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
