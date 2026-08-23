/**
 * The agent tool-view scope resolution shared by the catalog commands
 * (`/tools`, `/mcp`): under the thin-host migration (D37) the agent's tool
 * surface lives in its preset's standing mount, so enumerations read
 * `schemas(roster.standingKeyFor(...))` — the upstream API built for exactly
 * this "host reader with no agent" case. `scopeOf(agent.ctx)` is
 * deliberately NOT used: `kScope` is a module-level Symbol in dsh-scope, and
 * a dev-linked Blue loads its own dsh-scope instance beside the CLI's — two
 * Symbols, so the CLI-side tag never reads back (the registry install may
 * dedupe to one instance, but the reader must work on the dogfood link
 * too). With no roster — or an agent bound to no preset — the resolution is
 * the global view, the honest catalog on hosts that keep their own agent
 * plane.
 *
 * @module @dsh-blue/blue-interaction/tool-scope
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentPresetsRoster } from './preset-commands.ts'

/**
 * Resolve the registry view scope for an agent's tool surface.
 * @param ctx - plugin context carrying the (optional) preset roster service.
 * @param agentCtx - the live agent's context; `undefined` when no session is
 *   live, which resolves to the global view.
 * @returns the scope object to pass `tools.schemas(scope)`, or `undefined`
 *   for the global view.
 * @throws when the roster cannot resolve its standing mount — the caller
 *   owns the error surface (a command error in `/tools`, a degraded note
 *   elsewhere).
 */
export async function resolveToolViewScope(ctx: Context, agentCtx: Context | undefined): Promise<object | undefined> {
  if (agentCtx === undefined) return undefined
  const roster = ctx.get('agentPresets') as AgentPresetsRoster | undefined
  const current = roster?.composedPreset(agentCtx)
  if (roster === undefined || current === undefined) return undefined
  return await roster.standingKeyFor(current)
}
