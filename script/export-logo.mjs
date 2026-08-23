// Derives the social visuals from the interim logo — the blue terminal
// favicon (website/public/favicon.svg), per the 2026-08 decision that promo
// visuals do not use the whale banner (DeepSeek mascot association); the
// whale stays product-UI-only. Emits:
//   website/public/og.png             1200x630  — site open-graph card
//   docs/assets/social-preview.png    1280x640  — GitHub social preview
// Run: pnpm logo:export   (deterministic: no timestamps, byte-stable SVG-free)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { root } from './smoke-lib.mjs'

const FONT_FILES = [
  join(root, 'docs/assets/fonts/JetBrainsMono-Regular.ttf'),
  join(root, 'docs/assets/fonts/JetBrainsMono-Bold.ttf'),
]

// The favicon's children, embedded as a nested svg so the icon stays
// single-sourced from the file the browser actually sees.
const iconInner = readFileSync(join(root, 'website/public/favicon.svg'), 'utf8')
  .replace(/<\?xml[^>]*\?>/, '')
  .replace(/<svg[^>]*>/, '')
  .replace('</svg>', '')
  .trim()
const iconAt = (x, y, size) =>
  `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${iconInner}</svg>`

const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/**
 * The promo card: dark stage, terminal icon, Blue wordmark, one-liner, the
 * architecture slogan, and the site corner tag.
 */
function card({ width, height, icon, textX }) {
  const { x, y, size } = icon
  const parts = [
    `<rect width="${width}" height="${height}" fill="#0b0e1a"/>`,
    `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="#1e263f" stroke-width="2"/>`,
    iconAt(x, y, size),
    `<text x="${textX}" y="${y + size / 2 + 44}" font-family="JetBrains Mono" font-weight="700" font-size="112" fill="#ffffff">Blue</text>`,
    `<text x="${textX + 4}" y="${y + size / 2 + 100}" font-family="JetBrains Mono" font-size="33" fill="#e0e0e0">${escape('A terminal UI for DeepSeek Harness (dsh)')}</text>`,
    `<text x="${textX + 4}" y="${y + size / 2 + 146}" font-family="JetBrains Mono" font-size="26" fill="#8b93a8">${escape('A TUI is not a package — it is a Cordis plugin tree.')}</text>`,
    `<text x="${width - 64}" y="${height - 52}" text-anchor="end" font-family="JetBrains Mono" font-size="24" fill="#4fa8ff">dsh-blue.dev</text>`,
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('')}</svg>`
}

const png = (svg, path, extraFonts = []) => {
  const rendered = new Resvg(svg, {
    font: {
      fontFiles: [...FONT_FILES, ...extraFonts],
      loadSystemFonts: false,
      defaultFontFamily: 'JetBrains Mono',
    },
  }).render().asPng()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, rendered)
  console.log(`LOGO_EXPORT ${path} ${(rendered.length / 1024).toFixed(0)}KB`)
}

// The Chinese banner's body lines need CJK glyphs — JetBrains Mono has none.
// The system Noto Sans CJK collection covers them (generation machine
// dependency, same posture as the other non-gated PNG artifacts).
const CJK_FONTS = [
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
]

/** The Chinese variant of the card: same stage, CJK body lines. */
function cardZh({ width, height, icon, textX }) {
  const { x, y, size } = icon
  const parts = [
    `<rect width="${width}" height="${height}" fill="#0b0e1a"/>`,
    `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="#1e263f" stroke-width="2"/>`,
    iconAt(x, y, size),
    `<text x="${textX}" y="${y + size / 2 + 44}" font-family="JetBrains Mono" font-weight="700" font-size="112" fill="#ffffff">Blue</text>`,
    `<text x="${textX + 4}" y="${y + size / 2 + 100}" font-family="Noto Sans CJK SC" font-size="34" fill="#e0e0e0">${escape('DeepSeek Harness（dsh）的插件式终端界面')}</text>`,
    `<text x="${textX + 4}" y="${y + size / 2 + 146}" font-family="Noto Sans CJK SC" font-size="27" fill="#8b93a8">${escape('TUI 不是一个包，而是一棵 Cordis 插件树。')}</text>`,
    `<text x="${width - 64}" y="${height - 52}" text-anchor="end" font-family="JetBrains Mono" font-size="24" fill="#4fa8ff">dsh-blue.dev</text>`,
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('')}</svg>`
}


png(
  card({ width: 1200, height: 630, icon: { x: 96, y: 215, size: 200 }, textX: 368 }),
  join(root, 'website/public/og.png'),
)
png(
  card({ width: 1280, height: 640, icon: { x: 108, y: 226, size: 188 }, textX: 372 }),
  join(root, 'docs/assets/social-preview.png'),
)
png(
  cardZh({ width: 1280, height: 640, icon: { x: 108, y: 226, size: 188 }, textX: 372 }),
  join(root, 'docs/assets/social-preview-zh.png'),
  CJK_FONTS,
)
