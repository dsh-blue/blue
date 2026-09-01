/**
 * Shift+Tab mode cycling over native dsh projections, permission presets,
 * and commands.
 *
 * @module @dsh-blue/blue-interaction/mode-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-session-projection'
import { displayServices } from './display-services.ts'
import { getSharedEditor } from './editor-instance.ts'
import type { PermissionPresetsService } from './permission-panel.ts'

/** Blue's three labels, derived entirely from native dsh state. */
export type BlueSessionMode = 'normal' | 'plan' | 'yolo'

/** Native state needed to render and advance the three-state cycle. */
export interface BlueSessionModeSnapshot {
  readonly mode: BlueSessionMode
  readonly plan: { readonly active: boolean, readonly pending: boolean } | undefined
  readonly normalPreset: string | undefined
  readonly yoloPreset: string | undefined
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Resolve Blue's labels from dsh's plan projection and permission bundles. */
export function sessionModeSnapshot(ctx: Context, agent: Agent): BlueSessionModeSnapshot {
  const plan = ctx.sessionProjections.snapshot(agent.session, ['plan']).values.plan
  const presets = ctx.get('permissionPresets') as PermissionPresetsService | undefined
  const normalPreset = presets?.names.find(name => {
    const spec = presets.resolve(name)
    return spec.sandbox === 'workspace-write' && spec.approval === 'ask'
  })
  const yoloPreset = presets?.names.find(name => {
    const spec = presets.resolve(name)
    return spec.sandbox === 'danger-full-access' && spec.approval === 'never'
  })
  const currentPreset = presets?.current(agent.session)
  const mode = currentPreset === yoloPreset && yoloPreset !== undefined
    ? 'yolo'
    : plan?.active === true || plan?.pending === true ? 'plan' : 'normal'
  return { mode, plan, normalPreset, yoloPreset }
}

function showResult(ctx: Context, result: { readonly kind: 'success' | 'error', readonly text?: string }): void {
  if (result.text === undefined) return
  const paint = result.kind === 'error' ? displayServices(ctx)?.colors.error : undefined
  getSharedEditor(ctx)?.notice?.(paint === undefined ? result.text : paint(result.text))
}

/** Cycle the current Agent through normal, plan, and native full-access mode. */
export async function cycleMode(ctx: Context): Promise<void> {
  const agent = ctx.blueCurrentAgent.current()
  if (agent === null) {
    getSharedEditor(ctx)?.notice?.('no session is live yet')
    return
  }
  const state = sessionModeSnapshot(ctx, agent)
  let lines: [string, ...string[]]
  if (state.mode === 'yolo') {
    if (state.normalPreset === undefined) {
      getSharedEditor(ctx)?.notice?.('normal mode is unavailable: no workspace-write/ask permission preset')
      return
    }
    lines = state.plan?.active === true || state.plan?.pending === true
      ? ['/plan off', `/permission ${state.normalPreset}`]
      : [`/permission ${state.normalPreset}`]
  } else if (state.mode === 'plan') {
    lines = ['/plan off', ...(state.yoloPreset === undefined ? [] : [`/permission ${state.yoloPreset}`])]
  } else if (state.plan !== undefined) {
    lines = ['/plan']
  } else if (state.yoloPreset !== undefined) {
    lines = [`/permission ${state.yoloPreset}`]
  } else {
    getSharedEditor(ctx)?.notice?.('mode switching is unavailable')
    return
  }
  try {
    let lastResult: { readonly kind: 'success' | 'error', readonly text?: string } | undefined
    for (const line of lines) {
      const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
      if (execution === undefined) {
        getSharedEditor(ctx)?.notice?.(`mode command is unavailable: ${line.split(' ')[0]}`)
        return
      }
      lastResult = execution.result
      if (lastResult.kind === 'error') {
        showResult(ctx, lastResult)
        return
      }
    }
    showResult(ctx, lastResult!)
  } catch (error) {
    ctx.logger.warn(`mode cycle dispatch failed: ${describe(error)}`)
  }
}
