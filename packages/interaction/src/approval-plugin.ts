/**
 * `blue-approval` plugin: the interactive answerer on the
 * `approval/request` waterfall. Requests for the agent currently attached
 * to the UI open a dialog panel with four choices — Allow once, Allow the
 * tool for this session, Reject, Reject with feedback — navigated with
 * Up/Down and Enter without wrapping, direct-selected with the `1`–`4` digit
 * keys; Escape backs out of editing before it rejects, an aborted request
 * signal cancels, and the feedback choice swaps
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
import type { BlueUiEvent, BlueUiNode } from '@dsh-blue/blue-api'
import type { BlueComponents, BlueFocusable, BlueScreen, BlueTheme } from '@dsh-blue/blue-core'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { BlueTranslate } from '@dsh-blue/blue-frontend'
import { CanonicalPanelAdapter } from './canonical-panel.ts'
import { mountEditorReplacement } from './editor-instance.ts'
import { interactionTranslator, observeInteractionLocale } from './locale.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-approval'
/** Services required before the answerer can listen. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueSessionReader', 'blueSessionActions']

/** Decoded input sequences the prompt handles directly (no keymap actions). */
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
  /** Dynamic translator for approval-owned chrome. */
  readonly t: BlueTranslate
}

/**
 * The approval overlay component: a four-choice menu (Up/Down move without
 * wrapping, Enter confirms, `1`–`4` direct-select, Escape rejects) that
 * swaps to an inline reason editor for "Reject with feedback".
 */
class ApprovalPrompt implements BlueFocusable {
  private readonly adapter: CanonicalPanelAdapter
  private cursor = 0
  private feedback = false
  private reasonDraft = ''

  /**
   * @param options - see {@link ApprovalPromptOptions}.
   */
  constructor(private readonly options: ApprovalPromptOptions) {
    this.adapter = new CanonicalPanelAdapter({
      components: options.components,
      theme: options.theme,
      node: () => this.currentNode(),
      onEvent: event => this.onEvent(event),
      onFocusChange: identity => this.syncCursor(identity.controlId, identity.itemId),
      onTextSubmit: (_controlId, value) => this.submitFeedback(value),
      onUnhandledEscape: () => this.options.settle('rejected'),
      startEditing: () => this.feedback,
      fallbackFocusIdentity: () => this.feedback ? { controlId: 'approval-reason' } : undefined,
      t: options.t,
      suppressAutomaticContextHints: true,
      contextHints: () => this.feedback
        ? [
            { id: 'feedback', keys: 'Type', label: 'feedback', priority: 90 },
            { id: 'activate', keys: 'Enter', label: 'submit', priority: 100 },
            { id: 'dismiss', keys: 'Esc', label: 'reject', priority: 95 },
          ]
        : [
            { id: 'navigate', keys: '↑↓/1-4', label: 'choose', priority: 90 },
            { id: 'activate', keys: 'Enter', label: 'confirm', priority: 100 },
            { id: 'dismiss', keys: 'Esc', label: 'reject', priority: 95 },
          ],
    })
  }

  get focused(): boolean { return this.adapter.focused }
  set focused(value: boolean) { this.adapter.focused = value }

  /** The four choice labels in display order. */
  private labels(): string[] {
    const tool = this.options.toolName
    return [
      this.options.t('Allow once'),
      this.options.t('Allow {tool} for this session', { tool }),
      this.options.t('Reject'),
      this.options.t('Reject with feedback'),
    ]
  }

  /**
   * Dispatch one input sequence against the prompt.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    if (!this.feedback && data >= '1' && data <= '4') {
      this.choose(Number(data) - 1)
      return
    }
    this.adapter.handleInput(data)
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
    this.feedback = true
    this.adapter.focus({ controlId: 'approval-reason' })
    this.options.screen.requestRender()
  }

  private submitFeedback(value: string): void {
    this.reasonDraft = value
    if (value.length > 0) this.options.steer(value)
    this.options.settle('rejected')
  }

  invalidate(): void { this.adapter.invalidate() }

  /**
   * Render the framed dialog: the amber rules, the `▶`-prefixed title, the
   * optional reason, and the numbered menu (`N. label`, the selected row
   * taking a `▶` pointer) or the feedback editor — closed by a key row.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] { return this.adapter.render(width) }

  /** Current renderer-neutral approval tree. */
  currentNode(): BlueUiNode {
    const child: BlueUiNode = this.feedback
      ? { kind: 'form', id: 'approval-feedback', fields: [{ kind: 'input', id: 'approval-reason', label: this.options.t('Reason'), value: this.reasonDraft }] }
      : {
          kind: 'list', id: 'approval-choices', selectedIds: [String(this.cursor)],
          items: this.labels().map((label, index) => ({ id: String(index), label, badge: String(index + 1) })),
        }
    return {
      kind: 'surface', chrome: 'overlay', title: this.options.t('Approve {tool}?', { tool: this.options.toolName }),
      ...(this.options.reason === undefined ? {} : { subtitle: this.options.reason }),
      child,
    }
  }

  private onEvent(event: BlueUiEvent): void {
    if (event.kind === 'value-change' && event.controlId === 'approval-reason' && typeof event.value === 'string') {
      this.reasonDraft = event.value
      return
    }
    if (event.kind === 'selection-change' && event.controlId === 'approval-choices' && typeof event.value === 'string') {
      const index = Number(event.value)
      if (Number.isInteger(index) && index >= 0 && index < this.labels().length) this.choose(index)
    }
  }

  private syncCursor(controlId: string, itemId: string | undefined): void {
    if (controlId !== 'approval-choices' || itemId === undefined) return
    const index = Number(itemId)
    if (!Number.isInteger(index) || index < 0 || index >= this.labels().length || index === this.cursor) return
    this.cursor = index
    this.adapter.invalidate()
    this.options.screen.requestRender()
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
    for (const cancel of cancelPrompts) cancel()
  })
  ctx.effect(() => () => {
    disposed = true
    sessionRegistration.dispose()
    for (const cancel of cancelPrompts) cancel()
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
    let offLocale: () => void
    const settle = (outcome: ApprovalOutcome): void => {
      if (settled) return
      settled = true
      req.signal?.removeEventListener('abort', onAbort)
      offLocale()
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
      t: interactionTranslator(ctx),
    })
    // The kimi dialog mount (D30): the prompt replaces the editor in its
    // dock slot, so below it only the footer remains.
    const restore = mountEditorReplacement(ctx, component)
    offLocale = observeInteractionLocale(ctx, () => {
      component.invalidate()
      ctx.blueScreen.requestRender()
    })
    const onAbort = (): void => {
      settle('cancelled')
    }
    registerCancel(onAbort)
    req.signal?.addEventListener('abort', onAbort, { once: true })
  })
}
