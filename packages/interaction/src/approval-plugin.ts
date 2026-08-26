/**
 * `blue-approval` plugin: the interactive answerer on the
 * `approval/request` waterfall. Requests for the agent currently attached
 * to the UI open a dialog panel with four choices — Allow once, Allow the
 * tool for this session, Reject, Reject with feedback — navigated with
 * Up/Down and Enter, direct-selected with the `1`–`4` digit keys; Escape
 * rejects, an aborted request signal cancels, and the feedback choice swaps
 * the list for an inline reason editor whose submission steers the agent
 * with the rejection reason. The panel replaces the editor in its dock
 * slot (D30), so below it only the footer remains. Session-scoped
 * allowances are remembered by the frontend tree and session id and
 * short-circuit later prompts for the same tool. Yolo (`/yolo`, S24a)
 * short-circuits every prompt while on — the policy stays `'ask'`, this
 * answerer is the auto-approve surface (see `./mode-state.ts`).
 * Concurrent requests
 * serialize on a Fiber-owned FIFO chain so only one prompt is visible at
 * a time. Requests for any other agent — and requests arriving before a
 * session attaches — delegate down the chain with `next()`. Returning
 * without `next()` short-circuits the waterfall with the chosen outcome.
 *
 * @module @dsh-blue/blue-interaction/approval-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BlueComponents, BlueEditor, BlueFocusable, BlueScreen, BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { mountEditorReplacement } from './editor-instance.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-approval'
/** Services required before the answerer can listen. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueSessionReader', 'blueSessionActions']

/** Decoded input sequences the prompt handles directly (no keymap actions). */
const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_ENTER = '\r'
const KEY_ESCAPE = '\x1b'

/** Construction options for {@link ApprovalPrompt}. */
interface ApprovalPromptOptions {
  /** Theme supplying the header/reason/highlight colors. */
  readonly theme: BlueTheme
  /** Component factory supplying the feedback editor and width helpers. */
  readonly components: BlueComponents
  /** Screen, poked for a re-render after cursor and mode changes. */
  readonly screen: BlueScreen
  /** Tool the approval gates. */
  readonly toolName: string
  /** Optional asker-supplied context rendered under the header. */
  readonly reason?: string
  /** Idempotent outcome setter owned by the enclosing prompt. */
  readonly settle: (outcome: ApprovalOutcome) => void
  /** Record the tool as allowed for the rest of the session (choice 2). */
  readonly allowForSession: () => void
  /** Steer the agent with the rejection reason (choice 4). */
  readonly steer: (reason: string) => void
}

/**
 * The approval overlay component: a four-choice menu (Up/Down wrap the
 * highlight, Enter confirms, `1`–`4` direct-select, Escape rejects) that
 * swaps to an inline reason editor for "Reject with feedback".
 */
class ApprovalPrompt implements BlueFocusable {
  /** Whether the prompt currently holds focus. Managed by the screen. */
  focused = false

  private cursor = 0
  /** Set once the feedback editor replaced the menu. */
  private editor: BlueEditor | undefined

  /**
   * @param options - see {@link ApprovalPromptOptions}.
   */
  constructor(private readonly options: ApprovalPromptOptions) {}

  /** The four choice labels in display order. */
  private labels(): string[] {
    const tool = this.options.toolName
    return ['Allow once', `Allow ${tool} for this session`, 'Reject', 'Reject with feedback']
  }

  /**
   * Dispatch one input sequence against the prompt.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    const editor = this.editor
    if (editor !== undefined) {
      // Feedback mode: Escape rejects without steering; the editor owns
      // every other key (Enter submits through its onSubmit).
      if (data === KEY_ESCAPE) this.options.settle('rejected')
      else editor.handleInput?.(data)
      return
    }
    if (data === KEY_UP) {
      this.cursor = this.cursor === 0 ? this.labels().length - 1 : this.cursor - 1
      this.options.screen.requestRender()
      return
    }
    if (data === KEY_DOWN) {
      this.cursor = this.cursor === this.labels().length - 1 ? 0 : this.cursor + 1
      this.options.screen.requestRender()
      return
    }
    if (data === KEY_ENTER) {
      this.choose(this.cursor)
      return
    }
    if (data === KEY_ESCAPE) {
      this.options.settle('rejected')
      return
    }
    if (data >= '1' && data <= '4') this.choose(Number(data) - 1)
  }

  /** Act on one confirmed choice. */
  private choose(index: number): void {
    switch (index) {
      case 0:
        this.options.settle('allowed-once')
        return
      case 1:
        this.options.allowForSession()
        this.options.settle('allowed-once')
        return
      case 2:
        this.options.settle('rejected')
        return
      default:
        this.enterFeedback()
    }
  }

  /** Swap the menu for the inline reason editor. */
  private enterFeedback(): void {
    const editor = this.options.components.createEditor()
    // The editor clears its buffer before invoking onSubmit; the callback
    // argument already carries the paste-expanded, trimmed text.
    editor.onSubmit = (text) => {
      // An empty reason is a plain Reject: no steering.
      if (text.length > 0) this.options.steer(text)
      this.options.settle('rejected')
    }
    this.editor = editor
    this.options.screen.requestRender()
  }

  /** Drop the feedback editor's cached render state. */
  invalidate(): void {
    this.editor?.invalidate()
  }

  /**
   * Render the framed dialog: the amber rules, the `▶`-prefixed title, the
   * optional reason, and the numbered menu (`N. label`, the selected row
   * taking a `▶` pointer) or the feedback editor — closed by a key row.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const { theme, components, toolName, reason } = this.options
    const colors = theme.colors
    const rows: string[] = []
    if (reason !== undefined) {
      rows.push(colors.muted(components.truncateToWidth(reason, width)))
    }
    rows.push('')
    const editor = this.editor
    if (editor !== undefined) {
      rows.push(colors.muted('reason:'))
      rows.push(...editor.render(width))
      rows.push('')
      return framePanel(rows, width, {
        title: `▶ Approve ${toolName}?`,
        titlePaint: colors.borderFocus,
        rulePaint: colors.borderFocus,
        footer: ['type feedback', '↵ submit', 'esc cancel'],
        footerPaint: colors.textMuted,
      })
    }
    const labels = this.labels()
    for (const [at, label] of labels.entries()) {
      const num = `${at + 1}. ${label}`
      // The kimi approval rows sit indented two columns under the title.
      const row = components.truncateToWidth(
        at === this.cursor ? `  ▶ ${num}` : `    ${num}`,
        width,
      )
      rows.push(at === this.cursor ? colors.accent(row) : colors.textStrong(row))
    }
    rows.push('')
    return framePanel(rows, width, {
      title: `▶ Approve ${toolName}?`,
      titlePaint: colors.borderFocus,
      rulePaint: colors.borderFocus,
      footer: ['↑/↓ select', '1-4 choose', '↵ confirm'],
      footerPaint: colors.textMuted,
    })
  }
}

/**
 * Listen on the `approval/request` waterfall; the fiber's disposal removes
 * the listener.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const reader = ctx.blueSessionReader
  const actions = ctx.blueSessionActions
  const sessionAllowances = new Map<string, Set<string>>()
  const queuedPrompts: Array<() => void> = []
  const cancelPrompts = new Set<() => void>()
  let promptActive = false
  let disposed = false

  /** Run one cancellable prompt through this Fiber's FIFO. */
  const enqueueApproval = (
    task: (registerCancel: (cancel: () => void) => void) => Promise<ApprovalOutcome>,
    signal?: AbortSignal,
  ): Promise<ApprovalOutcome> => new Promise<ApprovalOutcome>((resolve) => {
    let started = false
    let finished = false
    /* v8 ignore next -- a started task registers its synchronous cancel hook before external code can run. */
    let cancelTask = (): void => {}
    const release = (): void => {
      if (!started) return
      promptActive = false
      queuedPrompts.shift()?.()
    }
    const finish = (outcome: ApprovalOutcome): void => {
      /* v8 ignore next -- finish removes every external cancel source before resolving. */
      if (finished) return
      finished = true
      cancelPrompts.delete(cancel)
      signal?.removeEventListener('abort', cancel)
      resolve(outcome)
      release()
    }
    const cancel = (): void => {
      /* v8 ignore next -- settled prompts remove this callback from both the set and signal. */
      if (finished) return
      if (started) {
        cancelTask()
        return
      }
      const index = queuedPrompts.indexOf(run)
      // A non-started task is necessarily in this Fiber's queue: external
      // cancellation cannot run between listener registration and enqueue.
      queuedPrompts.splice(index, 1)
      finish('cancelled')
    }
    const run = (): void => {
      started = true
      promptActive = true
      /* v8 ignore next -- Fiber cleanup cancels and removes every queued task before it can run. */
      if (disposed) {
        finish('cancelled')
        return
      }
      void task(next => { cancelTask = next }).then(finish)
    }
    cancelPrompts.add(cancel)
    signal?.addEventListener('abort', cancel, { once: true })
    if (promptActive) queuedPrompts.push(run)
    else run()
  })

  const answer = (
    req: ApprovalRequest,
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> => {
    if (!actions.isCurrentAgent(req.agent)) return next()
    const sessionId = reader.current()?.id
    if (sessionId === undefined) return next()
    if (sessionAllowances.get(sessionId)?.has(req.toolName) === true) {
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    }
    if (req.signal?.aborted) return Promise.resolve<ApprovalOutcome>('cancelled')
    if (actions.modeState()?.mode === 'yolo') return Promise.resolve<ApprovalOutcome>('allowed-once')
    return enqueueApproval((registerCancel) => {
      if (!actions.isCurrentAgent(req.agent)) return Promise.resolve<ApprovalOutcome>('cancelled')
      return prompt(ctx, req, registerCancel, () => {
        if (!actions.isCurrentAgent(req.agent) || reader.current()?.id !== sessionId) return
        let tools = sessionAllowances.get(sessionId)
        if (tools === undefined) {
          tools = new Set()
          sessionAllowances.set(sessionId, tools)
        }
        tools.add(req.toolName)
      }, (reason) => {
        actions.steerCurrentAgent(req.agent, `User rejected ${req.toolName}: ${reason}`)
      })
    }, req.signal)
  }

  ctx.on('approval/request', (req, next) => answer(req, next))
  let observedSessionId = reader.current()?.id
  const sessionRegistration = reader.subscribe(snapshot => {
    const next = snapshot?.id
    if (next === observedSessionId) return
    observedSessionId = next
    for (const cancel of [...cancelPrompts]) cancel()
  })
  ctx.effect(() => () => {
    disposed = true
    sessionRegistration.dispose()
    for (const cancel of [...cancelPrompts]) cancel()
    queuedPrompts.splice(0)
    sessionAllowances.clear()
  })
}

/**
 * Queue one prompt: mount the panel unless the request signal is
 * already aborted (a queued request can abort while waiting its turn).
 * @param ctx - plugin context carrying the Blue services.
 * @param req - the pending decision.
 * @returns the chosen outcome.
 */
function prompt(
  ctx: Context,
  req: ApprovalRequest,
  registerCancel: (cancel: () => void) => void,
  allowForSession: () => void,
  steer: (reason: string) => void,
): Promise<ApprovalOutcome> {
  return new Promise<ApprovalOutcome>((resolve) => {
    let settled = false
    const settle = (outcome: ApprovalOutcome): void => {
      if (settled) return
      settled = true
      req.signal?.removeEventListener('abort', onAbort)
      restore()
      resolve(outcome)
    }
    const component = new ApprovalPrompt({
      theme: ctx.blueTheme,
      components: ctx.blueComponents,
      screen: ctx.blueScreen,
      toolName: req.toolName,
      ...req.reason === undefined ? {} : { reason: req.reason },
      settle,
      allowForSession,
      steer: (reason) => {
        /* v8 ignore next -- the prompt settles right after steering, so a replay cannot reach this */
        if (settled) return
        steer(reason)
      },
    })
    // The kimi dialog mount (D30): the prompt replaces the editor in its
    // dock slot, so below it only the footer remains.
    const restore = mountEditorReplacement(ctx, component)
    const onAbort = (): void => {
      settle('cancelled')
    }
    registerCancel(onAbort)
    req.signal?.addEventListener('abort', onAbort, { once: true })
  })
}
