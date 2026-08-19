/**
 * `blue-editor-plus` plugin: enhancement layer over the shared input editor
 * mounted by `blue-input` — the `prompt | bash` input mode with shell
 * execution and echo (bash carries the triple cue: `!` prompt symbol,
 * ` ! shell mode ` border label, and the shellMode frame hue, re-asserted
 * over `blue-input`'s slash-context resolution while the mode is active),
 * plus the S14 completion polish: slash-command and `@`-file autocomplete
 * providers with fuzzy matching (`./slash-filter.ts`), slash values that
 * carry their leading slash so a single Enter accepts the selection and
 * submits, and the argument-hint ghost driven from each command's
 * `input.hint`. The mode is
 * mirrored into `./draft-stash.ts`, so a theme-swap reload re-applies the
 * triple on the rebuilt editor. The editor reference comes from the
 * package-local shared ref (`./editor-instance.ts`): `inject` cannot order
 * this plugin after `blue-input` (which provides no service), so
 * attach/detach is driven by the `'blue/input-editor-changed'` event, which
 * also re-attaches correctly when a theme reload rebuilds both plugins.
 * A bash-mode command can outlive
 * such a reload — the editor stays usable while the shell runs, so
 * `/theme` can unload this fiber before the process settles — and the echo
 * mount therefore gates on the fiber's unload flag before touching the
 * dead context.
 *
 * @module @dsh-blue/blue-interaction/editor-plus
 */

import { exec, execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDescriptor } from '@deepseek-ai/dsh-commands'
import type {
  BlueAutocompleteItem,
  BlueAutocompleteProvider,
  BlueAutocompleteSuggestions,
  BlueComponent,
  BlueComponents,
  BlueSemanticColors,
} from '@dsh-blue/blue-core'
import {
  ENHANCEMENT_EDITOR_PLUS,
  getSharedEditor,
  markEditorEnhancement,
  type SharedEditor,
} from './editor-instance.ts'
import { getStashedInputMode, stashHistory, stashInputMode } from './draft-stash.ts'
import { ACTION_BACKSPACE, ACTION_CANCEL } from './keys.ts'
import { sanitizeShellOutput } from './shell-sanitize.ts'
import { currentBlueAgent } from './session.ts'
import { filterSlashCommands } from './slash-filter.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-editor-plus'
/** Services required before the enhancement layer can attach. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap', 'commands']

/** Shell echo output caps: both bounds apply, whichever trips first. */
const SHELL_MAX_LINES = 200
const SHELL_MAX_BYTES = 64 * 1024
/** Hard cap on file-completion candidates, from either listing backend. */
const FILE_SUGGESTION_LIMIT = 200

/** Outcome of one shell command run by a {@link ShellExecutor}. */
export interface ShellExecution {
  /** Process exit code; nonzero marks failure. */
  readonly code: number
  /** Captured stdout text. */
  readonly stdout: string
  /** Captured stderr text. */
  readonly stderr: string
}

/**
 * Runs one shell command line and resolves with its outcome; never rejects
 * for a nonzero exit code.
 */
export type ShellExecutor = (command: string, cwd: string) => Promise<ShellExecution>

/** The default executor: the platform shell, cwd inherited from the process. */
const defaultShellExecutor: ShellExecutor = (command, cwd) => new Promise((resolve) => {
  exec(command, { cwd }, (error, stdout, stderr) => {
    // A signal termination reports no numeric code; normalize it to 1.
    const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
    resolve({ code, stdout, stderr })
  })
})

let shellExecutor: ShellExecutor = defaultShellExecutor

/**
 * Replace the shell executor (tests inject a fake here).
 * @param executor - the replacement, or `undefined` to restore the default.
 */
export function setShellExecutor(executor: ShellExecutor | undefined): void {
  shellExecutor = executor ?? defaultShellExecutor
}

/**
 * Lists project-relative file paths, or resolves `null` when the backend
 * is unavailable (so the caller falls back to the fs scanner).
 */
export type FdRunner = (cwd: string) => Promise<string[] | null>

/** fd flags: files only, plain output, and the two always-skipped trees. */
const FD_ARGS = ['--type', 'f', '--color', 'never', '--exclude', 'node_modules', '--exclude', '.git']

/** The default listing backend: `fd`, when installed. */
const defaultFdRunner: FdRunner = (cwd) => new Promise((resolve) => {
  execFile('fd', FD_ARGS, { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
    if (error !== null) {
      resolve(null)
      return
    }
    resolve(stdout.split('\n').filter(line => line.length > 0))
  })
})

let fdRunner: FdRunner = defaultFdRunner

/**
 * Replace the `fd` runner (tests inject a fake here).
 * @param runner - the replacement, or `undefined` to restore the default.
 */
export function setFdRunner(runner: FdRunner | undefined): void {
  fdRunner = runner ?? defaultFdRunner
}

/**
 * Recursive fs fallback behind {@link listProjectFiles}: skips hidden
 * entries (which covers `.git`) and `node_modules`, and stops at the
 * suggestion cap.
 * @param dir - the directory to scan.
 * @param root - the project root `dir` paths are reported relative to.
 * @param out - the accumulated relative paths.
 */
async function scanFiles(dir: string, root: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (out.length >= FILE_SUGGESTION_LIMIT) return
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await scanFiles(path, root, out)
    else out.push(relative(root, path))
  }
}

/**
 * List project-relative file paths for `@` completion: `fd` first, the fs
 * scanner when `fd` is missing or fails. Capped at
 * {@link FILE_SUGGESTION_LIMIT} either way; unreadable trees yield an empty
 * list rather than an error.
 * @param cwd - the project root.
 * @returns the candidate paths.
 */
async function listProjectFiles(cwd: string): Promise<string[]> {
  const viaFd = await fdRunner(cwd)
  if (viaFd !== null) return viaFd.slice(0, FILE_SUGGESTION_LIMIT)
  const found: string[] = []
  try {
    await scanFiles(cwd, cwd, found)
  } catch {
    return []
  }
  return found
}

/** The whitespace-delimited token ending at the cursor, with its start column. */
function tokenBeforeCursor(line: string, cursorCol: number): { token: string, start: number } {
  let start = cursorCol
  while (start > 0 && !/\s/.test(line.charAt(start - 1))) start -= 1
  return { token: line.slice(start, cursorCol), start }
}

/**
 * Replace one entry in a lines array.
 */
function withLine(lines: string[], index: number, line: string): string[] {
  return lines.map((existing, at) => (at === index ? line : existing))
}

/**
 * The dropdown description for one command: the argument hint joins the
 * summary (`hint — description`); a command without a hint keeps its plain
 * summary (the kimi `formatSlashCommandDescription` shape — the registry's
 * non-empty-description and non-empty-hint guarantees keep the empty
 * corners out).
 * @param command - the registered command descriptor.
 * @returns the description text.
 */
function slashItemDescription(command: CommandDescriptor): string {
  const hint = command.input?.hint
  return hint === undefined ? command.description : `${hint} — ${command.description}`
}

/**
 * Build the dispatching autocomplete provider for the shared editor: a
 * leading `/` token completes slash commands from `ctx.commands` (S14: fuzzy
 * over the command names, the prefix carried with its slash so Enter
 * accepts-and-submits through pi-tui's slash-list semantics, and the
 * argument hint joined into the description), an `@` token completes project
 * files (fuzzy over the paths). In bash mode a leading `/` is a path
 * separator, not a command — the slash branch declines so Enter runs what
 * was typed instead of applying a command.
 * @param ctx - plugin context carrying the command registry.
 * @param mode - reports the live input mode.
 * @returns the provider to hand to `BlueEditor.setAutocompleteProvider`.
 */
function createAutocompleteProvider(ctx: Context, mode: () => 'prompt' | 'bash'): BlueAutocompleteProvider {
  const cwd = process.cwd()
  return {
    triggerCharacters: ['/', '@'],
    async getSuggestions(lines, cursorLine, cursorCol, _options): Promise<BlueAutocompleteSuggestions | null> {
      const line = lines[cursorLine] ?? ''
      const { token } = tokenBeforeCursor(line, cursorCol)
      if (token.startsWith('@')) {
        const prefix = token.slice(1)
        const files = await listProjectFiles(cwd)
        const items = ctx.blueComponents
          .fuzzyFilter(files, prefix, path => path)
          .map(path => ({ value: path, label: path }))
        return { items, prefix }
      }
      const slash = /^\/(\S*)$/.exec(line.slice(0, cursorCol))
      if (slash === null || mode() === 'bash') return null
      const agent = currentBlueAgent(ctx)
      if (agent === undefined) return null
      /* v8 ignore next -- a successful exec always defines the capture group */
      const query = slash[1] ?? ''
      const items = filterSlashCommands(ctx.commands.list(agent), query, ctx.blueComponents)
        .map((command): BlueAutocompleteItem => ({
          value: `/${command.name}`,
          label: `/${command.name}`,
          description: slashItemDescription(command),
        }))
      // The value carries the slash so pi-tui's best-match preselection
      // (exact `value === prefix`, then `startsWith`) keys on the same text
      // the user typed.
      return { items, prefix: `/${query}` }
    },
    applyCompletion(lines, cursorLine, cursorCol, item, _prefix) {
      const line = lines[cursorLine] ?? ''
      const { token, start } = tokenBeforeCursor(line, cursorCol)
      if (token.startsWith('@')) {
        // Keep the '@' mention marker; replace only the partial path.
        const replaced = `${line.slice(0, start)}@${item.value}${line.slice(cursorCol)}`
        return {
          lines: withLine(lines, cursorLine, replaced),
          cursorLine,
          cursorCol: start + 1 + item.value.length,
        }
      }
      if (line.startsWith('/')) {
        // The slash item's value already carries its leading slash.
        const head = `${item.value} `
        return {
          lines: withLine(lines, cursorLine, head + line.slice(cursorCol).trimStart()),
          cursorLine,
          cursorCol: head.length,
        }
      }
      return { lines: [...lines], cursorLine, cursorCol }
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      const line = lines[cursorLine] ?? ''
      return tokenBeforeCursor(line, cursorCol).token.startsWith('@')
    },
  }
}

/**
 * Transcript-style echo of one shell command run from bash mode: the `$`
 * command line with the shell-mode marker (the kimi dim presentation; the
 * command body itself renders in the default foreground), the sanitized
 * stdout and stderr below — stderr in `error` when the exit code marks
 * failure, `textMuted` otherwise — a muted truncation row when the caps cut
 * either stream, and an error-colored exit-code row on failure. Mounted
 * into the scroll region; deliberately not part of the session transcript
 * (P2 intent).
 */
class ShellEchoComponent implements BlueComponent {
  /**
   * @param colors - the active semantic color table.
   * @param components - the width-truncation helper source.
   * @param command - the executed command line.
   * @param stdout - the sanitized, capped stdout.
   * @param stderr - the sanitized, capped stderr.
   * @param truncated - whether the caps cut either stream.
   * @param code - the process exit code.
   */
  constructor(
    private readonly colors: BlueSemanticColors,
    private readonly components: BlueComponents,
    private readonly command: string,
    private readonly stdout: string,
    private readonly stderr: string,
    private readonly truncated: boolean,
    private readonly code: number,
  ) {}

  /** No cached render state. */
  invalidate(): void {}

  /**
   * Render the command line, the output rows (each truncated to the width),
   * and the status rows.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const lines = [
      this.components.truncateToWidth(`${this.colors.shellMode('$ ')}${this.command}`, width),
    ]
    const body: string[] = []
    if (this.stdout !== '') {
      for (const line of this.stdout.split('\n')) {
        body.push(this.colors.textMuted(this.components.truncateToWidth(line, width)))
      }
    }
    const errPaint = this.code === 0 ? this.colors.textMuted : this.colors.error
    if (this.stderr !== '') {
      for (const line of this.stderr.split('\n')) {
        body.push(errPaint(this.components.truncateToWidth(line, width)))
      }
    }
    if (body.length > 0) {
      lines.push(...body)
    } else {
      lines.push(this.colors.textMuted('(no output)'))
    }
    if (this.truncated) lines.push(this.colors.muted('… output truncated'))
    if (this.code !== 0) lines.push(this.colors.error(`exit code ${this.code}`))
    return lines
  }
}

/** Apply the line and byte caps to shell output. */
function capOutput(output: string): { text: string, truncated: boolean } {
  let text = output
  let truncated = false
  if (Buffer.byteLength(text, 'utf8') > SHELL_MAX_BYTES) {
    text = Buffer.from(text, 'utf8').subarray(0, SHELL_MAX_BYTES).toString('utf8')
    truncated = true
  }
  const lines = text.split('\n')
  if (lines.length > SHELL_MAX_LINES) {
    text = lines.slice(0, SHELL_MAX_LINES).join('\n')
    truncated = true
  }
  return { text, truncated }
}

/**
 * Run one bash-mode command and mount its echo into the scroll region.
 * @param ctx - plugin context carrying the Blue services.
 * @param command - the shell command line.
 * @param isUnloaded - reports whether this fiber unloaded while the shell
 *   was still running (a `/theme` swap); a late echo then drops silently,
 *   since the dead context can neither style nor mount it.
 */
function runShell(ctx: Context, command: string, isUnloaded: () => boolean): void {
  const mount = (result: ShellExecution): void => {
    // One trailing newline is transport framing, not content.
    const stdout = capOutput(result.stdout.replace(/\r?\n$/, ''))
    const stderr = capOutput(result.stderr.replace(/\r?\n$/, ''))
    const echo = new ShellEchoComponent(
      ctx.blueTheme.colors,
      ctx.blueComponents,
      command,
      stdout.text,
      stderr.text,
      stdout.truncated || stderr.truncated,
      result.code,
    )
    // Effect-bound so unloading this fiber also removes its echoes. The
    // mount lands after the input-driven frame — the shell settles
    // asynchronously and the renderer only paints on request — so the
    // render must be asked for here or the echo stays invisible until the
    // next keypress.
    ctx.effect(() => {
      const remove = ctx.blueScreen.addChild(echo)
      ctx.blueScreen.requestRender()
      return remove
    })
  }
  void shellExecutor(command, process.cwd()).then(
    (result) => {
      if (isUnloaded()) return
      mount({
        code: result.code,
        stdout: sanitizeShellOutput(result.stdout),
        stderr: sanitizeShellOutput(result.stderr),
      })
    },
    (error: unknown) => {
      if (isUnloaded()) return
      // A rejected executor is a failure: the message becomes red stderr.
      mount({
        code: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      })
    },
  )
}

/** The bash-mode border label text (styled at attach time). */
const BASH_LABEL = '! shell mode'

/**
 * Chain the mode routing and autocomplete provider onto the shared editor,
 * preserving the handlers `blue-input` installed.
 * @param ctx - plugin context.
 * @param shared - the shared editor entry.
 * @param isUnloaded - reports whether this fiber has unloaded; forwarded to
 *   `runShell` so a shell settling after a theme-swap reload drops its echo.
 * @returns a detacher restoring the previous handlers.
 */
function attach(ctx: Context, shared: SharedEditor, isUnloaded: () => boolean): () => void {
  const { editor } = shared
  const colors = ctx.blueTheme.colors
  let mode: 'prompt' | 'bash' = getStashedInputMode()
  const previousOnChange = editor.onChange
  const previousOnSubmit = editor.onSubmit
  const previousOnKey = editor.onKey

  /** Apply the bash triple: `!` symbol, border label, and shell hue. */
  const enterBash = (): void => {
    mode = 'bash'
    stashInputMode('bash')
    editor.setPromptSymbol('!')
    editor.setBorderLabel(` ${colors.shellMode(BASH_LABEL)} `)
    editor.setBorderColor(colors.shellMode)
  }

  /** Restore the prompt-mode frame without touching the reload stash. */
  const applyPromptFrame = (): void => {
    editor.setPromptSymbol('>')
    editor.setBorderLabel(undefined)
    editor.setBorderColor(colors.border)
  }

  /** Leave bash mode: prompt frame plus the stash update. */
  const exitBash = (): void => {
    mode = 'prompt'
    stashInputMode('prompt')
    applyPromptFrame()
  }

  // A theme-swap reload rebuilt the editor while bash mode was stashed:
  // re-apply the triple so the restored draft still reads as shell input.
  if (mode === 'bash') enterBash()

  /**
   * The S14 argument-hint ghost for the current buffer: a completed command
   * token followed by at most one space shows the command's advertised
   * `input.hint` after the cursor, lead-spaced until the user types the
   * separator themselves (the kimi `computeArgumentHint` rule). Bash mode
   * has no slash commands, so its ghost is always clear.
   * @param text - the current editor buffer.
   * @returns the ghost text, or `undefined` when none applies.
   */
  const ghostHintFor = (text: string): string | undefined => {
    if (mode === 'bash') return undefined
    const match = /^\/(\S+)( ?)$/.exec(text)
    if (match === null) return undefined
    const agent = currentBlueAgent(ctx)
    if (agent === undefined) return undefined
    /* v8 ignore next -- a successful exec always defines the capture group */
    const hint = ctx.commands.list(agent).find(command => command.name === match[1])?.input?.hint
    if (hint === undefined || hint.length === 0) return undefined
    return match[2] === ' ' ? hint : ` ${hint}`
  }

  /** Re-apply the ghost after every buffer change. */
  const refreshGhost = (text: string): void => {
    editor.setGhostHint(ghostHintFor(text))
  }

  const unmark = markEditorEnhancement(ENHANCEMENT_EDITOR_PLUS)
  editor.onChange = (text) => {
    previousOnChange?.(text)
    // A buffer holding exactly '!' switches to bash mode without polluting
    // the buffer; the mode cue is the symbol + label + hue triple.
    if (mode === 'prompt' && text === '!') {
      enterBash()
      editor.setText('')
      editor.setGhostHint(undefined)
      return
    }
    // While bash is active the shell hue wins over `blue-input`'s
    // slash-context resolution (a leading `/` is a path separator here).
    if (mode === 'bash') editor.setBorderColor(colors.shellMode)
    refreshGhost(text)
  }
  // The editor clears its buffer before invoking onSubmit; the callback
  // argument already carries the paste-expanded, trimmed text.
  editor.onSubmit = (text) => {
    if (mode === 'prompt') {
      shared.submitPrompt(text)
      return
    }
    // Every bash submission falls back to prompt mode first.
    exitBash()
    const command = text.trim()
    editor.setText('')
    if (command.length === 0) return
    // Prompt and bash share the editor's internal history; the pi-tui
    // Editor exposes no per-mode filtering (known simplification). The
    // stash mirror matches `blue-input`'s, so bash entries survive a
    // theme-swap rebuild too.
    editor.addToHistory(command)
    stashHistory(editor.getHistory())
    runShell(ctx, command, isUnloaded)
  }
  editor.onKey = (data) => {
    // `blue-input`'s chain runs first: an open side-question pane or a
    // non-empty draft owns Escape, and the queue recall owns Up.
    if (previousOnKey?.(data) === true) return true
    // The kimi bash exit: Backspace or Escape on an empty `!` prompt
    // returns to prompt mode — the `!` is not in the buffer, so
    // "deleting" it is a delete on empty bash input.
    if (mode === 'bash'
      && editor.getText().length === 0
      && (ctx.blueKeymap.matches(data, ACTION_CANCEL) || ctx.blueKeymap.matches(data, ACTION_BACKSPACE))) {
      exitBash()
      return true
    }
    return false
  }
  editor.setAutocompleteProvider(createAutocompleteProvider(ctx, () => mode))
  // A draft restored before this attach (a theme-swap reload) deserves its
  // ghost without waiting for the next edit.
  refreshGhost(editor.getText())

  return () => {
    unmark()
    editor.onChange = previousOnChange
    editor.onSubmit = previousOnSubmit
    editor.onKey = previousOnKey
    editor.setGhostHint(undefined)
    // Visual restore only — the reload stash keeps the mode the user was
    // in, so a remount (theme swap) rebuilds bash where it left off.
    if (mode === 'bash') applyPromptFrame()
    else editor.setBorderColor(colors.border)
  }
}

/**
 * Attach to the shared editor whenever `blue-input` (re)mounts it; detach
 * when it unmounts or this fiber disposes.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  /**
   * Set when this fiber unloads: a bash-mode shell can settle after a
   * theme-swap reload disposed the fiber, and its late echo mount must not
   * touch services through the dead context.
   */
  let unloaded = false
  ctx.effect(() => () => {
    unloaded = true
  })
  let detach: (() => void) | undefined
  const reattach = (): void => {
    detach?.()
    detach = undefined
    const shared = getSharedEditor()
    if (shared !== undefined) detach = attach(ctx, shared, () => unloaded)
  }
  ctx.effect(() => () => {
    detach?.()
  })
  ctx.on('blue/input-editor-changed', reattach)
  reattach()
}
