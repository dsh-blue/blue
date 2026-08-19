/**
 * The Blue bundle module: it mounts nothing itself (every Blue row is inserted
 * by cordis.patch.yml) and its invariant companion registers with a justified
 * empty installer.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as bundle from '../src/index.ts'
import * as BundleInvariant from '../src/invariant.ts'

/** The patch file's own directory (fixtures and structure live next to src). */
const patchDir = dirname(fileURLToPath(import.meta.url))
const patch = readFileSync(join(patchDir, '..', 'cordis.patch.yml'), 'utf8')

describe('blue bundle', () => {

  it('mounts and disposes cleanly, registering nothing of its own', async () => {
    const ctx = new Context()
    await ctx.plugin(bundle)
    await ctx.fiber.dispose()
  })

  it('registers its invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(BundleInvariant)
    await ctx.fiber.dispose()
  })

  it('inserts every Blue row the bundle ships, with the intent and paste rows in the enhancement segment', () => {
    // The baseline segment: core, theme, banner (before the transcript so
    // the same-round activation keeps it the first scroll child), transcript,
    // and the baseline footer entry. The enhancement rows mount order:
    // editor-plus first, the input-side attachment store + paste layer next,
    // then the footer entries, then the two intent rows, then the panes, then
    // the assembly segment.
    const ids = [...patch.matchAll(/^\s*- id: (blue-[\w-]+)$/gm)].map(match => match[1]!)
    expect(ids).toEqual([
      'blue-core',
      'blue-theme-dark',
      'blue-banner',
      'blue-transcript',
      'blue-status-basic',
      'blue-editor-plus',
      'blue-attachments',
      'blue-paste-image',
      'blue-status-cwd',
      'blue-status-git',
      'blue-status-tips',
      'blue-status-context',
      'blue-intent-diff',
      'blue-intent-terminal',
      'blue-pane-activity',
      'blue-pane-queue',
      'blue-pane-todo',
      'blue-pane-btw',
      'blue-interaction',
      'blue-startup',
      'blue-app',
    ])
    // The S7/S8 rows resolve to their package subpath names.
    expect(patch).toContain("name: '@deepseek-ai/dsh-blue-transcript/intent-diff'")
    expect(patch).toContain("name: '@deepseek-ai/dsh-blue-transcript/intent-terminal'")
    expect(patch).toContain("name: '@deepseek-ai/dsh-blue-interaction/attachments'")
    expect(patch).toContain("name: '@deepseek-ai/dsh-blue-interaction/paste-image'")
    expect(patch).toContain("name: '@deepseek-ai/dsh-blue-transcript/banner'")
  })
})

