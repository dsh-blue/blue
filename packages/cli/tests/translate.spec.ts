/**
 * Tests for the shell's argument translation (D50 decision 4): the
 * version self-answer surface, the `--profile` swallow, and the two
 * forwarding forms (boot prefix vs the plugin subcommand's flag
 * position).
 */

import { describe, expect, it } from 'vitest'
import { PROFILE, translateArgv } from '../src/translate.ts'

describe('translateArgv', () => {
  it('prefixes the boot profile flag on a bare invocation', () => {
    expect(translateArgv([])).toEqual({ kind: 'boot', dshArgs: ['--profile', PROFILE] })
  })

  it('forwards task arguments and launcher flags after the profile', () => {
    expect(translateArgv(['fix', 'the', 'build'])).toEqual({ kind: 'boot', dshArgs: ['--profile', PROFILE, 'fix', 'the', 'build'] })
    expect(translateArgv(['--resume', 'abc123'])).toEqual({ kind: 'boot', dshArgs: ['--profile', PROFILE, '--resume', 'abc123'] })
    expect(translateArgv(['--patch', './extra.yml'])).toEqual({ kind: 'boot', dshArgs: ['--profile', PROFILE, '--patch', './extra.yml'] })
    expect(translateArgv(['--dump-config'])).toEqual({ kind: 'boot', dshArgs: ['--profile', PROFILE, '--dump-config'] })
  })

  it('places the profile flag after the plugin subcommand word', () => {
    expect(translateArgv(['plugin', 'add', '@dsh-blue/blue@rc'])).toEqual({
      kind: 'plugin',
      dshArgs: ['plugin', '--profile', PROFILE, 'add', '@dsh-blue/blue@rc'],
    })
  })

  it('swallows a user-supplied profile wherever it appears, value included', () => {
    expect(translateArgv(['--profile', 'other', 'task'])).toEqual({ kind: 'boot', dshArgs: ['--profile', PROFILE, 'task'] })
    expect(translateArgv(['--profile=other'])).toEqual({ kind: 'boot', dshArgs: ['--profile', PROFILE] })
    expect(translateArgv(['task', '--profile', 'other'])).toEqual({ kind: 'boot', dshArgs: ['--profile', PROFILE, 'task'] })
    expect(translateArgv(['plugin', '--profile', 'other', 'add', 'x'])).toEqual({
      kind: 'plugin',
      dshArgs: ['plugin', '--profile', PROFILE, 'add', 'x'],
    })
  })

  it('leaves a value-less profile flag for the host to reject, not swallowing the next flag', () => {
    expect(translateArgv(['--profile', '--dump-config'])).toEqual({ kind: 'boot', dshArgs: ['--profile', PROFILE, '--dump-config'] })
    expect(translateArgv(['--profile'])).toEqual({ kind: 'boot', dshArgs: ['--profile', PROFILE] })
  })

  it('answers the version surface wherever the flag appears before --', () => {
    expect(translateArgv(['-V'])).toEqual({ kind: 'version', dshArgs: [] })
    expect(translateArgv(['--version'])).toEqual({ kind: 'version', dshArgs: [] })
    expect(translateArgv(['--resume', 'x', '-V'])).toEqual({ kind: 'version', dshArgs: [] })
  })

  it('keeps a -- separator and everything after it verbatim', () => {
    expect(translateArgv(['--', '--profile', 'evil', '-V'])).toEqual({
      kind: 'boot',
      dshArgs: ['--profile', PROFILE, '--', '--profile', 'evil', '-V'],
    })
  })

  it('skips sparse-array holes without treating them as arguments', () => {
    const sparse = ['fix'] as (string | undefined)[]
    sparse[3] = 'end'
    expect(translateArgv(sparse as unknown as readonly string[])).toEqual({
      kind: 'boot',
      dshArgs: ['--profile', PROFILE, 'fix', 'end'],
    })
  })
})
