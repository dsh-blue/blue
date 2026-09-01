/**
 * Boot-time provider onboarding: when no configured provider can resolve a
 * credential, offer the smallest useful setup — one DeepSeek API key. The
 * panel deliberately leaves provider settings untouched; the host's default
 * `deepseek-official` route already supplies the official endpoint and model.
 *
 * @module @dsh-blue/blue-interaction/provider-onboarding
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@dsh-blue/blue-app'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { displayServices } from './display-services.ts'
import { deriveKeyRef } from './provider-add.ts'
import { CanonicalFormController } from './form-panel.ts'

const DEEPSEEK_KEY = 'DEEPSEEK_API_KEY'

/** Stable Cordis plugin name. */
export const name = 'blue-provider-onboarding'
/** App-owned current-Agent selection required before the one-shot check. */
export const inject = ['blueCurrentAgent']

interface Credentials {
  describe(ref: object): Promise<{ configured: boolean }>
  set(ref: object, value: string): Promise<void>
}

interface Llm {
  listProviders(): readonly { id: string }[]
}

interface Settings {
  get(ns: string): unknown
}

/** Read credential references advertised by active provider profiles. */
function credentialRefs(ctx: Context): string[] {
  const refs = new Set<string>([DEEPSEEK_KEY])
  const llm = ctx.get('llm') as Llm | undefined
  if (llm !== undefined) {
    for (const provider of llm.listProviders()) refs.add(deriveKeyRef(provider.id))
  }
  const settings = ctx.get('settings') as Settings | undefined
  if (settings !== undefined) {
    const section = settings.get('llm-pi-ai')
    const providers = typeof section === 'object' && section !== null
      ? (section as { providers?: Record<string, unknown> }).providers
      : undefined
    for (const profile of Object.values(providers ?? {})) {
      if (typeof profile !== 'object' || profile === null) continue
      const ref = (profile as { apiKeyEnv?: unknown }).apiKeyEnv
      if (typeof ref === 'string' && ref.length > 0) refs.add(ref)
    }
  }
  return [...refs]
}

/** Whether at least one known provider has a resolvable credential. */
async function hasConfiguredCredential(ctx: Context, credentials: Credentials): Promise<boolean> {
  const checks = await Promise.all(credentialRefs(ctx).map(async ref => {
    try {
      return (await credentials.describe(credentialRef(ref))).configured
    } catch {
      return false
    }
  }))
  return checks.some(Boolean)
}

/** Mount the first-run key form and return its disposer. */
function mountOnboarding(
  ctx: Context,
  credentials: Credentials,
  isUnloaded: () => boolean,
): (() => void) | undefined {
  const display = displayServices(ctx)
  if (display === undefined) return undefined
  /* v8 ignore next -- the form cannot settle before its mount returns */
  let restore: () => void = () => {}
  const panel = new CanonicalFormController({
    keymap: display.keymap,
    theme: display.theme,
    components: display.components,
    title: 'Connect to DeepSeek',
    subtitle: 'Enter an API key for the official endpoint · Esc to configure another provider',
    fields: [{ id: 'key', label: 'DEEPSEEK_API_KEY', mask: true, required: true }],
    cancelLabel: 'configure another provider later',
    onSubmit: values => {
      void (async () => {
        try {
          /* v8 ignore next -- the required field always submits a string */
          await credentials.set(credentialRef(DEEPSEEK_KEY), values.key ?? '')
          if (isUnloaded()) return
          restore()
          getSharedEditor(ctx)?.notice?.('DeepSeek API key saved')
        } catch (error) {
          if (isUnloaded()) return
          panel.setError(error instanceof Error ? error.message : String(error))
          panel.focusField('key')
          panel.invalidate()
        }
      })()
    },
    onCancel: () => {
      restore()
      getSharedEditor(ctx)?.notice?.('Provider setup skipped — use /provider add to configure a provider')
    },
  })
  restore = mountEditorReplacement(ctx, panel)
  ctx.effect(() => restore)
  return restore
}

/** Mount the one-shot boot check for an interaction fiber. */
export function apply(ctx: Context): void {
  let unloaded = false
  let attempted = false
  let checking = false
  ctx.effect(() => () => {
    unloaded = true
  })

  const check = async (): Promise<void> => {
    if (unloaded || attempted || checking) return
    await ctx.get('loader')?.await()
    if (unloaded || attempted || checking) return
    const credentials = ctx.get('credentials') as Credentials | undefined
    if (ctx.blueCurrentAgent.current() === null || credentials === undefined) return
    checking = true
    try {
      const configured = await hasConfiguredCredential(ctx, credentials)
      if (unloaded) return
      attempted = true
      if (!configured) mountOnboarding(ctx, credentials, () => unloaded)
    } finally {
      checking = false
    }
  }

  const registration = ctx.blueCurrentAgent.subscribe(() => {
    queueMicrotask(() => { void check() })
  })
  ctx.effect(() => registration)
  queueMicrotask(() => { void check() })
}

export { DEEPSEEK_KEY }
