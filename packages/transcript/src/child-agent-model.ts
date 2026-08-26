/**
 * Projection-backed child-agent presentation helpers. Child session event
 * reduction belongs to `blueConversationFacts`; this module only correlates
 * readonly child snapshots with parent transcript tool entries.
 *
 * @module @dsh-blue/blue-transcript/child-agent-model
 */

import type { AgentMemberLive } from './agent-group.ts'
import type { ChildSessionFacts, SessionFactsService } from './session-facts.ts'
import type { TranscriptToolItem } from './types.ts'

/** The child session id carried by a spawn-class acknowledgement. */
export function childIdOfResult(item: TranscriptToolItem): string | undefined {
  if (item.result === undefined) return undefined
  return /started subagent ([a-f0-9-]{8,})/.exec(item.result.fullText ?? item.result.text)?.[1]
}

/** Whether a parent call correlates with one projected child snapshot. */
export function correlateChild(child: ChildSessionFacts, member: TranscriptToolItem): boolean {
  const id = childIdOfResult(member)
  if (id !== undefined) return id === child.id
  const args = member.parsedArguments
  const prompt = typeof args === 'object' && args !== null
    ? (args as Record<string, unknown>)['prompt']
    : undefined
  return child.promptText !== undefined && prompt === child.promptText
}

/** Convert renderer-neutral child facts to the existing agent-card view. */
export function childLiveSnapshot(child: ChildSessionFacts): AgentMemberLive {
  return {
    phase: child.phase,
    ...(child.endedAt === undefined ? {} : { endedAt: child.endedAt }),
    ...(child.tokens > 0 ? { tokens: child.tokens } : {}),
    toolCount: child.toolCount,
    ...(child.activity === undefined ? {} : { activity: child.activity }),
    ...(child.model === undefined ? {} : { model: child.model }),
    ...(child.effort === undefined ? {} : { effort: child.effort }),
  }
}

/** Subscribe the current parent session's agent card to projection-backed children. */
export function trackChildAgentModels(
  facts: SessionFactsService,
  changed: () => void,
): { snapshot(member: TranscriptToolItem): AgentMemberLive | undefined; dispose(): void } {
  let children: readonly ChildSessionFacts[] = []
  const dispose = facts.subscribeChildren(next => {
    children = next
    changed()
  })
  return {
    snapshot(member) {
      const child = children.find(candidate => correlateChild(candidate, member))
      return child === undefined ? undefined : childLiveSnapshot(child)
    },
    dispose,
  }
}
