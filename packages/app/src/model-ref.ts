/**
 * The three-tier model-selection reference the app publishes on
 * `blueSession.modelRef` — the seam that lets the interaction layer's model
 * commands read and switch the live Agent's model selection.
 *
 * Reading `current` resolves three tiers in order: a pick made through this
 * reference for the live session (a `/model` switch not yet captured by a
 * request), the session log's last request header (so a resumed session
 * keeps the model it was already using), and the process default from the
 * default-model service. Writing `current` only sets the pick;
 * `installModelSelection` snapshots the merged read when the next step
 * enters prompt assembly, so a switch lands on the next request with no
 * idle guard and no race. The harness web host resolves its selections
 * through the same three tiers.
 *
 * @module @dsh-blue/blue-app/model-ref
 */

import type { Agent, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'

/**
 * The narrowed selection reference Blue publishes: `current` always resolves
 * to a selection because the default tier never fails.
 */
export type BlueModelSelectionRef = ModelSelectionRef & { current: ModelSelection }

/** The fallback tier `createModelSelectionRef` reads when no pick or header exists. */
export interface ModelSelectionDefaults {
  /** The process default selection (the default-model service's current read). */
  currentSelection(): ModelSelection
}

/**
 * Build the three-tier selection reference for one Agent.
 * @param agent - the Agent whose session log feeds the header tier.
 * @param defaultModel - the service supplying the fallback tier.
 * @returns the selection reference; couple it with `installModelSelection` on the agent scope.
 */
export function createModelSelectionRef(
  agent: Agent,
  defaultModel: ModelSelectionDefaults,
): BlueModelSelectionRef {
  /** The only writable tier: a pick made through this reference for the live session. */
  let picked: ModelSelection | undefined
  return {
    get current(): ModelSelection {
      if (picked !== undefined) return picked
      // Incrementally folded by the session, so a per-step read costs
      // O(new events) rather than a rescan.
      const logged = agent.session.requestHeader()?.config
      if (logged === undefined) return defaultModel.currentSelection()
      return {
        provider: logged.provider,
        model: logged.model,
        ...(logged.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: logged.reasoningEffort }),
      }
    },
    set current(next: ModelSelection) {
      picked = next
    },
    assembled: undefined,
  }
}
