/**
 * The Blue bundle module: it mounts nothing itself (every Blue row is inserted
 * by cordis.patch.yml) and its invariant companion registers with a justified
 * empty installer.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

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

interface PatchRow {
  readonly id?: string
  readonly name?: string
  readonly group?: boolean
  readonly isolate?: Readonly<Record<string, boolean>>
  readonly config?: readonly PatchRow[]
}

const patchDocument = parseYaml(patch, { logLevel: 'silent' }) as readonly { readonly insert?: readonly PatchRow[] }[]
const insertedRows = patchDocument.flatMap(operation => operation.insert ?? [])

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

  it('inserts every Blue row with the projection-backed transcript in the baseline segment', () => {
    // The private runtime group contains the complete product segment. The
    // public host crosses its boundary; management and raw backing services do
    // not. Flattening the ids here keeps the product-order assertion explicit.
    const ids = [...patch.matchAll(/^\s*- id: (blue-[\w-]+)$/gm)].map(match => match[1]!)
    expect(ids).toEqual([
      'blue-creative-host',
      'blue-runtime-private',
      'blue-api-host',
      'blue-locale',
      'blue-core',
      'blue-theme-dark',
      'blue-banner',
      'blue-transcript',
      'blue-status-basic',
      'blue-conversation',
      'blue-transcript-official',
      'blue-editor-plus',
      'blue-attachments',
      'blue-paste-image',
      'blue-status-cwd',
      'blue-status-git',
      'blue-status-title',
      'blue-status-mode',
      'blue-status-context',
      'blue-pane-activity',
      'blue-pane-queue',
      'blue-pane-todo',
      'blue-pane-btw',
      'blue-pane-agents',
      'blue-plugin-view-bridge',
      'blue-status-provider-owner',
      'blue-interaction',
      'blue-editor-provider-owner',
      'blue-plugin-interaction-bridge',
      'blue-startup',
      'blue-app',
      'blue-plugin-session-bridge',
    ])
    // Legacy intent rows are deliberately absent; tool presentation is model-owned.
    expect(patch).not.toContain("name: '@dsh-blue/blue-transcript/intent-diff'")
    expect(patch).not.toContain("name: '@dsh-blue/blue-transcript/intent-terminal'")
    expect(patch).not.toContain("name: '@dsh-blue/blue-transcript/intent-cordis'")
    expect(patch).toContain("name: '@dsh-blue/blue-interaction/attachments'")
    expect(patch).toContain("name: '@dsh-blue/blue-interaction/paste-image'")
    expect(patch).toContain("name: '@dsh-blue/blue-harness-adapter/locale'")
    expect(patch).toContain("name: '@dsh-blue/blue-transcript/banner'")
    expect(patch).toContain("name: '@dsh-blue/blue-conversation'")
    expect(patch).toContain("name: '@dsh-blue/blue-transcript/official-model'")
    expect(patch).not.toMatch(/- id: blue-(?:context|conversation|transcript-official|openpencil|lark)\n\s+name:[^\n]+\n\s+disabled: true/gu)
    expect(patch).toContain("name: '@dsh-blue/blue-transcript/plugin-host-bridge'")
    expect(patch).toContain("name: '@dsh-blue/blue-transcript/status-provider-owner'")
    expect(patch).toContain("name: '@dsh-blue/blue-interaction/editor-provider-owner'")
    expect(patch).toContain("name: '@dsh-blue/blue-interaction/plugin-host-bridge'")
    expect(patch).toContain("name: '@dsh-blue/blue-app/plugin-host-session-bridge'")
    expect(patch).toMatch(/- id: blue-app[\s\S]*?- id: blue-plugin-session-bridge\n\s+name: '@dsh-blue\/blue-app\/plugin-host-session-bridge'\n\s+inject: \[bluePluginControl, blueSessionReader, blueSessionProjections\]/u)
    expect(patch).toContain("name: '@deepseek-ai/dsh-agent-presets'")

    const privateGroup = insertedRows.find(row => row.id === 'blue-runtime-private')
    expect(privateGroup).toMatchObject({
      name: 'cordis:group',
      group: true,
      isolate: {
        bluePluginControl: true,
        blueSessionActions: true,
        blueSessionProjections: true,
        blueSessionReader: true,
      },
    })
    expect(privateGroup?.config?.at(0)?.id).toBe('blue-api-host')
    expect(privateGroup?.config?.at(-1)?.id).toBe('blue-plugin-session-bridge')
    expect(insertedRows.filter(row => row.id === 'blue-api-host')).toEqual([])
    expect(patch).not.toContain('blueSessionRequester')
  })

  it('keeps opt-in ecosystem examples out of the default product composition', () => {
    const manifest = JSON.parse(readFileSync(join(patchDir, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(Object.keys(manifest.dependencies ?? {}).filter(name => name.startsWith('@dsh-blue-example/'))).toEqual([])
    expect(patch).not.toContain('@dsh-blue-example/')
  })

  it('extends the upstream agent-presets roster with only Blue\'s system root', () => {
    expect(patch).toContain('- id: subagent-model-selection-settings')
    expect(patch).toContain("name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'")
    expect(patch).toContain('- id: agent-presets')
    expect(patch).toContain("name: '@deepseek-ai/dsh-agent-presets'")
    expect(patch).toContain('default: standard')
    expect(patch).toContain('includeShippedRoot: true')
    expect(patch).toContain('includeUserRoot: true')
    expect(patch).not.toContain('- id: blue-agent-presets')
    expect(patch).toContain("resolve('@dsh-blue/blue/package.json')")
    expect(patch.indexOf('- id: subagent-model-selection-settings')).toBeLessThan(patch.indexOf('- id: agent-presets'))
    expect(patch.indexOf('- id: agent-presets')).toBeLessThan(patch.indexOf('- id: blue-core'))
    expect(patch.indexOf('- id: agent-presets')).toBeLessThan(patch.indexOf('- id: blue-app'))

    const manifest = JSON.parse(readFileSync(join(patchDir, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.['@deepseek-ai/dsh-tool-subagent']).toBe('0.1.2-alpha.2')
  })

  it('keeps the host fallback persona valid for agents without preset model variables', () => {
    const persona = /^- id: system-prompt\n {2}config:\n {4}persona: >-\n {6}([^\n]+)$/m.exec(patch)?.[1]
    expect(persona).toBe('You are a coding agent. Your working directory is {{cwd}}.')
    expect(persona).not.toContain('{{model}}')
  })

  it('inserts the cordis host-runner required by upstream cordis and blue-cordis', () => {
    // Host plane, mirroring the web-app bundle's own row: the runner provides
    // `dynamicCordisRunner` + `cordisInspect`, without which both creative
    // presets park `tool-cordis` and fail the roster's activation audit.
    expect(patch).toContain('- id: cordis-host-runner')
    expect(patch).toContain("name: '@deepseek-ai/dsh-cordis-host-runner'")
    expect(patch).toContain('- id: blue-creative-host')
    expect(patch).toMatch(/- id: blue-creative-host[\s\S]*?isolate:[\s\S]*?blueScreen: true[\s\S]*?bluePluginControl: true[\s\S]*?commands: true[\s\S]*?planMode: true[\s\S]*?config:[\s\S]*?- id: cordis-host-runner/u)
    expect(patch).not.toMatch(/isolate:[\s\S]*?bluePluginHost: true/u)
    expect(patch.indexOf('- id: cordis-host-runner')).toBeLessThan(patch.indexOf('- id: blue-core'))
    // The package must install with the bundle (dsh plugin add), exactly as
    // the agent-presets roster's own runtime dependency rides it.
    const manifest = JSON.parse(readFileSync(join(patchDir, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.['@deepseek-ai/dsh-cordis-host-runner']).toBeDefined()
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
    const blueOnly = new Set(['hmr', 'session-title-llm'])
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
