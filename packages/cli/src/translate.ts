/**
 * Argument translation (D50 decision 4): the shell owns exactly three
 * surfaces and forwards everything else untouched. `-V` it answers
 * itself; `plugin` gets the host's subcommand flag position —
 * `--profile` is a *plugin-subcommand* option, so it follows the word
 * `plugin`, while every other invocation takes it as the boot option up
 * front. Any `--profile` the user supplied is swallowed: the profile is
 * `blue`, always, and future Blue arguments can never collide with the
 * host's own flags. Parsing itself already lives in the app's startup
 * (`cmdlineArgs` + commander); the shell only re-prefixes the launcher.
 *
 * @module @dsh-blue/blue-cli/translate
 */

/** The profile the shell calibrates and boots — fixed by D50 decision 4. */
export const PROFILE = 'blue'

/** Which surface the user addressed. */
export type Invocation = 'boot' | 'plugin' | 'version'

/** One translated invocation. */
export interface Translation {
  /** The surface: answered by the shell (`version`) or forwarded. */
  readonly kind: Invocation
  /** The global dsh argv. */
  readonly dshArgs: readonly string[]
}

/**
 * Translate the shell's arguments. The version flags are honored
 * anywhere before a `--` separator (the host's own `-V` semantics), the
 * profile flags are swallowed wherever they appear, and the first
 * remaining word deciding between the plugin-subcommand and boot forms
 * is what the host's own usage rules would see.
 * @param argv - the shell's arguments (`process.argv.slice(2)` shape).
 * @returns the translated invocation.
 */
export function translateArgv(argv: readonly string[]): Translation {
  const positional: string[] = []
  let version = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined) continue
    if (arg === '--') {
      positional.push(...argv.slice(index))
      break
    }
    if (arg === '-V' || arg === '--version') {
      version = true
      continue
    }
    if (arg === '--profile' || arg.startsWith('--profile=')) {
      // Swallow the value too — but only when it is one (the same scan
      // the app's own profile readers perform).
      if (!arg.includes('=') && argv[index + 1] !== undefined && !argv[index + 1]!.startsWith('-')) index += 1
      continue
    }
    positional.push(arg)
  }
  if (version) return { kind: 'version', dshArgs: [] }
  if (positional[0] === 'plugin') {
    return { kind: 'plugin', dshArgs: ['plugin', '--profile', PROFILE, ...positional.slice(1)] }
  }
  return { kind: 'boot', dshArgs: ['--profile', PROFILE, ...positional] }
}
