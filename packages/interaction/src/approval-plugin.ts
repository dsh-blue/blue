/**
 * `blue-approval` plugin: the interactive answerer on the
 * `approval/request` waterfall. Requests for the agent currently attached
 * to the UI open a modal overlay with four choices — Allow once, Allow the
 * tool for this session, Reject, Reject with feedback — navigated with
 * Up/Down and Enter, direct-selected with the `1`–`4` digit keys; Escape
 * rejects, an aborted request signal cancels, and the feedback choice swaps
 * the list for an inline reason editor whose submission steers the agent
 * with the rejection reason. Session-scoped allowances are remembered per
 * agent in a module-level WeakMap and short-circuit later prompts for the
 * same tool. Concurrent requests serialize on a module-level FIFO chain so
 * only one prompt is visible at a time. Requests for any other agent — and
 * requests arriving before a session attaches — delegate down the chain
 * with `next()`. Returning without `next()` short-circuits the waterfall
 * with the chosen outcome.
 *
 * @module @dsh-blue/blue-interaction/approval-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BlueComponents, BlueEditor, BlueFocusable, BlueScreen, BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { currentBlueAgent } from './session.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-approval'
/** Services required before the answerer can listen. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents']

/**
 * The kimi pull-up panel presentation: full width, anchored to the bottom
 * so the dialog rises from the editor's slot, with the two-row footer
 * shell left visible on the terminal's last rows (S12 dock reorder).
 */
const OVERLAY_WIDTH = '100%'
const OVERLAY_ANCHOR = 'bottom-center'
/** Negative offset: the panel's bottom edge ends above the two-row footer. */
const OVERLAY_FOOTER_CLEARANCE = -2
/**
 * Overlay height bound as a share of the terminal. S12 raises the bound so
 * the framed dialog (bars, title, reason, four numbered choices, key row)
 * fits inside its budget — pi-tui slices overlay output past maxHeight.
 */
const OVERLAY_MAX_HEIGHT = '55%'

/** Decoded input sequences the prompt handles directly (no keymap actions). */
const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_ENTER = '\r'
const KEY_ESCAPE = '\x1b'

/** Tool names approved for the rest of a session, per agent (choice 2). */
const sessionAllowances = new WeakMap<Agent, Set<string>>()

/** Prompts waiting for the visible one to settle, in arrival order. */
const queuedPrompts: Array<() => void> = []
/** Whether a prompt is currently visible (or settling). */
let promptActive = false

/**
 * Run one prompt through the FIFO: an idle queue starts it synchronously so
 * the overlay is visible before the waterfall dispatch returns; otherwise
 * the prompt waits its turn. A settling prompt releases the next.
 * @param task - the prompt to run once earlier prompts settle.
 * @returns the prompt's outcome.
 */
function enqueueApproval(task: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> {
  return new Promise<ApprovalOutcome>((resolve) => {
    const run = (): void => {
      promptActive = true
      // The only task is the internal prompt below, which never rejects.
      void task().then((outcome) => {
        promptActive = false
        resolve(outcome)
        queuedPrompts.shift()?.()
      })
    }
    if (promptActive) queuedPrompts.push(run)
    else run()
  })
}

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
  ctx.on('approval/request', (req, next) => answer(ctx, req, next))
}

/**
 * Answer one approval request interactively, or delegate when this UI does
 * not own the requesting agent.
 * @param ctx - plugin context carrying the Blue services.
 * @param req - the pending decision.
 * @param next - delegates to the remaining answerers.
 * @returns the chosen outcome.
 */
function answer(
  ctx: Context,
  req: ApprovalRequest,
  next: () => Promise<ApprovalOutcome>,
): Promise<ApprovalOutcome> {
  const agent = currentBlueAgent(ctx)
  if (agent === undefined || agent !== req.agent) return next()
  // A session-scoped allowance short-circuits the prompt entirely.
  if (sessionAllowances.get(req.agent)?.has(req.toolName) === true) {
    return Promise.resolve<ApprovalOutcome>('allowed-once')
  }
  return enqueueApproval(() => prompt(ctx, req))
}

/**
 * Queue one modal prompt: show the overlay unless the request signal is
 * already aborted (a queued request can abort while waiting its turn).
 * @param ctx - plugin context carrying the Blue services.
 * @param req - the pending decision.
 * @returns the chosen outcome.
 */
function prompt(ctx: Context, req: ApprovalRequest): Promise<ApprovalOutcome> {
  if (req.signal?.aborted) return Promise.resolve<ApprovalOutcome>('cancelled')
  return new Promise<ApprovalOutcome>((resolve) => {
    let settled = false
    const settle = (outcome: ApprovalOutcome): void => {
      if (settled) return
      settled = true
      req.signal?.removeEventListener('abort', onAbort)
      handle.hide()
      resolve(outcome)
    }
    const component = new ApprovalPrompt({
      theme: ctx.blueTheme,
      components: ctx.blueComponents,
      screen: ctx.blueScreen,
      toolName: req.toolName,
      ...req.reason === undefined ? {} : { reason: req.reason },
      settle,
      allowForSession: () => {
        /* v8 ignore next -- the prompt settles right after recording, so a replay cannot reach this */
        if (settled) return
        let tools = sessionAllowances.get(req.agent)
        if (tools === undefined) {
          tools = new Set()
          sessionAllowances.set(req.agent, tools)
        }
        tools.add(req.toolName)
      },
      steer: (reason) => {
        /* v8 ignore next -- the prompt settles right after steering, so a replay cannot reach this */
        if (settled) return
        req.agent.steer(createUserMessage({
          content: [{ type: 'text', text: `User rejected ${req.toolName}: ${reason}` }],
          source: { kind: 'user' },
        }))
      },
    })
    const handle = ctx.blueScreen.showOverlay(component, {
      width: OVERLAY_WIDTH,
      anchor: OVERLAY_ANCHOR,
      offsetY: OVERLAY_FOOTER_CLEARANCE,
      maxHeight: OVERLAY_MAX_HEIGHT,
    })
    const onAbort = (): void => {
      settle('cancelled')
    }
    req.signal?.addEventListener('abort', onAbort, { once: true })
  })
}
