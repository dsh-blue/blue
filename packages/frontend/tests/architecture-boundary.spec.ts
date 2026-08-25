import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as frontend from '../src/index.ts'

const root = resolve(import.meta.dirname, '../../..')
const headlessPackages = ['frontend', 'harness-adapter', 'context', 'remote'] as const
const forbidden = /(?:@earendil-works\/pi-tui|from ['\"](?:react|react-dom|domino)|\b(?:ANSI|process\.stdout|process\.stdin|raw terminal)\b)/i

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(path))
    else if (entry.name.endsWith('.ts')) files.push(path)
  }
  return files
}

describe('frontend runtime architecture boundary', () => {
  it('keeps headless package source free of renderer and terminal dependencies', async () => {
    for (const packageName of headlessPackages) {
      for (const path of await sourceFiles(resolve(root, 'packages', packageName, 'src'))) {
        const source = await readFile(path, 'utf8')
        expect(source, path).not.toMatch(forbidden)
      }
    }
  })

  it('exposes a renderer-neutral public surface without renderer objects', () => {
    expect(frontend.FrontendHost).toBeTypeOf('function')
    expect(frontend.freezeModel).toBeTypeOf('function')
    expect(frontend.plainProvider).toMatchObject({ id: 'plain', capabilities: [] })
    expect(Object.keys(frontend)).not.toContain('Terminal')
  })
})
