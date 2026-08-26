/**
 * The exit epitaph (D47): the farewell line printed after the TUI tears
 * down, carrying the saved session id and the resume command so the next
 * boot can pick the conversation back up. Every deliberate exit path
 * (`/quit`, the double Ctrl-C, startup failures, the fail-loud release)
 * funnels through the launcher's dispose-the-tree-then-exit, and the
 * Node `process 'exit'` event is the only point strictly after both the
 * screen restore and the persistence coordinator's session flush — the
 * dispose ordering (blue-app's fiber unloads before blue-core's stop
 * effect; the base persistence rows unload after both) is why the hook
 * lives here rather than in a dispose chain.
 *
 * The armed line is a module-level single slot (the `draft-stash`
 * pattern): an HMR recompose disposes the tree without process exit, and
 * the remounted driver's own dispose arms again — the latest arm wins,
 * so no double print. `kill -9` and bare signals never fire 'exit'; the
 * epitaph is best-effort by design. The 'exit' contract allows only
 * synchronous work; TTY stdout writes are synchronous in practice.
 *
 * @module @dsh-blue/blue-app/exit-epitaph
 */

/** The default profile the resume command names when the launcher flags do not. */
const DEFAULT_PROFILE = 'blue'

/** The default writer: plain synchronous stdout. */
const defaultWriter = (text: string): void => {
  process.stdout.write(text)
}

/** The writer the epitaph flushes through; tests substitute a capture. */
let writer: (text: string) => void = defaultWriter

/** The single armed epitaph; the latest arm wins (HMR remounts re-arm). */
let armed: string | undefined

/** Whether the process 'exit' flush hook has been installed. */
let hooked = false

/**
 * Replace the epitaph writer (tests substitute a capture here).
 * @param next - the replacement, or `undefined` to restore the default.
 */
export function setExitEpitaphWriter(next: ((text: string) => void) | undefined): void {
  writer = next ?? defaultWriter
}

/**
 * Arm (or clear) the epitaph the process 'exit' hook flushes.
 * @param text - the farewell text, or `undefined` to print nothing.
 */
export function armExitEpitaph(text: string | undefined): void {
  armed = text
  if (!hooked) {
    hooked = true
    process.once('exit', writeArmedEpitaph)
  }
}

/** The armed epitaph, for tests. */
export function armedEpitaph(): string | undefined {
  return armed
}

/** Flush the armed epitaph — the `process 'exit'` hook body. */
export function writeArmedEpitaph(): void {
  if (armed === undefined) return
  writer(armed)
}

/**
 * The profile name the launcher flags name: a `--profile <name>` pair or
 * a `--profile=<name>` literal, defaulting to `blue` (the dev-install
 * default; no `DSH_PROFILE` environment variable exists).
 * @param argv - the process arguments (the launcher flags stay in place).
 * @returns the profile for the resume command.
 */
export function profileFromArgv(argv: readonly string[]): string {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg !== undefined && arg.startsWith('--profile=')) return arg.slice('--profile='.length)
    if (arg === '--profile') {
      const next = argv[index + 1]
      if (next !== undefined && !next.startsWith('-')) return next
    }
  }
  return DEFAULT_PROFILE
}

/**
 * Compose the epitaph: an explanatory line, then the bare resume command
 * on its own line so a terminal triple-click selects exactly it.
 * @param sessionId - the saved session id (`session-<uuid>`), verbatim.
 * @param profile - the profile the resume command names.
 * @returns the two-line farewell with its trailing newline.
 */
export function epitaphFor(sessionId: string, profile: string): string {
  return `blue · session saved · resume with:\ndsh --profile ${profile} --resume ${sessionId}\n`
}
