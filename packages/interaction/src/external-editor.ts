/**
 * External-editor primitives for the Ctrl-G draft hand-off (S31): resolve
 * the editor command — the persisted `blue.editorCommand` setting wins,
 * then `$VISUAL`/`$EDITOR` — spawn the command over the inherited tty with
 * the draft seeded into a private temp file, and read the edited contents
 * back — the kimi `external-editor.ts` port. A nonzero exit (vim's `:cq`
 * among them) resolves `undefined`, so the caller keeps the draft
 * untouched. The launcher is a module-level hook (the
 * `setClipboardTextWriter` precedent in `./clipboard-write.ts`) so specs
 * inject fakes without spawning.
 *
 * @module @dsh-blue/blue-interaction/external-editor
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentBlueSettings } from './settings.ts'

/**
 * Resolve the external editor command: a non-blank `blue.editorCommand`
 * setting wins, then `$VISUAL` over `$EDITOR`, blank values are skipped,
 * and none set resolves `undefined` (the caller notices).
 * @param env - the environment to read (tests inject a literal object).
 * @returns the trimmed command string, or `undefined` when nothing is set.
 */
export function resolveExternalEditorCommand(
  env: { VISUAL?: string | undefined; EDITOR?: string | undefined } = process.env,
): string | undefined {
  const configured = currentBlueSettings().editorCommand
  if (configured.trim().length > 0) return configured.trim()
  for (const candidate of [env.VISUAL, env.EDITOR]) {
    if (candidate !== undefined && candidate.trim().length > 0) return candidate.trim()
  }
  return undefined
}

/**
 * Quote one shell argument (the temp-file path) for the `shell: true`
 * command line: the POSIX single-quote method with `'\''` escapes, or
 * cmd.exe double quotes on Windows.
 * @param arg - the argument to quote.
 * @param platform - the host platform (tested directly for both arms).
 * @returns the quoted argument.
 */
export function quoteShellArg(arg: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return `"${arg.replaceAll('"', '\\"')}"`
  return `'${arg.replaceAll("'", "'\\''")}'`
}

/**
 * Spawn the editor seeded with a draft and read the file back.
 * @param initialText - the draft to seed the temp file with.
 * @param command - the resolved editor command (argv-style strings ride
 *   the system shell, so `code --wait` works).
 * @returns the edited text, or `undefined` on a nonzero exit.
 */
export type ExternalEditorLauncher = (initialText: string, command: string) => Promise<string | undefined>

/**
 * The default launcher (the kimi `editInExternalEditor` port): a private
 * `mkdtemp` directory with one `prompt.md`, the command handed the tty
 * (`stdio: 'inherit'`), and the file read back on a zero exit. A signal
 * death settles as success with the file as-is — kimi's `c ?? 0`
 * semantics: the seed is what the draft already says, so the write-back
 * is a no-op for the caller.
 */
async function editInExternalEditor(initialText: string, command: string): Promise<string | undefined> {
  const dir = await mkdtemp(join(tmpdir(), 'blue-edit-'))
  const file = join(dir, 'prompt.md')
  await writeFile(file, initialText, 'utf-8')
  try {
    const shellCommand = `${command} ${quoteShellArg(file)}`
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(shellCommand, { stdio: 'inherit', shell: true })
      child.on('exit', code => {
        resolve(code ?? 0)
      })
      child.on('error', reject)
    })
    if (code !== 0) return undefined
    return await readFile(file, 'utf-8')
  } finally {
    /* v8 ignore next -- best-effort cleanup; an editor wedging its own temp dir must not mask the read-back result */
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

let externalEditorLauncher: ExternalEditorLauncher = editInExternalEditor

/**
 * Replace the external-editor launcher (tests inject a fake here).
 * @param launcher - the replacement, or `undefined` to restore the default.
 */
export function setExternalEditorLauncher(launcher: ExternalEditorLauncher | undefined): void {
  externalEditorLauncher = launcher ?? editInExternalEditor
}

/**
 * Run the current launcher: spawn the external editor seeded with
 * `initialText`, resolving the edited contents — or `undefined` when it
 * exited nonzero (the `:cq` draft-untouched semantics).
 * @param initialText - the draft as seeded (paste markers expanded).
 * @param command - the resolved editor command.
 * @returns the edited text, or `undefined` on a nonzero exit.
 */
export async function runExternalEditor(initialText: string, command: string): Promise<string | undefined> {
  return externalEditorLauncher(initialText, command)
}
