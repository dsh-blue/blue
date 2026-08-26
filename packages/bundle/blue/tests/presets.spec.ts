/**
 * Blue's bundle-local preset roster: it carries all four modes, exposes the
 * Blue creative metadata, and never points at the host's shipped root.
 *
 * @module @dsh-blue/blue/tests/presets
 */

import { describe, expect, it } from 'vitest'

describe('Blue preset roster', () => {
  it('ships all four metadata rows with a Blue-specific creative mode', () => {
    const blueRoot = new URL('../presets/', import.meta.url)
    const metadata = ['standard', 'code', 'minimal', 'cordis'].map(id => readFileSync(new URL(`${id}/preset.yml`, blueRoot), 'utf8'))
    expect(metadata).toHaveLength(4)
    expect(metadata[3]).toContain('name: 创造模式')
    expect(metadata[3]).toContain('Blue')
  })

  it('keeps the non-creative presets byte-for-byte on the pinned harness line', () => {
    const require = createRequire(import.meta.url)
    const harnessRoot = join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'config', 'agent-presets')
    const blueRoot = new URL('../presets/', import.meta.url)
    for (const id of ['standard', 'code', 'minimal']) {
      for (const file of ['agent.cordis.yml', 'preset.yml']) {
        expect(readFileSync(new URL(`${id}/${file}`, blueRoot), 'utf8')).toBe(readFileSync(join(harnessRoot, id, file), 'utf8'))
      }
    }
  })
})
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
