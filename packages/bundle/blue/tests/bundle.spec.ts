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
/** The composed base patch: the rows Blue's disables address by id. */
const basePatch = readFileSync(join(patchDir, '..', 'node_modules', '@deepseek-ai', 'dsh-base', 'cordis.patch.yml'), 'utf8')
/** The web-app bundle patch: the harness's own thin-host ruling Blue mirrors. */
const webAppPatch = readFileSync(join(patchDir, '..', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'cordis.patch.yml'), 'utf8')

/**
 * The top-level rows a patch disables: row ids addressed at column 0 whose
 * own block carries `disabled: true`. Nested rows (an insert's entries) sit
 * past the `- ` boundary and never match.
 * @param text - a bundle patch file.
 * @returns the disabled row ids, in file order.
 */
function disabledIds(text: string): string[] {
  const ids: string[] = []
  for (const row of text.split(/(?=^- )/m)) {
    const id = /^- id: ([\w-]+)$/m.exec(row)?.[1]
    if (id !== undefined && /^ {2}disabled: true$/m.test(row)) ids.push(id)
  }
  return ids
}

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
      'blue-api-host',
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
      'blue-status-title',
      'blue-status-mode',
      'blue-status-context',
      'blue-context',
      'blue-conversation',
      'blue-transcript-official',
      'blue-openpencil',
      'blue-lark',
      'blue-intent-diff',
      'blue-intent-terminal',
      'blue-pane-activity',
      'blue-pane-queue',
      'blue-pane-todo',
      'blue-pane-btw',
      'blue-pane-agents',
      'blue-interaction',
      'blue-startup',
      'blue-app',
    ])
    // The S7/S8 rows resolve to their package subpath names.
    expect(patch).toContain("name: '@dsh-blue/blue-transcript/intent-diff'")
    expect(patch).toContain("name: '@dsh-blue/blue-transcript/intent-terminal'")
    expect(patch).toContain("name: '@dsh-blue/blue-interaction/attachments'")
    expect(patch).toContain("name: '@dsh-blue/blue-interaction/paste-image'")
    expect(patch).toContain("name: '@dsh-blue/blue-transcript/banner'")
    expect(patch).toContain("name: '@dsh-blue/blue-openpencil'")
    expect(patch).toContain("name: '@dsh-blue/blue-lark'")
    expect(patch).toContain("name: '@dsh-blue/blue-conversation'")
    expect(patch).toContain("name: '@dsh-blue/blue-transcript/official-model'")
    expect(patch.match(/- id: blue-(?:context|conversation|transcript-official|openpencil|lark)\n\s+name:[^\n]+\n\s+disabled: true/gu)).toHaveLength(5)
  })

  it('inserts the upstream agent-presets roster row ahead of the Blue rows', () => {
    expect(patch).toContain('- id: agent-presets')
    expect(patch).toContain("name: '@deepseek-ai/dsh-agent-presets'")
    expect(patch).toContain('default: standard')
    // The roster row precedes the first Blue row: it is a host-plane row the
    // launcher keys on, not part of the UI stack.
    expect(patch.indexOf('- id: agent-presets')).toBeLessThan(patch.indexOf('- id: blue-core'))
  })

  it('keeps the host fallback persona valid for agents without preset model variables', () => {
    const persona = /^- id: system-prompt\n {2}config:\n {4}persona: >-\n {6}([^\n]+)$/m.exec(patch)?.[1]
    expect(persona).toBe('You are a coding agent. Your working directory is {{cwd}}.')
    expect(persona).not.toContain('{{model}}')
  })

  it('disables exactly the web-app bundle\'s thin-host agent-plane list, every id addressing a real base row', () => {
    // The thin-host migration mirrors the harness's own ruling: the set of
    // rows the web-app bundle disables must equal Blue's, so when the base
    // grows a new agent-plane row and the harness rules on it, this spec goes
    // red until Blue follows. `hmr` rides along (both surfaces keep it off).
    // Blue additionally carries non-agent-plane overrides the web-app makes
    // no ruling on — the session-title cadence swap (S30): the base's
    // first-prompt provider stands down for the all-prompts sibling row in
    // the insert, and that is Blue's own call, outside the lockstep list.
    const blueOnly = new Set(['session-title-llm'])
    expect(disabledIds(patch).filter(id => !blueOnly.has(id))).toEqual(disabledIds(webAppPatch))
    // A typo'd id would silently disable nothing, leaving the row's tools in
    // the global layer: every disable must address a row the base defines.
    const baseRowIds = new Set([...basePatch.matchAll(/^\s*- id: ([\w-]+)$/gm)].map(match => match[1]!))
    for (const id of disabledIds(patch)) {
      if (id === 'hmr') continue
      expect(baseRowIds, `Blue disables '${id}', which the base patch does not define`).toContain(id)
    }
  })
})
