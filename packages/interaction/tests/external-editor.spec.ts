/**
 * Tests for the S31 external-editor primitives (`external-editor.ts`):
 * the $VISUAL/$EDITOR resolution order, shell quoting per platform, the
 * default launcher driving real child processes through a PATH-injected
 * fake editor (the clipboard-write spec's fakeBin pattern), and the
 * injectable launcher hook.
 */

import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SettingsProvider, { type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as settingsPlugin from '../src/settings.ts'
import { InteractionStateService } from '../src/runtime-state.ts'
import {
  quoteShellArg,
  resolveExternalEditorCommand,
  runExternalEditor,
  setExternalEditorLauncher,
} from '../src/external-editor.ts'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'

registerTempDirCleanup()

describe('resolveExternalEditorCommand', () => {
  it('prefers $VISUAL over $EDITOR', () => {
    expect(resolveExternalEditorCommand({ VISUAL: 'vim', EDITOR: 'nano' })).toBe('vim')
  })

  it('falls back to $EDITOR when $VISUAL is unset', () => {
    expect(resolveExternalEditorCommand({ EDITOR: 'nano' })).toBe('nano')
  })

  it('skips blank values', () => {
    expect(resolveExternalEditorCommand({ VISUAL: '   ', EDITOR: 'emacs' })).toBe('emacs')
  })

  it('resolves undefined with nothing set', () => {
    expect(resolveExternalEditorCommand({})).toBeUndefined()
  })

  it('trims surrounding whitespace', () => {
    expect(resolveExternalEditorCommand({ VISUAL: '  code --wait  ' })).toBe('code --wait')
  })

  it('prefers a configured blue.editorCommand over $VISUAL/$EDITOR', async () => {
    const ctx = new Context()
    new InteractionStateService(ctx, settingsPlugin.DEFAULT_SETTINGS)
    ctx.provide('blueCurrentAgent', {
      current: () => null,
      revision: () => 0,
      subscribe: () => () => {},
    } as never)
    await ctx.plugin(MemorySettings, { blue: { editorCommand: '  my-editor --wait  ' } })
    await ctx.plugin(settingsPlugin)
    await vi.waitFor(() => {
      expect(resolveExternalEditorCommand(
        { VISUAL: 'vim', EDITOR: 'nano' },
        settingsPlugin.currentBlueSettings(ctx).editorCommand,
      )).toBe('my-editor --wait')
    })
  })
})

/** A settings provider with the stored document as its constructor config. */
class MemorySettings extends SettingsProvider {
  readonly writable = true
  private readonly doc: Record<string, unknown>

  constructor(ctx: Context, doc?: Record<string, unknown>) {
    super(ctx)
    this.doc = doc ?? {}
  }

  protected async load(): Promise<Record<string, unknown>> {
    return this.doc
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[String(ns)] = section
  }
}

describe('quoteShellArg', () => {
  it('single-quotes plain POSIX arguments', () => {
    expect(quoteShellArg('/tmp/blue-edit-x/prompt.md', 'linux')).toBe(`'/tmp/blue-edit-x/prompt.md'`)
  })

  it("escapes embedded single quotes the '\\'\\'' way", () => {
    expect(quoteShellArg("it's", 'linux')).toBe(`'it'\\''s'`)
  })

  it('double-quotes on win32', () => {
    expect(quoteShellArg('C:\\temp\\prompt.md', 'win32')).toBe('"C:\\temp\\prompt.md"')
  })

  it('escapes embedded double quotes on win32', () => {
    expect(quoteShellArg('a"b', 'win32')).toBe('"a\\"b"')
  })
})

describe('default launcher', () => {
  const savedPath = process.env.PATH

  afterEach(() => {
    process.env.PATH = savedPath
    setExternalEditorLauncher(undefined)
  })

  /** Put the fake bin ahead of the real PATH so the shell resolves it. */
  function prependBin(bin: string): void {
    process.env.PATH = `${bin}:${savedPath}`
  }

  /** A fake editor bin with one executable script of the given body. */
  function fakeEditorBin(name: string, script: string): string {
    const bin = mkdtempTracked('blue-editor-bin-')
    writeFileSync(join(bin, name), script)
    chmodSync(join(bin, name), 0o755)
    return bin
  }

  it('seeds the temp file, reads the edit back, and cleans up', async () => {
    const bin = fakeEditorBin('blue-fake-editor', '#!/bin/sh\necho ", edited" >> "$1"\nexit 0\n')
    prependBin(bin)
    await expect(runExternalEditor('seed text', 'blue-fake-editor')).resolves.toBe('seed text, edited\n')
  })

  it('resolves undefined on a nonzero exit — the :cq semantics', async () => {
    const bin = fakeEditorBin('blue-fake-editor', '#!/bin/sh\nexit 1\n')
    prependBin(bin)
    await expect(runExternalEditor('draft stays', 'blue-fake-editor')).resolves.toBeUndefined()
  })

  it('resolves undefined when the shell cannot find the editor command', async () => {
    // With shell:true the shell itself resolves the command: a missing
    // editor exits 127 through it rather than surfacing a spawn error.
    prependBin(mkdtempTracked('blue-editor-bin-empty-'))
    await expect(runExternalEditor('draft stays', 'blue-missing-editor-x')).resolves.toBeUndefined()
  })

  it('treats a signal death as success and reads the seed back unchanged', async () => {
    // The editor script kills its parent shell ($PPID) with a signal, so
    // the spawned shell dies signal-first: the exit code is null and the
    // `?? 0` arm settles it as success with the file untouched.
    const bin = fakeEditorBin('blue-fake-editor', '#!/bin/sh\nkill -9 $PPID\nexit 0\n')
    prependBin(bin)
    await expect(runExternalEditor('unchanged seed', 'blue-fake-editor')).resolves.toBe('unchanged seed')
  })
})

describe('launcher hook', () => {
  afterEach(() => {
    setExternalEditorLauncher(undefined)
  })

  it('routes runExternalEditor through the injected launcher and restores on undefined', async () => {
    const calls: Array<[string, string]> = []
    setExternalEditorLauncher((seed, command) => {
      calls.push([seed, command])
      return Promise.resolve('from the fake')
    })
    await expect(runExternalEditor('the seed', 'the command')).resolves.toBe('from the fake')
    expect(calls).toEqual([['the seed', 'the command']])
    // Restoring undefined returns the default launcher; a missing command
    // through it still exercises the real path (shell exit 127 → undefined).
    setExternalEditorLauncher(undefined)
    await expect(runExternalEditor('x', 'blue-missing-editor-x')).resolves.toBeUndefined()
  })
})
