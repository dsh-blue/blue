/**
 * `blue-editor-plus` plugin: enhancement layer over the shared input editor
 * mounted by `blue-input` — the `prompt | bash` input mode with shell
 * execution and echo (bash carries the triple cue: `!` prompt symbol,
 * ` ! shell mode ` border label, and the shellMode frame hue, re-asserted
 * over `blue-input`'s slash-context resolution while the mode is active),
 * plus the S14 completion polish: slash-command and `@`-file autocomplete
 * with fuzzy matching over the command names (`./slash-filter.ts`), slash
 * values that carry their leading slash so a single Enter accepts the
 * selection and submits, and the argument-hint ghost driven from each
 * command's `input.hint`. `@` mentions run the S22 kimi composition
 * (`./file-mention.ts`): the L0 fd pipeline — scoped queries, substring
 * scoring, top-20, quoted values — with the filesystem fallback while fd
 * is unavailable. The mode is
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

import { exec } from 'node:child_process'
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
import { canonicalOf, withCommandAliases } from './command-meta.ts'
import { detectFdPath, extractAtPrefix, fsMentionSuggestions, listDirectoryMentions } from './file-mention.ts'
import { getStashedInputMode, stashHistory, stashInputMode } from './draft-stash.ts'
import { ACTION_BACKSPACE, ACTION_CANCEL } from './keys.ts'
import { sanitizeShellOutput } from './shell-sanitize.ts'
import { currentBlueAgent } from './session.ts'
import { filterSlashCommands, slashCommandLabel } from './slash-filter.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-editor-plus'
/** Services required before the enhancement layer can attach. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap', 'commands']

/** Shell echo output caps: both bounds apply, whichever trips first. */
const SHELL_MAX_LINES = 200
const SHELL_MAX_BYTES = 64 * 1024

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
 * argument hint joined into the description), an `@` token completes
 * project paths as mentions (the S22 kimi composition: the L0 fd pipeline
 * with scoped queries, substring scoring, top-20, and quoted values, the
 * filesystem fallback while fd is unavailable, values carrying their `@`,
 * and `applyCompletion` delegated so directories stay open for drill-down;
 * an empty result — the empty-session-cwd corner among them — flashes a
 * hint-line notice instead of failing silently, the S22 dogfood fix).
 * `@` takes priority over the slash guards so mentions work inside command
 * arguments. In bash mode a leading `/` is a path separator, not a command
 * — the slash branch declines so Enter runs what was typed instead of
 * applying a command.
 * @param ctx - plugin context carrying the command registry.
 * @param mode - reports the live input mode.
 * @param notice - flashes the empty-result notice into the hint line.
 * @returns the provider to hand to `BlueEditor.setAutocompleteProvider`.
 */
function createAutocompleteProvider(
  ctx: Context,
  mode: () => 'prompt' | 'bash',
  notice: (text: string) => void,
): BlueAutocompleteProvider {
  const cwd = process.cwd()
  // Captured before any unload: the fd probe settles asynchronously and a
  // theme-swap reload may dispose this fiber first — the service object
  // reference stays callable where the context proxy would not.
  const components = ctx.blueComponents
  // Rebuilt when the probe settles: the combined provider reads its fdPath
  // at suggestion time, so a late detection needs a fresh instance. Until
  // then fdPath is null and the @ branch runs the filesystem fallback.
  let fdPath: string | null = null
  let inner = components.createFileMentionProvider(cwd, null)
  void detectFdPath().then(resolved => {
    fdPath = resolved
    inner = components.createFileMentionProvider(cwd, resolved)
  })
  return {
    triggerCharacters: ['/', '@'],
    async getSuggestions(lines, cursorLine, cursorCol, options): Promise<BlueAutocompleteSuggestions | null> {
      const line = lines[cursorLine] ?? ''
      const atPrefix = extractAtPrefix(line.slice(0, cursorCol))
      if (atPrefix !== null) {
        let suggestions: BlueAutocompleteSuggestions | null = null
        // Empty-tail tokens (a bare `@` or a directory drill-down) take the
        // one-level listing: deterministic, shallow, exactly the entries of
        // the resolved directory. Everything else — query-bearing tokens —
        // runs the fd pipeline (fd's genuine no-match stays null, kimi: no
        // fallback on it); only a missing or throwing fd runs the scanner.
        suggestions = await listDirectoryMentions(cwd, atPrefix, options.signal)
        let fellBack = suggestions === null && fdPath === null
        if (suggestions === null && fdPath !== null) {
          try {
            suggestions = await inner.getSuggestions(lines, cursorLine, cursorCol, options)
          } catch {
            // fd failing to spawn mid-session falls back to the scanner.
            fellBack = true
          }
        }
        if (suggestions === null && fellBack) {
          suggestions = await fsMentionSuggestions(cwd, atPrefix, options.signal)
        }
        // An empty mention result would close the dropdown without a
        // trace — the empty-session-cwd corner read as "@ is dead". Flash
        // the hint line instead; a superseded (aborted) round stays quiet.
        if (suggestions === null && !options.signal.aborted) {
          notice('no matching files under the session cwd')
        }
        return suggestions
      }
      const slash = /^\/(\S*)$/.exec(line.slice(0, cursorCol))
      if (slash === null || mode() === 'bash') return null
      const agent = currentBlueAgent(ctx)
      if (agent === undefined) return null
      /* v8 ignore next -- a successful exec always defines the capture group */
      const query = slash[1] ?? ''
      // The kimi match rule: the canonical name scores first, aliases count
      // only when it misses, and an alias match labels the canonical command
      // with its alias list (`/quit (q, exit)`) so the user sees why it
      // surfaced; the value always completes to the canonical name.
      const items = filterSlashCommands(
        withCommandAliases(ctx.commands.list(agent)),
        query,
        ctx.blueComponents,
      ).map((match): BlueAutocompleteItem => ({
        value: `/${match.command.name}`,
        label: slashCommandLabel(match),
        description: slashItemDescription(match.command),
      }))
      // The value carries the slash so pi-tui's best-match preselection
      // (exact `value === prefix`, then `startsWith`) keys on the same text
      // the user typed.
      return { items, prefix: `/${query}` }
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      const line = lines[cursorLine] ?? ''
      if (extractAtPrefix(line.slice(0, cursorCol)) !== null && prefix.startsWith('@')) {
        // Delegated whole: the combined provider's @ branch keeps the '@',
        // appends the trailing space only for files, and parks the cursor
        // inside a closing quote for quoted directories.
        return inner.applyCompletion(lines, cursorLine, cursorCol, item, prefix)
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
      return extractAtPrefix(line.slice(0, cursorCol)) !== null
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
    const name = match[1] ?? ''
    // An alias token (`/q `) resolves to its canonical command for the hint,
    // mirroring the dispatch rewrite — aliases are not registered commands.
    const canonical = canonicalOf(name) ?? name
    const hint = ctx.commands.list(agent).find(command => command.name === canonical)?.input?.hint
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
  editor.setAutocompleteProvider(createAutocompleteProvider(ctx, () => mode, text => shared.notice?.(text)))
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
