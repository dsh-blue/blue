/**
 * `blue-questions` plugin: the UI provider for `ctx.userQuestions`. Each
 * question opens a modal overlay — a single-select list when it carries
 * options (a multi-select `BlueSelect` when `multiSelect` is set), a
 * free-text editor otherwise. Escape dismisses the question; an aborted
 * request signal closes the overlay and rejects. Registration is
 * effect-bound, so HMR disposal unregisters the provider.
 *
 * @module @deepseek-ai/dsh-blue-interaction/questions-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionAnswerItem,
  AskUserQuestionItem,
  AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import type { BlueComponent, BlueKeymap } from '@deepseek-ai/dsh-blue-core'
import { ACTION_CANCEL } from './keys.ts'
import { BluePanel, BlueSelect } from './select.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-questions'
/** Services required before the provider can register. */
export const inject = ['blueScreen', 'blueTheme', 'blueKeymap', 'blueComponents', 'userQuestions']

/** Overlay width as a share of the terminal. */
const OVERLAY_WIDTH = '80%'

/**
 * Wrap a free-text editor so the cancel key dismisses the overlay; the
 * editor itself owns every other key.
 */
class EscapeDismiss implements BlueComponent {
  /**
   * @param keymap - keybinding registry used to resolve the cancel key.
   * @param child - the wrapped editor.
   * @param onCancel - called when the cancel key is pressed.
   */
  constructor(
    private readonly keymap: BlueKeymap,
    private readonly child: BlueComponent,
    private readonly onCancel: () => void,
  ) {}

  /**
   * Render the wrapped editor.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    return this.child.render(width)
  }

  /** Drop the child's cached render state. */
  invalidate(): void {
    this.child.invalidate()
  }

  /**
   * Dispatch one input sequence: the cancel key dismisses, everything else
   * goes to the editor.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    if (this.keymap.matches(data, ACTION_CANCEL)) {
      this.onCancel()
      return
    }
    this.child.handleInput?.(data)
  }
}

/**
 * Register the overlay-backed user-questions provider; the fiber's disposal
 * unregisters it.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.userQuestions.registerProvider({
    ask: request => askAll(ctx, request),
  }))
}

/**
 * Answer every question in the request sequentially, one overlay at a time.
 * @param ctx - plugin context carrying the Blue services.
 * @param request - the questions and their abort signal.
 * @returns the collected answers.
 */
async function askAll(ctx: Context, request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
  const answers: AskUserQuestionAnswerItem[] = []
  for (const question of request.questions) {
    answers.push(await askOne(ctx, question, request.signal))
  }
  return { answers }
}

/** Pre-styled header rows for one question's overlay. */
function questionHeader(ctx: Context, question: AskUserQuestionItem, width: number): string[] {
  const colors = ctx.blueTheme.colors
  const truncate = ctx.blueComponents.truncateToWidth
  return [
    ...question.header === undefined ? [] : [colors.muted(truncate(question.header, width))],
    colors.accent(truncate(question.question, width)),
    ...question.detail === undefined ? [] : [colors.muted(truncate(question.detail, width))],
  ]
}

/**
 * Show one question's overlay and settle with the answer; aborting the
 * signal or pressing Escape rejects.
 * @param ctx - plugin context carrying the Blue services.
 * @param question - the question to present.
 * @param signal - abort signal of the owning tool/step.
 * @returns the answer for this question.
 */
function askOne(
  ctx: Context,
  question: AskUserQuestionItem,
  signal: AbortSignal | undefined,
): Promise<AskUserQuestionAnswerItem> {
  // No pre-abort check here: `UserQuestionService.ask` verifies the signal
  // synchronously before invoking the provider, so only the listener path
  // below can observe an abort.
  return new Promise<AskUserQuestionAnswerItem>((resolve, reject) => {
    let settled = false
    const settle = (complete: () => void): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      handle.hide()
      complete()
    }
    const dismiss = (): void => {
      settle(() => {
        reject(new UserQuestionError(`question ${JSON.stringify(question.id)} was dismissed`, 'ASK_DISMISSED'))
      })
    }
    const options = question.options ?? []
    let child: BlueComponent
    if (options.length > 0 && question.multiSelect === true) {
      // pi-tui ships no multi-select list, so the package-local BlueSelect
      // covers this one case.
      child = new BlueSelect({
        keymap: ctx.blueKeymap,
        theme: ctx.blueTheme,
        components: ctx.blueComponents,
        items: options.map(option => ({
          value: option.label,
          label: option.label,
          ...option.description === undefined ? {} : { description: option.description },
        })),
        onConfirm: (items) => {
          settle(() => {
            resolve({ id: question.id, selected: items.map(item => item.label) })
          })
        },
        onCancel: dismiss,
      })
    } else if (options.length > 0) {
      child = ctx.blueComponents.createSelectList({
        items: options.map(option => ({
          value: option.label,
          label: option.label,
          ...option.description === undefined ? {} : { description: option.description },
        })),
        onSelect: (item) => {
          settle(() => {
            resolve({ id: question.id, selected: [item.label] })
          })
        },
        onCancel: dismiss,
      })
    } else {
      const editor = ctx.blueComponents.createEditor()
      // The editor clears its buffer before invoking onSubmit; the callback
      // argument already carries the paste-expanded, trimmed text.
      editor.onSubmit = (text) => {
        settle(() => {
          resolve({ id: question.id, selected: [], ...text.length === 0 ? {} : { custom: text } })
        })
      }
      child = new EscapeDismiss(ctx.blueKeymap, editor, dismiss)
    }
    const contentWidth = Math.max(1, Math.floor(ctx.blueScreen.columns * 0.8) - 2)
    const panel = new BluePanel(questionHeader(ctx, question, contentWidth), child)
    const handle = ctx.blueScreen.showOverlay(panel, { width: OVERLAY_WIDTH, maxHeight: '60%' })
    const onAbort = (): void => {
      settle(() => {
        reject(new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED'))
      })
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
