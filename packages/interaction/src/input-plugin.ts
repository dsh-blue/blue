/**
 * `blue-input` plugin: the bottom input editor, backed by the pi-tui Editor
 * through `ctx.blueComponents.createEditor` (multi-line, kill-ring, undo,
 * history, and paste markers are the component's own). The editor mounts
 * with `paddingX: 4` and the `>` prompt symbol, feeding the rounded-box
 * chrome the core adapter overlays; slash-prefixed input highlights the
 * frame in `primary` and any other text returns the neutral border. Submit
 * dispatches a slash command through `ctx.commands` when the line parses as
 * one, otherwise queues the text as a user follow-up message on the current
 * agent (the harness inbox queues it when the agent is running). S29: the
 * follow-up and Ctrl-S steer paths rewrite `#name` tokens naming settled
 * user-invocable skills into the `/name` harness gesture form (the
 * `./skills-catalog.ts` rewrite — line-start slashes stay a strict command
 * domain; skills reach the model through the follow-up channel, and the
 * editor history keeps the `#name` the user typed), and the fiber keeps the
 * skills catalog attached for the `#` completion branch. A hint
 * line below the editor carries the transient tiers — one-shot notices and
 * slash-command discovery in `muted` (S14: fuzzy-matched through the same
 * `./slash-filter.ts` the dropdown uses) — and renders zero rows
 * otherwise (the S15 dogfood verdict retired the persistent
 * key-affordance row: kimi teaches affordances through the footer's
 * rotating tips instead, and the tips pool already covers every fragment
 * the row carried). The editor-context key chain (Escape clear/interrupt, Ctrl-C
 * clear/interrupt/double-press exit, Ctrl-S steer, Ctrl-G external
 * editor) resolves through
 * `ctx.blueKeymap` in the editor's `onKey` hook, which runs before the
 * pi-tui Editor sees the sequence. The mounted editor and the submit router
 * are published through
 * `./editor-instance.ts` so `blue-editor-plus` can layer input modes and
 * autocomplete over the same component. When the `blue-pane-queue`
 * enhancement is loaded, an Up press with an empty buffer recalls the most
 * recently queued inbox message as the draft (gated on its keyless
 * `blue.queue.recall` action; the baseline leaves Up to the editor's
 * history). While the side-question pane is docked above the editor
 * (`'blue/editor-connected-above'`), Esc closes it — the draft stays intact
 * — Up/Down with an empty buffer scroll it, and Enter submits the draft to
 * the side conversation instead of the main agent (refused with a notice
 * while the side agent is still answering, the draft restored). The
 * unsubmitted draft is mirrored
 * into `./draft-stash.ts`, so a theme-swap reload (the theme provider fiber
 * disposes, Cordis re-runs this `blueTheme` dependent) restores the text
 * into the freshly mounted editor. The same reload can land while a slash
 * command is still in flight — `/theme` disposes the theme provider between
 * `execute()` and its continuation — so the submit continuation gates on
 * the fiber's unload flag before touching the hint; a late notice is moot
 * anyway, since the reloaded fiber repaints. Command result notices are
 * flattened to one display row before truncation: an upstream command can
 * return multi-line status text, but embedded line breaks must never escape
 * the screen's one-string-per-terminal-row contract.
 *
 * @module @dsh-blue/blue-interaction/input-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  BlueComponent,
  BlueComponents,
  BlueFocusable,
  BlueScreen,
  BlueSemanticColors,
} from '@dsh-blue/blue-core'
import { parseCommand } from '@deepseek-ai/dsh-commands'
// Carries the app-owned retraction service and event/service declaration merges.
import type {} from '@dsh-blue/blue-app'
// Empty type import carries the `permissionPresets` Context merge the
// bare-/permission interception probes (the service rides dsh-base).
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@dsh-blue/blue-transcript'
import {
  applyReversibleSubmitTransformers,
  clearSharedEditor,
  setEditorSlotSwap,
  setSharedEditor,
} from './editor-instance.ts'
import { resolveExternalEditorCommand, runExternalEditor } from './external-editor.ts'
import { currentBlueSettings } from './settings.ts'
import {
  ACTION_CANCEL,
  ACTION_CYCLE_MODE,
  ACTION_CYCLE_MODEL,
  ACTION_EXTERNAL_EDITOR,
  ACTION_INTERRUPT,
  ACTION_MOVE_DOWN,
  ACTION_MOVE_UP,
  ACTION_STEER,
} from './keys.ts'
import { createModelListCache, cycleSessionModel } from './model-commands.ts'
import { cycleMode } from './mode-commands.ts'
import { openPermissionPanel } from './permission-panel.ts'
import { ACTION_QUEUE_RECALL } from './pane-queue.ts'
import { rewriteSkillTokens } from './skills-catalog.ts'
import { filterSlashCommands } from './slash-filter.ts'

/** Window for the double Ctrl-C exit: presses farther apart re-arm the hint. */
const INTERRUPT_DOUBLE_PRESS_MS = 1000
const KEY_PAGE_UP = '\x1b[5~'
const KEY_PAGE_DOWN = '\x1b[6~'
const KEY_END = '\x1b[F'

/** Command descriptors projected through the app-owned session boundary. */
function availableCommands(ctx: Context) {
  return ctx.blueSessionActions.commands().map(command => ({
    name: command.name,
    ...(command.description === undefined ? {} : { description: command.description }),
    ...(command.inputHint === undefined ? {} : { input: { hint: command.inputHint } }),
  }))
}

function wheelDirection(data: string): 'up' | 'down' | undefined {
  /* v8 ignore start -- exercised by real mouse reports */
  const legacy = data.length === 6 && data.startsWith('\x1b[M')
  const raw = legacy ? data.charCodeAt(3) - 32 : /^\x1b\[<(\d+);\d+;\d+[Mm]$/.exec(data)?.[1]
  /* v8 ignore next 4 -- exercised by real mouse reports */
  if (raw === undefined) return undefined
  const button = typeof raw === 'number' ? raw : Number.parseInt(raw, 10)
  /* v8 ignore next */
  if ((button & 64) === 0) return undefined
  /* v8 ignore next */
  return (button & 3) === 0 ? 'up' : (button & 3) === 1 ? 'down' : undefined
  /* v8 ignore stop */
}
/** Stable Cordis plugin name. */
export const name = 'blue-input'
/** Services required before the editor can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap', 'commands', 'blueSessionReader', 'blueSessionActions', 'blueSkillsCatalog', 'blueInteractionState']

/**
 * The single-line hint rendered under the input editor. Only the transient
 * notice tier exists and paints `muted`; with nothing transient the row
 * renders zero rows — the persistent key-affordance tier retired with the
 * S15 dogfood verdict, and the slash-discovery tier with the S34 dogfood
 * verdict (D43): the editor's autocomplete dropdown already lists the same
 * catalog through the same fuzzy filter, interactively, so the discovery
 * row only ever surfaced alongside-or-after it as a duplicate. The row
 * keeps the empty-result feedback (`no matching command: /x` — the
 * dropdown closes itself on an empty match, so the notice is the only
 * signal) and every one-shot command notice.
 */
class HintLine implements BlueComponent {
  private text: string | undefined

  /**
   * @param screen - the screen service, captured at mount (same fiber
   *   lifetime; property access through a disposed context throws).
   * @param colors - the active semantic color table.
   * @param components - the width-truncation helper source.
   */
  constructor(
    private readonly screen: BlueScreen,
    private readonly colors: BlueSemanticColors,
    private readonly components: BlueComponents,
  ) {}

  /**
   * Replace the transient hint text and schedule a re-render.
   * @param text - the new hint, or `undefined` to release the row.
   */
  setHint(text: string | undefined): void {
    this.text = text
    this.screen.requestRender()
  }

  /** No cached render state. */
  invalidate(): void {}

  /**
   * Render the hint as one width-truncated row, or nothing. Truncation goes
   * through `blueComponents`, so rows carrying ANSI styling (error notices)
   * are never cut mid-sequence.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    if (this.text === undefined) return []
    const singleLine = this.text
      .split(/\r\n?|\n/u)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join(' · ')
    return [this.colors.muted(this.components.truncateToWidth(singleLine, width))]
  }
}

/**
 * Mount the input editor with the hint line pinned below it and focus the
 * editor; both revert when the plugin's fiber unloads.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const screen = ctx.blueScreen
  const colors = ctx.blueTheme.colors
  const aliases = ctx.blueInteractionState.aliases
  const draft = ctx.blueInteractionState.draft
  const modelListCache = createModelListCache()
  /** One-shot notice shown in the hint line until the next edit. */
  let notice: string | undefined
  /** Current editor text, captured through `onChange` for the slash hint. */
  let currentText = ''
  /**
   * Whether the side-question pane is docked above the editor (mirrors
   * `'blue/editor-connected-above'`). While true, Esc closes the pane,
   * Up/Down scroll it, and Enter submits to it instead of clearing the
   * draft, recalling the queue, or reaching the main agent.
   */
  let connectedAbove = false
  /**
   * Whether the side agent is still answering (the pane's busy flag). A
   * submit while busy is refused: the draft is restored and a notice
   * flashed, the kimi busy path.
   */
  let btwBusy = false
  /**
   * Whether an external-editor session (Ctrl-G, S31) currently owns the
   * terminal through `blueScreen.suspend`. The flag refuses a second
   * Ctrl-G while one is in flight; it is fiber-scoped so a reload starts
   * fresh.
   */
  let externalEditorRunning = false
  /** Timestamp of the last idle Ctrl-C press; 0 means the exit is not armed. */
  let lastInterruptAt = 0
  /** The latest ordinary follow-up eligible to become an editor draft again. */
  let retractionCandidate: {
    readonly messageId: string
    readonly editorText: string
    readonly historyText: string
    readonly rollback?: () => void
  } | undefined
  /**
   * Set when this fiber unloads: a submitted command can dispose it while
   * `execute()` is still in flight (`/theme` swaps the provider, reloading
   * every `blueTheme` dependent), and the late continuation must not reach
   * for services through the dead context.
   */
  let unloaded = false
  ctx.effect(() => () => {
    unloaded = true
  })
  const editor = ctx.blueComponents.createEditor({ paddingX: 4 })
  // The padding reserves columns 0-3 for the side border, its gap, and the
  // `>` prompt symbol the rounded-box chrome overlays.
  editor.setPromptSymbol('>')

  const hintLine = new HintLine(screen, colors, ctx.blueComponents)

  /**
   * Empty-result feedback for slash-prefixed input (D43: the discovery
   * listing itself retired — the dropdown owns command discovery).
   * @returns the notice text when the filter matches nothing, else undefined.
   */
  function slashHint(): string | undefined {
    if (!currentText.startsWith('/')) return undefined
    const parsed = parseCommand(currentText)
    // A bare slash cannot parse (parseCommand requires a leading letter).
    if (parsed === undefined && currentText !== '/') return undefined
    if (ctx.blueSessionReader.current() === null) return undefined
    // The same S14 fuzzy filter the dropdown uses, so the feedback agrees
    // with what the dropdown just failed to list. The dropdown closes
    // itself on an empty match, so this notice is the only signal.
    const matches = filterSlashCommands(
      aliases.withCommandAliases(availableCommands(ctx)),
      parsed?.name ?? '',
      ctx.blueComponents,
    )
    if (matches.length === 0) return `no matching command: /${parsed?.name ?? ''}`
    return undefined
  }

  /** Recompute the hint line from the notice or the slash feedback. */
  function refreshHint(): void {
    hintLine.setHint(notice ?? slashHint())
  }

  /** Flash a notice in the hint line. */
  function setNotice(text: string): void {
    notice = text === '' ? undefined : text
    refreshHint()
  }

  /**
   * Route one submitted line to the command registry or the agent, record
   * it in the editor history, and clear the buffer.
   * @param value - the expanded editor content.
   */
  function submitPrompt(value: string): void {
    const line = value.trim()
    retractionCandidate = undefined
    // The side-question pane owns Enter while it is docked above the
    // editor: the input continues the side conversation (kimi's
    // `sendUserInput`). While the side agent is still answering the submit
    // is refused — the draft is restored and a notice flashed.
    if (connectedAbove) {
      if (btwBusy) {
        editor.setText(value)
        currentText = value
        setNotice('the side question is still answering')
        return
      }
      if (line.length > 0) {
        ctx.emit('blue/btw-command', 'submit', line)
      }
      notice = undefined
      editor.setText('')
      currentText = ''
      draft.clearDraft()
      refreshHint()
      return
    }
    notice = undefined
    editor.setText('')
    // Re-sync explicitly: whether setText fires onChange is the component's
    // own behavior, and the hint must never lag the buffer.
    currentText = editor.getText()
    // The draft was consumed; drop the reload stash with it.
    draft.clearDraft()
    refreshHint()
    if (line.length === 0) return
    editor.addToHistory(line)
    // The history lives in the component; a `/theme <name>` submission
    // rebuilds this fiber (and the editor) as its own effect, so the new
    // entry must reach the reload stash before the swap tears the
    // component down.
    draft.stashHistory(editor.getHistory())
    if (ctx.blueSessionReader.current() === null) {
      setNotice('no active session')
      return
    }
    const parsed = parseCommand(line)
    if (parsed === undefined) {
      const transformed = applyReversibleSubmitTransformers(ctx, rewriteSkillTokens(ctx, line))
      const submitted = ctx.blueSessionActions.followup(transformed.blocks)
      if (!submitted.ok) {
        transformed.rollback?.()
        setNotice(colors.error(submitted.message))
        return
      }
      retractionCandidate = {
        messageId: submitted.value.messageId,
        editorText: value,
        historyText: line,
        ...(transformed.rollback === undefined ? {} : { rollback: transformed.rollback }),
      }
      ctx.get('blueRequests')?.begin('main')
      // The S29 skill pipeline rewrites only model-facing text; the editor
      // candidate and history retain exactly what the user submitted.
      return
    }
    // A bare `/permission` opens the preset picker (S24b, D33) instead of
    // the upstream command's text listing — only while the preset service
    // is composed, so a bare line degrades to the command below otherwise.
    // With an argument the line passes through untouched: `/permission
    // <name>` stays the upstream write path the picker itself dispatches.
    if (parsed.name === 'permission' && parsed.rawInput.trim().length === 0
      && ctx.get('permissionPresets') !== undefined) {
      openPermissionPanel(ctx)
      return
    }
    // An alias line (`/q`) is rewritten to its canonical command before
    // dispatch — the kimi resolution: aliases are not registered commands,
    // the canonical name owns the handler and the session log. The raw
    // input after the name travels untouched.
    const canonical = aliases.canonicalOf(parsed.name)
    void ctx.blueSessionActions.executeCommand(
      canonical === undefined ? line : `/${canonical}${parsed.rawInput}`,
      new AbortController().signal,
    ).then(
      (execution) => {
        // The fiber may be gone — `/theme` unloads it mid-execution — and
        // the reloaded fiber repaints, so a late notice is moot.
        if (unloaded) return
        if (execution === undefined) setNotice(`unknown command: ${line}`)
        else if (execution.result.kind === 'error') setNotice(colors.error(execution.result.text ?? 'command failed'))
        else if (execution.result.text !== undefined) setNotice(execution.result.text)
      },
      (error: unknown) => {
        if (unloaded) return
        /* v8 ignore next -- execute() normalizes handler rejections to Error before this rejection handler runs */
        setNotice(colors.error(error instanceof Error ? error.message : String(error)))
      },
    )
  }

  /**
   * Hand the draft to the external editor ($VISUAL/$EDITOR, Ctrl-G, S31).
   * The screen suspends while the child owns the tty; the edited text is
   * written back inside the suspend window so the resumed full frame
   * already shows it. A nonzero exit (`:cq`) resolves `undefined` and the
   * draft stays untouched; a missing editor only flashes a notice. The
   * mirrors re-sync explicitly (setText fires no onChange — the
   * recallQueued precedent) so a theme-swap reload keeps the edited draft.
   */
  async function runExternalEditorFlow(): Promise<void> {
    const command = resolveExternalEditorCommand(process.env, currentBlueSettings(ctx).editorCommand)
    if (command === undefined) {
      setNotice('set $VISUAL or $EDITOR to edit drafts externally')
      return
    }
    externalEditorRunning = true
    try {
      // Seed through getExpandedText(): large pastes materialize as their
      // full text (the upstream-sanctioned external-editor form). Image
      // markers ride as literal text and keep resolving at submit — the
      // paste-image state is tree-owned and unaffected by setText.
      const seed = editor.getExpandedText()
      await screen.suspend(async () => {
        const edited = await runExternalEditor(seed, command)
        // :cq / a mid-suspend fiber unload: the draft stays untouched.
        if (edited === undefined || unloaded) return
        editor.setText(edited.replaceAll('\r\n', '\n').replace(/\n$/, ''))
        currentText = editor.getText()
        draft.stashDraft(currentText)
        refreshHint()
      })
    } catch (error) {
      // The launcher rejected (spawn failure); resume already ran, so the
      // notice paints on the live screen — unless the fiber went with it.
      if (!unloaded) setNotice(colors.error(error instanceof Error ? error.message : String(error)))
    } finally {
      externalEditorRunning = false
    }
  }

  /**
   * Recall the most recently queued inbox message into an empty editor:
   * remove it from the inbox and make its text the draft. Steering
   * (next-step) is preferred over queued turns as the fresher intent.
   * @returns whether the recall consumed the key.
   */
  function recallQueued(): boolean {
    // Only with an empty buffer — a drafted line keeps Up on history.
    if (editor.getText().length > 0) return false
    const recalled = ctx.blueSessionActions.recallQueued()
    if (!recalled.ok) return false
    editor.setText(recalled.value)
    // Re-sync mirrors submitPrompt's caution about component-owned onChange
    // timing; the recalled text is a draft, so the reload stash keeps it.
    currentText = editor.getText()
    draft.stashDraft(currentText)
    refreshHint()
    ctx.blueScreen.requestRender()
    return true
  }

  /** Clear the current draft, or interrupt the active main request. */
  function clearOrInterrupt(): boolean {
    if (editor.getText().length > 0) {
      editor.setText('')
      currentText = ''
      draft.clearDraft()
      refreshHint()
      ctx.emit('blue/editor-model-changed')
      screen.requestRender()
      return true
    }
    if (ctx.blueSessionReader.current()?.status !== 'running') return false
    const candidate = retractionCandidate
    if (candidate !== undefined
      && ctx.get('blueRetractions')?.tryRetract(candidate.messageId) === true) {
      candidate.rollback?.()
      editor.removeLatestHistory?.(candidate.historyText)
      draft.stashHistory(editor.getHistory())
      editor.setText(candidate.editorText)
      currentText = editor.getText()
      draft.stashDraft(currentText)
      retractionCandidate = undefined
      refreshHint()
      screen.requestRender()
      return true
    }
    retractionCandidate = undefined
    return ctx.blueSessionActions.interrupt().ok
  }

  /**
   * The editor-context key chain, resolved through the keymap before the
   * pi-tui Editor sees the sequence (it swallows Ctrl-C with no behavior,
   * so interception must happen here). Returns true to consume.
   * @param data - the input sequence as read from the terminal.
   * @returns whether the sequence was consumed.
   */
  function handleEditorKey(data: string): boolean {
    const keymap = ctx.blueKeymap
    // Escape: an open autocomplete dropdown owns the key (the Editor closes
    // it); then an open side-question pane closes before anything else (the
    // kimi order — the panel is above the editor, so its Esc wins over the
    // draft clear, which stays intact); otherwise clear the draft, then
    // interrupt a running agent.
    if (keymap.matches(data, ACTION_CANCEL)) {
      if (editor.isShowingAutocomplete()) return false
      if (connectedAbove) {
        ctx.emit('blue/btw-command', 'close')
        return true
      }
      return clearOrInterrupt()
    }
    // Ctrl-C: the same clear/interrupt chain, then the double-press exit —
    // the first idle press only arms the window and flashes the hint.
    if (keymap.matches(data, ACTION_INTERRUPT)) {
      if (clearOrInterrupt()) return true
      const now = Date.now()
      if (now - lastInterruptAt < INTERRUPT_DOUBLE_PRESS_MS) {
        lastInterruptAt = 0
        // Same exit path as `/quit`: optional, launcher-provided.
        ctx.get('appExit')?.(0)
        return true
      }
      lastInterruptAt = now
      setNotice('press ctrl+c again to exit')
      return true
    }
    // Ctrl-S: steer the current turn with the draft — an idle agent starts
    // a turn, a running one consumes it at the next step boundary.
    if (keymap.matches(data, ACTION_STEER)) {
      const text = editor.getText().trim()
      if (text.length === 0 || ctx.blueSessionReader.current() === null) return false
      // Steered text runs the same `#name` → `/name` skill rewrite as a
      // submitted follow-up: the gesture reaches the model either way.
      ctx.get('blueRequests')?.begin('main')
      const steered = ctx.blueSessionActions.steer(
        applyReversibleSubmitTransformers(ctx, rewriteSkillTokens(ctx, text)).blocks,
      )
      if (!steered.ok) return false
      editor.setText('')
      // Steered text is consumed too: keep no stashed copy for a reload.
      draft.clearDraft()
      return true
    }
    // Shift+Tab: cycle the session mode (normal → plan → yolo, S24a). The
    // cycle dispatches one explicit command whose result text is the
    // feedback, so the press is always consumed. It fires in bash mode too
    // — the input mode and the session mode are orthogonal axes.
    if (keymap.matches(data, ACTION_CYCLE_MODE)) {
      void cycleMode(ctx)
      return true
    }
    // Ctrl-G: hand the draft to $VISUAL/$EDITOR (S31). The terminal
    // suspends while the child owns the tty; the edited text is written
    // back inside the suspend window. A second press while an editor
    // session runs is consumed silently.
    if (keymap.matches(data, ACTION_EXTERNAL_EDITOR)) {
      if (!externalEditorRunning) void runExternalEditorFlow()
      return true
    }
    // Alt+M: cycle the session model within the current provider through
    // the session-only channel (S30). The switch flashes its notice and
    // leaves the draft alone — reaching /model would consume the typed
    // line, which is exactly what the hotkey avoids. Always consumed for
    // the same reasons as the mode cycle, and it fires in bash mode too
    // (input mode and model are orthogonal axes).
    if (keymap.matches(data, ACTION_CYCLE_MODEL)) {
      void cycleSessionModel(ctx, modelListCache)
      return true
    }
    // Up/Down: with the side-question pane docked above and an empty buffer,
    // the keys scroll the pane (kimi's canUseScrollKeys gate). The pane wins
    // over the queue recall and the editor's history navigation, and the
    // sequence is consumed even when the pane has nothing to scroll.
    if (connectedAbove && editor.getText().length === 0) {
      const isUp = keymap.matches(data, ACTION_MOVE_UP)
      if (isUp || keymap.matches(data, ACTION_MOVE_DOWN)) {
        ctx.emit('blue/btw-command', isUp ? 'scroll-up' : 'scroll-down')
        return true
      }
    }
    // Up: recall the latest queued message into an empty buffer when the
    // pane-queue enhancement is loaded — its keyless contextual action is
    // the enable signal, and the key matches through the existing move-up
    // binding. The baseline leaves Up to the editor's history navigation.
    if (keymap.matches(data, ACTION_MOVE_UP)
      && keymap.list().some(action => action.id === ACTION_QUEUE_RECALL)) {
      return recallQueued()
    }
    return false
  }

  editor.onChange = (text) => {
    currentText = text
    ctx.emit('blue/editor-model-changed')
    // Mirror every edit so a theme-swap reload loses nothing.
    draft.stashDraft(text)
    // Slash context highlights the frame in `primary`; any other text
    // returns the neutral border. `blue-editor-plus` re-asserts its shell
    // hue on top while bash mode is active.
    editor.setBorderColor(text.trimStart().startsWith('/') ? colors.primary : colors.border)
    notice = undefined
    refreshHint()
  }
  // The pi-tui Editor clears its buffer before invoking onSubmit, and the
  // callback argument already carries the paste-expanded, trimmed text — so
  // the argument, not getExpandedText(), is the submission.
  editor.onSubmit = (text) => {
    submitPrompt(text)
  }
  editor.onKey = handleEditorKey

  // Restore the draft stashed before a reload: plain text only — setText
  // fires neither a submit nor an input-mode transition. The explicit
  // re-sync mirrors submitPrompt's caution about component-owned onChange
  // timing.
  const stashed = draft.getStashedDraft()
  if (stashed.length > 0) {
    editor.setText(stashed)
    currentText = editor.getText()
    refreshHint()
  }
  // Replay the stashed history into the fresh component — the old
  // editor's Up-recall entries died with it when the reload rebuilt this
  // fiber. The stash is newest-first and pi-tui prepends, so the replay
  // walks it reversed to land the same order.
  for (const entry of [...draft.getStashedHistory()].reverse()) editor.addToHistory(entry)

  // A session switch settles navigation notices such as "resuming" and
  // "creating rewind branch". Clear the old session's transient text before
  // re-deriving slash feedback against the new agent.
  const sessionRegistration = ctx.blueSessionReader.subscribe(() => {
    retractionCandidate = undefined
    notice = undefined
    refreshHint()
  })
  ctx.effect(() => () => sessionRegistration.dispose())
  // The side-question pane docks above the editor; its flag switches the
  // editor's top corners to the spliced `├┤` and gates the Esc/arrow/Enter
  // chain, and its busy flag refuses a submit while the side agent answers.
  ctx.on('blue/editor-connected-above', (connected, busy) => {
    connectedAbove = connected
    btwBusy = busy === true
    editor.setConnectedAbove(connected)
    screen.requestRender()
  })

  ctx.effect(() => {
    // Pin below the transcript: pi-tui renders root children in mount order,
    // and transcript components only appear once a session exists. The hint
    // line mounts after the editor so it renders beneath it.
    let removeEditor = screen.addBottomChild(editor)
    let removeHint = screen.addBottomChild(hintLine)
    screen.setFocus(editor)
    setSharedEditor(ctx, { editor, submitPrompt, abortPrompt: () => { clearOrInterrupt() }, notice: setNotice })
    ctx.emit('blue/input-editor-changed')

    // The editor-slot swap (kimi `mountEditorReplacement`, D30): a dialog
    // panel takes over the editor's dock slot, so below an open panel only
    // the footer remains — a floating overlay would leave the editor's
    // frame peeking around it. A stack keeps nested opens orderly; the top
    // entry is what renders, and popping back to empty restores the editor
    // (its buffer and draft survive — the component merely left the tree).
    const panels: { readonly component: BlueFocusable; readonly remove: () => void }[] = []
    const hideEditor = (): void => {
      removeHint()
      removeEditor()
    }
    const showEditor = (): void => {
      removeEditor = screen.addBottomChild(editor)
      removeHint = screen.addBottomChild(hintLine)
      screen.setFocus(editor)
    }
    setEditorSlotSwap(ctx, {
      mount: (component) => {
        if (panels.length === 0) hideEditor()
        const remove = screen.addBottomChild(component)
        screen.setFocus(component)
        const entry = { component, remove }
        panels.push(entry)
        if (panels.length === 1) {
          // The dock slot changed hands: activity panes stand down while a
          // dialog hangs (below an open panel only the footer stays).
          ctx.emit('blue/editor-slot-swapped', true)
        }
        screen.requestRender()
        return () => {
          const index = panels.indexOf(entry)
          // -1 covers both re-disposal and a panel outliving this fiber:
          // the teardown below already unmounted it.
          if (index === -1) return
          panels.splice(index, 1)
          remove()
          const top = panels.at(-1)
          if (top === undefined) {
            showEditor()
            ctx.emit('blue/editor-slot-swapped', false)
          } else screen.setFocus(top.component)
          screen.requestRender()
        }
      },
    })

    return () => {
      setEditorSlotSwap(ctx, undefined)
      // Panels still open when this fiber unloads (a /theme swap with a
      // dialog up) unmount with it; their disposers turn into no-ops.
      const wasOccupied = panels.length > 0
      for (const entry of panels.splice(0)) entry.remove()
      if (wasOccupied) ctx.emit('blue/editor-slot-swapped', false)
      clearSharedEditor(ctx)
      ctx.emit('blue/input-editor-changed')
      removeHint()
      removeEditor()
      screen.setFocus(null)
    }
  })
  ctx.effect(() => {
    const screen = ctx.blueScreen as BlueScreen & {
      setContentScrollHandler?: (handler: ((data: string) => boolean) | undefined) => () => void
    }
    const dispose = screen.setContentScrollHandler?.(data => {
      if (!editor.focused || connectedAbove) return false
      /* v8 ignore start -- exercised by the real PTY and mouse path */
      const wheel = wheelDirection(data)
      if (wheel !== undefined) {
        // The focused editor owns every wheel report, including the scroll
        // boundary. Consuming the boundary event prevents it from being
        // reinterpreted as editor history navigation; the AltScreen core
        // route remains available when no editor handler is installed.
        ctx.blueScreen.scrollContent(wheel, 3)
        return true
      }
      /* v8 ignore stop */
      if (editor.getText().length > 0) return false
      /* v8 ignore start -- exercised by the real PTY and mouse path */
      if (data === KEY_PAGE_UP || data === KEY_PAGE_DOWN) {
        return ctx.blueScreen.scrollContent(data === KEY_PAGE_UP ? 'up' : 'down', Math.max(1, ctx.blueScreen.rows - 4))
      }
      if (data === KEY_END) {
        ctx.blueScreen.followContent()
        setNotice('')
        return true
      }
      /* v8 ignore stop */
      return false
    })
    return () => dispose?.()
  })
  /* v8 ignore start -- notification is driven by live streaming events */
  ctx.effect(() => ctx.on('blue/transcript-content-changed', paused => {
    if (paused) setNotice('new messages available · press End to follow')
  }))
  /* v8 ignore stop */
}
