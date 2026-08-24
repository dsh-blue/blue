/**
 * Tests for the creative-preset overlay (S39): the module resolves the
 * nested host's shipped `cordis` directory from the manifest seam, points
 * the sync seam at the package's own payload with the version stamp, and
 * maps a missing host to the `{ error }` degradation the main flow warns
 * on without refusing the boot.
 */

import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cliInternals, type PresetSyncResult } from '../src/internals.ts'
import { syncCreativePreset } from '../src/presets.ts'

/** The real seams, restored after every test. */
const REAL = { ...cliInternals }

afterEach(() => {
  Object.assign(cliInternals, REAL)
})

/** One recorded syncPresetTree call. */
interface SyncCall {
  sourceDir: string
  targetDir: string
  stamp: string
}

describe('cli/presets syncCreativePreset', () => {
  it('degrades to an error when the nested host is missing', () => {
    cliInternals.resolveNestedDshManifest = () => undefined
    expect(syncCreativePreset('0.1.0-rc.7')).toEqual({ error: 'the pinned @deepseek-ai/dsh host is missing' })
  })

  it('targets the nested host\'s shipped cordis directory with the package payload and the version stamp', () => {
    cliInternals.resolveNestedDshManifest = () => join('/', 'hosts', 'dsh', 'package.json')
    const calls: SyncCall[] = []
    cliInternals.syncPresetTree = (sourceDir, targetDir, stamp) => {
      calls.push({ sourceDir, targetDir, stamp })
      return 'fresh'
    }
    expect(syncCreativePreset('0.1.0-rc.7')).toBe('fresh')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.targetDir).toBe(join('/', 'hosts', 'dsh', 'config', 'agent-presets', 'cordis'))
    expect(calls[0]?.sourceDir).toMatch(/presets[/\\]cordis[/\\]?$/)
    expect(calls[0]?.stamp).toBe('blue-cli 0.1.0-rc.7')
  })

  it('passes every seam outcome through untouched', () => {
    cliInternals.resolveNestedDshManifest = () => join('/', 'dsh', 'package.json')
    for (const outcome of ['synced', { error: 'EACCES' }] as PresetSyncResult[]) {
      cliInternals.syncPresetTree = () => outcome
      expect(syncCreativePreset('0.1.0-rc.7')).toBe(outcome)
    }
  })
})
