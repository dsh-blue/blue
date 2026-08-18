/**
 * `blue-input` plugin: the bottom input editor, backed by the pi-tui Editor
 * through `ctx.blueComponents.createEditor` (multi-line, kill-ring, undo,
 * history, and paste markers are the component's own). Submit dispatches a
 * slash command through `ctx.commands` when the line parses as one,
 * otherwise queues the text as a user follow-up message on the current
 * agent (the harness inbox queues it when the agent is running). A muted
 * hint line below the editor shows slash-command discovery and one-shot
 * notices. The mounted editor and the submit router are published through
 * `./editor-instance.ts` so `blue-editor-plus` can layer input modes and
 * autocomplete over the same component.
 *
 * @module @deepseek-ai/dsh-blue-interaction/input-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BlueComponent } from '@deepseek-ai/dsh-blue-core'
import { parseCommand } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { clearSharedEditor, setSharedEditor } from './editor-instance.ts'
import { currentBlueAgent } from './session.ts'

/** Slash-command hint rows shown at once. */
const MAX_HINT_COMMANDS = 3

/** Stable Cordis plugin name. */
export const name = 'blue-input'
/** Services required before the editor can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'commands']

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
        if (execution === undefined) setNotice(`unknown command: ${line}`)
        else if (execution.result.kind === 'error') setNotice(colors.error(execution.result.text))
        else if (execution.result.text !== undefined) setNotice(execution.result.text)
      },
      (error: unknown) => {
        /* v8 ignore next -- execute() normalizes handler rejections to Error before this rejection handler runs */
        setNotice(colors.error(error instanceof Error ? error.message : String(error)))
      },
    )
  }

  editor.onChange = (text) => {
    currentText = text
    notice = undefined
    refreshHint()
  }
  // The pi-tui Editor clears its buffer before invoking onSubmit, and the
  // callback argument already carries the paste-expanded, trimmed text — so
  // the argument, not getExpandedText(), is the submission.
  editor.onSubmit = (text) => {
    submitPrompt(text)
  }

  ctx.effect(() => {
    // Pin below the transcript: pi-tui renders root children in mount order,
    // and transcript components only appear once a session exists. The hint
    // line mounts after the editor so it renders beneath it.
    const removeEditor = screen.addBottomChild(editor)
    const removeHint = screen.addBottomChild(hintLine)
    screen.setFocus(editor)
    setSharedEditor({ editor, submitPrompt })
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
