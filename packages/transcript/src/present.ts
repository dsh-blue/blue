/**
 * Pure tool-presentation resolution: parse raw argument JSON and ask the host
 * tool registry's `presentCall`/`presentResult` hooks for canonical views.
 * Every presenter call is contained —
 * an unknown tool, a missing presenter, or a throwing presenter all yield
 * `undefined` and the generic presentation carries on. The module also owns
 * shared presentation pure helpers {@link ellipsize} and
 * {@link extractKeyArgument} for the plain fallback card.
 *
 * @module @dsh-blue/blue-transcript/present
 */

import type {
  ToolCallView,
  ToolResult,
  ToolResultView,
  ToolRuntime,
} from '@deepseek-ai/dsh-tools'
import type { TranscriptToolItem } from './types.ts'

/** The slice of the host tool registry the resolvers read. */
export type ToolPresentationSource = Pick<ToolRuntime, 'get'>

/** Maximum length of the key argument shown on a card header. */
export const KEY_ARG_MAX_CHARS = 60

/** The key-arg whitelist, in priority order (the S20 doc's own list). */
const KEY_ARG_KEYS = ['file_path', 'command', 'pattern']

/**
 * Collapse a multi-line string to one ellipsized line.
 * @param text - the text to flatten.
 * @param maxChars - the maximum string length (not terminal columns) kept.
 * @returns whitespace-collapsed text, ellipsized beyond `maxChars`.
 */
export function ellipsize(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars - 1)}…`
}

/**
 * Parse a tool call's raw arguments JSON.
 * @param raw - the arguments string exactly as the model produced it.
 * @returns the parsed value, or `undefined` when the string is invalid JSON.
 */
export function parseToolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * Resolve the pending-call canonical view for one tool call.
 * @param tools - the host tool registry.
 * @param name - the tool name exactly as the model requested it.
 * @param args - the parsed arguments (`undefined` when parsing failed).
 * @returns the call view, or `undefined` when the tool is unknown, declares
 *   no presenter, or its presenter throws.
 */
export function resolveCallView(
  tools: ToolPresentationSource,
  name: string,
  args: unknown,
): ToolCallView | undefined {
  try {
    return tools.get(name)?.presentCall?.(args)
  } catch {
    return undefined
  }
}

/**
 * Resolve the completed-call canonical view for one tool call.
 * @param tools - the host tool registry.
 * @param name - the tool name exactly as the model requested it.
 * @param args - the parsed arguments (`undefined` when parsing failed).
 * @param result - the reconstructed tool result (`content`, `isError`, `meta`).
 * @returns the result view, or `undefined` when the tool is unknown, declares
 *   no presenter, or its presenter throws.
 */
export function resolveResultView(
  tools: ToolPresentationSource,
  name: string,
  args: unknown,
  result: ToolResult,
): ToolResultView | undefined {
  try {
    return tools.get(name)?.presentResult?.(args, result)
  } catch {
    return undefined
  }
}

/** dsh-plan-mode's plan-review exit tool — a named-tool presentation exception. */
const PLAN_REVIEW_TOOL = 'exit_plan_mode'

/**
 * Whether a tool item is a declined plan review: dsh-plan-mode's
 * `exit_plan_mode` answers a rejection (Reject, or Revise with feedback)
 * by failing the call — "The user chose to keep planning…" — a user
 * decision, not a tool failure, so the card renders the warning tone
 * instead of the error state (the `todo_write` precedent for a
 * named-tool presentation exception; no view contract marks it yet).
 * @param item - the settled tool item.
 * @returns whether the card should present a declined plan review.
 */
export function isPlanDecline(item: TranscriptToolItem): boolean {
  return item.name === PLAN_REVIEW_TOOL && item.result?.isError === true
}

/**
 * The S20 key argument for one tool item's header: the whitelist
 * (`file_path`/`command`/`pattern`) first, then the first short string
 * argument. Values flatten to one line at {@link KEY_ARG_MAX_CHARS}.
 * @param item - the folded tool item (reads `parsedArguments`).
 * @returns the display key argument, or `undefined` when none qualifies.
 */
export function extractKeyArgument(item: TranscriptToolItem): string | undefined {
  const parsed = item.parsedArguments
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null) return undefined
  const args = parsed as Record<string, unknown>
  for (const key of KEY_ARG_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value !== '') {
      return ellipsize(value, KEY_ARG_MAX_CHARS)
    }
  }
  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value !== '' && value.length <= KEY_ARG_MAX_CHARS) {
      return ellipsize(value, KEY_ARG_MAX_CHARS)
    }
  }
  return undefined
}
