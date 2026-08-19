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
