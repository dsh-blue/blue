/**
 * Pure tool-presentation resolution: parse raw argument JSON and ask the host
 * tool registry's `presentCall`/`presentResult` hooks for a render intent.
 * Cordis-free like the fold it serves; every presenter call is contained —
 * an unknown tool, a missing presenter, or a throwing presenter all yield
 * `undefined` and the generic presentation carries on.
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
 * Resolve the pending-call render intent for one tool call.
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
 * Resolve the completed-call render intent for one tool call.
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

/**
 * Whether one tool item is a file Read (the S20 Read-group signal). The
 * rc.7 view vocabulary is the name-independent marker: the harness read
 * tool's pending call presents a generic card tagged `kind: 'read'`, and
 * its completed state the `card: 'read'` `ReadResultView` — Blue's repo
 * never sees the harness's concrete tool set, so the documented view
 * contract is the only stable signal (kimi groups by its own `Read` name).
 * @param item - the folded tool item to classify.
 * @returns true when the item's resolved view marks a read.
 */
export function isReadItem(item: TranscriptToolItem): boolean {
  const view = item.view
  if (view === undefined) return false
  if (!('card' in view)) return false
  if (view.card === 'read') return true
  return view.card === 'generic' && 'kind' in view && view.kind === 'read'
}
