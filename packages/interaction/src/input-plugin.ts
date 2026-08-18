/**
 * `blue-input` plugin: the bottom input editor, backed by the pi-tui Editor
 * through `ctx.blueComponents.createEditor` (multi-line, kill-ring, undo,
 * history, and paste markers are the component's own). Submit dispatches a
 * slash command through `ctx.commands` when the line parses as one,
 * otherwise queues the text as a user follow-up message on the current
 * agent (the harness inbox queues it when the agent is running). A muted
 * hint line below the editor shows slash-command discovery and one-shot
 * notices. The editor-context key chain (Escape clear/interrupt, Ctrl-C
 * clear/interrupt/double-press exit, Ctrl-S steer) resolves through
 * `ctx.blueKeymap` in the editor's `onKey` hook, which runs before the
 * pi-tui Editor sees the sequence. The mounted editor and the submit router
 * are published through
 * `./editor-instance.ts` so `blue-editor-plus` can layer input modes and
 * autocomplete over the same component. When the `blue-pane-queue`
 * enhancement is loaded, an Up press with an empty buffer recalls the most
 * recently queued inbox message as the draft (gated on its keyless
 * `blue.queue.recall` action; the baseline leaves Up to the editor's
 * history). The unsubmitted draft is mirrored
 * into `./draft-stash.ts`, so a theme-swap reload (the theme provider fiber
 * disposes, Cordis re-runs this `blueTheme` dependent) restores the text
 * into the freshly mounted editor. The same reload can land while a slash
 * command is still in flight — `/theme` disposes the theme provider between
 * `execute()` and its continuation — so the submit continuation gates on
 * the fiber's unload flag before touching the hint; a late notice is moot
 * anyway, since the reloaded fiber repaints.
 *
 * @module @deepseek-ai/dsh-blue-interaction/input-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BlueComponent } from '@deepseek-ai/dsh-blue-core'
import { parseCommand } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { clearSharedEditor, setSharedEditor } from './editor-instance.ts'
import { clearDraft, getStashedDraft, stashDraft } from './draft-stash.ts'
import { ACTION_CANCEL, ACTION_INTERRUPT, ACTION_MOVE_UP, ACTION_STEER } from './keys.ts'
import { ACTION_QUEUE_RECALL, queuedMessageText } from './pane-queue.ts'
import { currentBlueAgent } from './session.ts'

/** Slash-command hint rows shown at once. */
const MAX_HINT_COMMANDS = 3
/** Window for the double Ctrl-C exit: presses farther apart re-arm the hint. */
const INTERRUPT_DOUBLE_PRESS_MS = 1000
/** Timestamp of the last idle Ctrl-C press; 0 means the exit is not armed. */
let lastInterruptAt = 0

/** Stable Cordis plugin name. */
export const name = 'blue-input'
/** Services required before the editor can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap', 'commands']

/**
 * The muted single-line hint rendered under the input editor. Empty when no
 * hint is set; width truncation goes through `blueComponents`, so notices
 * carrying ANSI styling (error colors) are never cut mid-sequence.
 */
class HintLine implements BlueComponent {
  private text: string | undefined

  /**
   * @param ctx - plugin context carrying the screen, theme, and components.
   */
  constructor(private readonly ctx: Context) {}

  /**
   * Replace the hint text and schedule a re-render.
   * @param text - the new hint, or `undefined` to clear the line.
   */
  setHint(text: string | undefined): void {
    this.text = text
    this.ctx.blueScreen.requestRender()
  }

  /** No cached render state. */
  invalidate(): void {}

  /**
   * Render the hint as one muted, width-truncated row, or nothing.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    if (this.text === undefined) return []
    return [this.ctx.blueTheme.colors.muted(this.ctx.blueComponents.truncateToWidth(this.text, width))]
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
  /** One-shot notice shown in the hint line until the next edit. */
  let notice: string | undefined
  /** Current editor text, captured through `onChange` for the slash hint. */
  let currentText = ''
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

  const editor = ctx.blueComponents.createEditor()
  const hintLine = new HintLine(ctx)

  /** Matching-command hint for slash-prefixed input. */
  function slashHint(): string | undefined {
    if (!currentText.startsWith('/')) return undefined
    const parsed = parseCommand(currentText)
    // A bare slash cannot parse (parseCommand requires a leading letter) but
    // is exactly the discovery affordance: list every registered command.
    if (parsed === undefined && currentText !== '/') return undefined
    const agent = currentBlueAgent(ctx)
    if (agent === undefined) return undefined
    const prefix = parsed?.name ?? ''
    const matches = ctx.commands.list(agent)
      .filter(command => command.name.startsWith(prefix))
    if (matches.length === 0) return `no matching command: /${prefix}`
    return matches.slice(0, MAX_HINT_COMMANDS)
      .map(command => `/${command.name} — ${command.description}`)
      .join('  ')
  }

  /** Recompute the hint line from the notice or the slash discovery list. */
  function refreshHint(): void {
    hintLine.setHint(notice ?? slashHint())
  }

  /** Flash a notice in the hint line. */
  function setNotice(text: string): void {
    notice = text
    refreshHint()
  }

  /**
   * Route one submitted line to the command registry or the agent, record
   * it in the editor history, and clear the buffer.
   * @param value - the expanded editor content.
   */
  function submitPrompt(value: string): void {
    const line = value.trim()
    notice = undefined
    editor.setText('')
    // Re-sync explicitly: whether setText fires onChange is the component's
    // own behavior, and the hint must never lag the buffer.
    currentText = editor.getText()
    // The draft was consumed; drop the reload stash with it.
    clearDraft()
    refreshHint()
    if (line.length === 0) return
    editor.addToHistory(line)
    const agent = currentBlueAgent(ctx)
    if (agent === undefined) {
      setNotice('no active session')
      return
    }
    if (parseCommand(line) === undefined) {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: line }],
        source: { kind: 'user' },
      }))
      return
    }
    void ctx.commands.execute(agent, line, new AbortController().signal).then(
      (execution) => {
        // The fiber may be gone — `/theme` unloads it mid-execution — and
        // the reloaded fiber repaints, so a late notice is moot.
        if (unloaded) return
        if (execution === undefined) setNotice(`unknown command: ${line}`)
        else if (execution.result.kind === 'error') setNotice(colors.error(execution.result.text))
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
   * Recall the most recently queued inbox message into an empty editor:
   * remove it from the inbox and make its text the draft. Steering
   * (next-step) is preferred over queued turns as the fresher intent.
   * @returns whether the recall consumed the key.
   */
  function recallQueued(): boolean {
    // Only with an empty buffer — a drafted line keeps Up on history.
    if (editor.getText().length > 0) return false
    const agent = currentBlueAgent(ctx)
    if (agent === undefined || !agent.inbox.hasPending) return false
    const latest = agent.inbox.nextStep.at(-1) ?? agent.inbox.nextTurn.at(-1)
    /* v8 ignore next -- hasPending guarantees one pending list is non-empty */
    if (latest === undefined) return false
    const text = queuedMessageText(latest)
    if (text.length === 0) return false
    // Lost the race with a claim: leave the editor alone.
    if (!agent.inbox.remove(latest.id)) return false
    editor.setText(text)
    // Re-sync mirrors submitPrompt's caution about component-owned onChange
    // timing; the recalled text is a draft, so the reload stash keeps it.
    currentText = editor.getText()
    stashDraft(currentText)
    refreshHint()
    ctx.blueScreen.requestRender()
    return true
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
    // it); otherwise clear the draft, then interrupt a running agent.
    if (keymap.matches(data, ACTION_CANCEL)) {
      if (editor.isShowingAutocomplete()) return false
      if (editor.getText().length > 0) {
        editor.setText('')
        return true
      }
      const agent = currentBlueAgent(ctx)
      if (agent?.status === 'running') {
        agent.cancel({ kind: 'user' })
        return true
      }
      return false
    }
    // Ctrl-C: the same clear/interrupt chain, then the double-press exit —
    // the first idle press only arms the window and flashes the hint.
    if (keymap.matches(data, ACTION_INTERRUPT)) {
      if (editor.getText().length > 0) {
        editor.setText('')
        return true
      }
      const agent = currentBlueAgent(ctx)
      if (agent?.status === 'running') {
        agent.cancel({ kind: 'user' })
        return true
      }
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
      const agent = currentBlueAgent(ctx)
      if (text.length === 0 || agent === undefined) return false
      agent.steer(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
      editor.setText('')
      // Steered text is consumed too: keep no stashed copy for a reload.
      clearDraft()
      return true
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
    // Mirror every edit so a theme-swap reload loses nothing.
    stashDraft(text)
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
  const stashed = getStashedDraft()
  if (stashed.length > 0) {
    editor.setText(stashed)
    currentText = editor.getText()
    refreshHint()
  }

  ctx.effect(() => {
    // Pin below the transcript: pi-tui renders root children in mount order,
    // and transcript components only appear once a session exists. The hint
    // line mounts after the editor so it renders beneath it.
    const removeEditor = screen.addBottomChild(editor)
    const removeHint = screen.addBottomChild(hintLine)
    screen.setFocus(editor)
    setSharedEditor({ editor, submitPrompt, notice: setNotice })
    ctx.emit('blue/input-editor-changed')
    return () => {
      clearSharedEditor()
      ctx.emit('blue/input-editor-changed')
      removeHint()
      removeEditor()
      screen.setFocus(null)
    }
  })
}
