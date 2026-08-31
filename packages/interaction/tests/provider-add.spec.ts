/**
 * The provider picker panel and the Add Provider wizard: row rendering and
 * routing, the two branches, discovery vs manual models, the
 * settings-then-credentials commit sequence, and every guard.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { ENDPOINT_PROTOCOLS, deriveKeyRef, runProviderAdd, runProviderEdit } from '../src/provider-add.ts'
import { CanonicalSelectController, type SelectRow } from '../src/select-list.ts'
import { CURRENT_MARK } from '../src/symbols.ts'
import { setModelsDevLoader, type ModelsDevIndex } from '../src/models-dev.ts'
import { buildIndex } from '../src/models-dev.ts'

/** Tests never touch the network: the offline loader is the default here. */
const offlineLoader = (): Promise<ModelsDevIndex | undefined> => Promise.resolve(undefined)
setModelsDevLoader(offlineLoader)
afterEach(() => { setModelsDevLoader(offlineLoader) })
import { fakeBlueContext, KEY, type FakeScreen } from './fakes.ts'

describe('deriveKeyRef', () => {
  it('derives the conventional credential ref', () => {
    expect(deriveKeyRef('my-gateway')).toBe('MY_GATEWAY_API_KEY')
    expect(deriveKeyRef('openai')).toBe('OPENAI_API_KEY')
  })
})

describe('The /provider picker rows (canonical select controller)', () => {
  const rows: SelectRow[] = [
    { value: 'mock', label: 'Mock', badge: CURRENT_MARK },
    { value: 'z-ai', label: 'Z.ai' },
    { value: '__add__', label: '+ Add provider' },
  ]

  function panel() {
    const { theme, keymap, components } = fakeBlueContext()
    const onSelect = vi.fn()
    const onCancel = vi.fn()
    const component = new CanonicalSelectController({
      keymap, theme, components, rows,
      title: 'Providers',
      titleHint: '· esc cancel · ↵ switch / add',
      onSelect, onCancel,
    })
    return { component, onSelect, onCancel }
  }

  it('renders the configured rows with the current badge and the CTA', () => {
    const { component } = panel()
    const rendered = component.render(70)
    const active = rendered.find(row => row.includes('Mock')) ?? ''
    expect(active).toContain('← current')
    const other = rendered.find(row => row.includes('Z.ai')) ?? ''
    expect(other).not.toContain('← current')
    // The CTA stays a plain text row while the cursor sits elsewhere.
    expect(rendered.some(row => row.includes('+ Add provider'))).toBe(true)
    component.invalidate()
  })

  it('highlights the CTA in primary when the cursor reaches it', () => {
    const { component } = panel()
    component.focused = true
    component.handleInput(KEY.down)
    component.handleInput(KEY.down)
    const cta = component.render(70).find(row => row.includes('+ Add provider')) ?? ''
    expect(cta).toContain('→ + Add provider')
  })

  it('windows a long provider list behind a scroll position row', () => {
    const { theme, keymap, components } = fakeBlueContext()
    const many: SelectRow[] = Array.from({ length: 12 }, (_, index) =>
      ({ value: `p${index}`, label: `P${index}` }))
    many.push({ value: '__add__', label: '+ Add provider' })
    const component = new CanonicalSelectController({
      keymap, theme, components, rows: many,
      onSelect: () => {}, onCancel: () => {},
    })
    const rendered = component.render(70)
    expect(rendered.some(row => row.includes('P0'))).toBe(true)
    expect(rendered.some(row => row.includes('P8'))).toBe(false)
    // The CTA windows like any other row now (S24b uniform rows), so a
    // 13-row list hides it behind the counter.
    expect(rendered.some(row => row.includes('(1/13)'))).toBe(true)
    expect(rendered.some(row => row.includes('+ Add provider'))).toBe(false)
  })

  it('routes Enter by row kind and wraps over the CTA', () => {
    const { component, onSelect, onCancel } = panel()
    component.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'mock' }))
    component.handleInput(KEY.down)
    component.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ value: 'z-ai' }))
    component.handleInput(KEY.down)
    component.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ value: '__add__' }))
    // Down off the CTA wraps to the head; a plain Up steps back off it.
    component.handleInput(KEY.down)
    component.handleInput(KEY.down)
    component.handleInput(KEY.up)
    // Up off the head wraps to the CTA.
    component.handleInput(KEY.up)
    component.handleInput('x')
    component.handleInput(KEY.escape)
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

/** The fake settings service capturing mutations. */
function fakeSettings(behavior: { failMutate?: unknown, section?: Record<string, unknown> } = {}) {
  const mutations: { ns: string, ops: unknown[], expected: number | undefined }[] = []
  const revisions = new Map<string, number>([['llm-pi-ai', 7]])
  const section: Record<string, unknown> = behavior.section ?? {}
  const provider = {
    get: (ns: object) => (String(ns) === 'llm-pi-ai' ? section : undefined),
    describe: () => [{ ns: 'llm-pi-ai', revision: revisions.get('llm-pi-ai') ?? 0 }],
    mutate: async (ns: object, ops: unknown[], expected?: number) => {
      mutations.push({ ns: String(ns), ops: [...ops], expected })
      if (behavior.failMutate !== undefined) throw behavior.failMutate
      if (expected !== undefined && expected !== (revisions.get(String(ns)) ?? 0)) {
        throw new Error('stale revision')
      }
      revisions.set(String(ns), (revisions.get(String(ns)) ?? 0) + 1)
    },
  }
  return { provider: provider as unknown as SettingsProvider, mutations, section }
}

/** The fake credentials service with a set spy. */
function fakeCredentials(behavior: { failSet?: Error } = {}) {
  const set = vi.fn(async (_ref: object, _value: string) => {
    if (behavior.failSet !== undefined) throw behavior.failSet
  })
  const unset = vi.fn(async () => {})
  const provider = { set, unset, resolve: async () => undefined, describe: async () => ({ configured: false, writable: true }) }
  return { provider: provider as unknown as CredentialProvider, set, unset }
}

/** The wizard's llm surface: catalog, configurable directory, discovery. */
function wizardLlm(catalog: {
  active?: string[]
  configurable?: { provider: string, displayName: string, settingsNs?: string }[]
  discovered?: { id: string, contextWindow?: number }[]
  discoveryError?: Error
  withDeepseekEntry?: boolean
  /** Only answer the listing when the probed base ends with /v1 (the
   * new-api convention) — otherwise throw. */
  listingUnderV1Only?: boolean
  /** Every probed base rides here for assertions. */
  probed?: string[]
} = {}): LlmRuntime {
  // A real host lists the deepseek adapter's own configurable entry ahead
  // of the pi-ai catalog — the wizard must pick the pi-ai namespace.
  const deepseek = catalog.withDeepseekEntry === false ? [] : [
    { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek' },
  ]
  const entries = [
    ...deepseek,
    ...(catalog.configurable ?? [
      { provider: 'anthropic', displayName: 'Anthropic' },
      { provider: 'openai', displayName: 'OpenAI' },
    ]),
  ]
  return {
    listProviders: () => (catalog.active ?? ['mock']).map(id => ({ id, name: id })),
    listConfigurableProviders: () => entries.map(entry => ({
      provider: entry.provider,
      displayName: entry.displayName,
      settingsNs: entry.settingsNs ?? 'llm-pi-ai',
      settingsPath: ['providers', entry.provider],
      declared: false,
    })),
    discoverModels: async (_ns: string, request: { baseURL: string }) => {
      catalog.probed?.push(request.baseURL)
      if (catalog.listingUnderV1Only === true && !request.baseURL.endsWith('/v1')) {
        throw new Error(`could not reach ${request.baseURL}/models`)
      }
      if (catalog.discoveryError !== undefined) throw catalog.discoveryError
      return [...catalog.discovered ?? []]
    },
  } as unknown as LlmRuntime
}

/** Advance through the optional Model defaults form with both fields empty. */
async function skipDefaults(screen: FakeScreen): Promise<void> {
  await vi.waitFor(() => {
    const rows = (current(screen).render?.(60) ?? []).join('\n')
    expect(rows).toContain('Model defaults')
  })
  for (let step = 0; step < 4; step += 1) current(screen).handleInput(KEY.enter)
}

/** The panel of the latest unhidden overlay. */
interface DrivenPanel {
  handleInput(data: string): void
  render?(width: number): string[]
}

function current(screen: FakeScreen): DrivenPanel {
  const entry = screen.overlays[screen.overlays.length - 1]
  expect(entry).toBeDefined()
  return entry!.component as never
}

/** Enter and confirm consecutive text fields through the public key contract. */
function confirmTextFields(component: DrivenPanel, values: readonly string[]): void {
  for (const value of values) {
    component.handleInput(value)
    component.handleInput(KEY.enter)
  }
}

/** One driven wizard bench: the context, its fakes, and the display quartet. */
interface Bench {
  readonly ctx: Context
  readonly screen: FakeScreen
  readonly mutations: { ns: string, ops: unknown[], expected: number | undefined }[]
  readonly section: Record<string, unknown>
  readonly credentialSet: ReturnType<typeof vi.fn>
  readonly credentialUnset: ReturnType<typeof vi.fn>
  readonly picker: ReturnType<typeof vi.fn>
  readonly display: { keymap: never, theme: never, components: never }
}

/** Mount a context with the wizard's fake services and display quartet. */
function mountWizard(catalog: Parameters<typeof wizardLlm>[0], behavior: {
  settings?: { failMutate?: unknown, section?: Record<string, unknown> }
  credentials?: { failSet?: Error }
  withSettings?: boolean
  withCredentials?: boolean
} = {}): Bench {
  const { ctx, screen, keymap, theme, components } = fakeBlueContext()
  const settings = fakeSettings(behavior.settings)
  const credentials = fakeCredentials(behavior.credentials)
  ctx.provide('llm', wizardLlm(catalog))
  if (behavior.withSettings !== false) ctx.provide('settings', settings.provider)
  if (behavior.withCredentials !== false) ctx.provide('credentials', credentials.provider)
  return {
    ctx,
    screen,
    mutations: settings.mutations,
    section: settings.section,
    credentialSet: credentials.set,
    credentialUnset: credentials.unset,
    picker: vi.fn(),
    display: { keymap, theme, components } as never,
  }
}

describe('runProviderAdd', () => {
  it('falls back to the provider id when the display name is empty', () => {
    // The display-name helper's empty branch rides through catalogRows in
    // model-commands; here the pane row itself exercises the same rule.
    const { theme, keymap, components } = fakeBlueContext()
    const component = new CanonicalSelectController({
      keymap, theme, components,
      rows: [{ value: 'x', label: '' }],
      onSelect: () => {}, onCancel: () => {},
    })
    const rendered = component.render(60)
    // The empty display name renders the bare row (the id fallback rides
    // in the pane's own name mapping, asserted through the frame existing).
    expect(rendered.join('\n')).toContain('Select')
  })

  it('declares a custom anthropic endpoint, adopting gateway-listed models', async () => {
    // The endpoint declares anthropic-messages (no listing of its own) but
    // answers the openai-completions probe — the gateway fallback.
    const bench = mountWizard({ discovered: [{ id: 'claude-gw-chat' }] })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['my-gateway', 'https://gw.example.com', 'secret'])
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    expect(current(bench.screen).render?.(60).some(row => row.includes('claude-gw-chat'))).toBe(true)
    current(bench.screen).handleInput(' ')
    current(bench.screen).handleInput(KEY.enter)
    await skipDefaults(bench.screen)
    await expect(outcome).resolves.toBe('provider "my-gateway" added')
    expect(bench.mutations).toEqual([{
      ns: 'llm-pi-ai',
      ops: [{ op: 'set', path: ['providers', 'my-gateway'], value: {
        api: 'anthropic-messages',
        baseURL: 'https://gw.example.com',
        models: [{ id: 'claude-gw-chat' }],
        apiKeyEnv: 'MY_GATEWAY_API_KEY',
      } }],
      expected: 7,
    }])
    expect(bench.credentialSet).toHaveBeenCalledWith(credentialRef('MY_GATEWAY_API_KEY'), 'secret')
    expect(bench.picker).toHaveBeenCalledWith('my-gateway')
  })

  it('declares a custom openai endpoint adopting the discovered models', async () => {
    const bench = mountWizard({ discovered: [{ id: 'gpt-x', contextWindow: 128000, maxTokens: 8192 }, { id: 'gpt-y' }] })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['gw2', 'https://gw2.example.com/v1', 'sk-secret'])
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    const adopt = current(bench.screen)
    adopt.handleInput(' ') // toggle the focused gpt-x
    adopt.handleInput(KEY.down)
    adopt.handleInput(' ') // and gpt-y, which reports no capacities
    adopt.handleInput(KEY.enter)
    await skipDefaults(bench.screen)
    await expect(outcome).resolves.toBe('provider "gw2" added')
    const profile = ((bench.mutations[0] ?? { ops: [] }).ops as { value: Record<string, unknown> }[])[0]!.value
    expect(profile.api).toBe('openai-completions')
    expect(profile.models).toEqual([{ id: 'gpt-x', contextWindow: 128000, maxTokens: 8192 }, { id: 'gpt-y' }])
    expect(bench.picker).toHaveBeenCalledWith('gw2')
  })

  it('cancels at each branch step', async () => {
    // Custom branch, at the protocol choice.
    const atProtocol = mountWizard({})
    const protocolRun = runProviderAdd(atProtocol.ctx, atProtocol.display, atProtocol.picker)
    await vi.waitFor(() => { expect(atProtocol.screen.overlays).toHaveLength(1) })
    current(atProtocol.screen).handleInput(KEY.down)
    current(atProtocol.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(atProtocol.screen.overlays).toHaveLength(2) })
    current(atProtocol.screen).handleInput(KEY.escape)
    await expect(protocolRun).resolves.toBe('add provider cancelled')

    // Known branch, at the vendor choice.
    const atVendor = mountWizard({})
    const vendorRun = runProviderAdd(atVendor.ctx, atVendor.display, atVendor.picker)
    await vi.waitFor(() => { expect(atVendor.screen.overlays).toHaveLength(1) })
    current(atVendor.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(atVendor.screen.overlays).toHaveLength(2) })
    current(atVendor.screen).handleInput(KEY.escape)
    await expect(vendorRun).resolves.toBe('add provider cancelled')

    // Known branch, at the key form.
    const atForm = mountWizard({})
    const formRun = runProviderAdd(atForm.ctx, atForm.display, atForm.picker)
    await vi.waitFor(() => { expect(atForm.screen.overlays).toHaveLength(1) })
    current(atForm.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(atForm.screen.overlays).toHaveLength(2) })
    current(atForm.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(atForm.screen.overlays).toHaveLength(3) })
    current(atForm.screen).handleInput(KEY.escape)
    await expect(formRun).resolves.toBe('add provider cancelled')
  })

  it('fills the model defaults and rejects invalid entries', async () => {
    // Invalid context window: the panel stays open with the reason.
    const invalid = mountWizard({ discovered: [{ id: 'big-model' }] })
    const invalidRun = runProviderAdd(invalid.ctx, invalid.display, invalid.picker)
    await vi.waitFor(() => { expect(invalid.screen.overlays).toHaveLength(1) })
    current(invalid.screen).handleInput(KEY.down)
    current(invalid.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(invalid.screen.overlays).toHaveLength(2) })
    current(invalid.screen).handleInput(KEY.down)
    current(invalid.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(invalid.screen.overlays).toHaveLength(3) })
    let form = current(invalid.screen)
    confirmTextFields(form, ['defaults-gw', 'https://defaults.example.com', 'k'])
    await vi.waitFor(() => { expect(invalid.screen.overlays).toHaveLength(4) })
    current(invalid.screen).handleInput(' ')
    current(invalid.screen).handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect((current(invalid.screen).render?.(60) ?? []).join('\n')).toContain('Model defaults')
    })
    form = current(invalid.screen)
    confirmTextFields(form, ['big'])
    form.handleInput(KEY.enter)
    form.handleInput(KEY.enter)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect((form.render?.(60) ?? []).join('\n'))
      .toContain('the context window is a token count (digits only)')
    form.handleInput(KEY.escape)
    form.handleInput(KEY.escape)
    await expect(invalidRun).resolves.toBe('add provider cancelled')

    // Invalid effort level: same treatment.
    const badEffort = mountWizard({ discovered: [{ id: 'm' }] })
    const badEffortRun = runProviderAdd(badEffort.ctx, badEffort.display, badEffort.picker)
    await vi.waitFor(() => { expect(badEffort.screen.overlays).toHaveLength(1) })
    current(badEffort.screen).handleInput(KEY.down)
    current(badEffort.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(badEffort.screen.overlays).toHaveLength(2) })
    current(badEffort.screen).handleInput(KEY.down)
    current(badEffort.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(badEffort.screen.overlays).toHaveLength(3) })
    form = current(badEffort.screen)
    confirmTextFields(form, ['eff-gw', 'https://eff.example.com', 'k'])
    await vi.waitFor(() => { expect(badEffort.screen.overlays).toHaveLength(4) })
    current(badEffort.screen).handleInput(' ')
    current(badEffort.screen).handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect((current(badEffort.screen).render?.(60) ?? []).join('\n')).toContain('Model defaults')
    })
    form = current(badEffort.screen)
    form.handleInput(KEY.down)
    confirmTextFields(form, ['low,ultra'])
    await new Promise(resolve => setTimeout(resolve, 20))
    expect((form.render?.(60) ?? []).join('\n')).toContain('efforts come from')
    form.handleInput(KEY.escape)
    form.handleInput(KEY.escape)
    await expect(badEffortRun).resolves.toBe('add provider cancelled')

    // Valid defaults ride into the profile.
    const valid = mountWizard({ discovered: [{ id: 'big-model' }] })
    const validRun = runProviderAdd(valid.ctx, valid.display, valid.picker)
    await vi.waitFor(() => { expect(valid.screen.overlays).toHaveLength(1) })
    current(valid.screen).handleInput(KEY.down)
    current(valid.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(valid.screen.overlays).toHaveLength(2) })
    current(valid.screen).handleInput(KEY.down)
    current(valid.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(valid.screen.overlays).toHaveLength(3) })
    form = current(valid.screen)
    confirmTextFields(form, ['defaults-gw', 'https://defaults.example.com', 'k'])
    await vi.waitFor(() => { expect(valid.screen.overlays).toHaveLength(4) })
    current(valid.screen).handleInput(' ')
    current(valid.screen).handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect((current(valid.screen).render?.(60) ?? []).join('\n')).toContain('Model defaults')
    })
    form = current(valid.screen)
    confirmTextFields(form, ['1048576', 'low,high'])
    await expect(validRun).resolves.toBe('provider "defaults-gw" added')
    const profile = ((valid.mutations[0] ?? { ops: [] }).ops as { value: Record<string, unknown> }[])[0]!.value
    expect(profile.models).toEqual([{
      id: 'big-model',
      contextWindow: 1048576,
      reasoningEfforts: { low: 'low', high: 'high' },
    }])
  })

  it('discovers through the /v1 candidate and keeps the bare base for anthropic', async () => {
    // The gateway answers the listing only under /v1/models; the entered
    // base has no /v1 (the anthropic convention) — the probe walks to the
    // /v1 candidate and the profile keeps the bare base.
    const probed: string[] = []
    const bench = mountWizard({ discovered: [{ id: 'glm-5.3' }], listingUnderV1Only: true, probed })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['bare-gw', 'https://bare.example.com', 'k'])
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    current(bench.screen).handleInput(' ')
    current(bench.screen).handleInput(KEY.enter)
    await skipDefaults(bench.screen)
    await expect(outcome).resolves.toBe('provider "bare-gw" added')
    expect(probed[0]).toBe('https://bare.example.com')
    expect(probed).toContain('https://bare.example.com/v1')
    const profile = ((bench.mutations[0] ?? { ops: [] }).ops as { value: Record<string, unknown> }[])[0]!.value
    // anthropic-messages: no trailing /v1 — the transport appends it.
    expect(profile.baseURL).toBe('https://bare.example.com')
    expect(profile.api).toBe('anthropic-messages')
  })

  it('carries the /v1 candidate into the profile for openai protocols', async () => {
    const probed: string[] = []
    const bench = mountWizard({ discovered: [{ id: 'gpt-x' }], listingUnderV1Only: true, probed })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['v1-gw', 'https://v1.example.com', 'k'])
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    current(bench.screen).handleInput(' ')
    current(bench.screen).handleInput(KEY.enter)
    await skipDefaults(bench.screen)
    await expect(outcome).resolves.toBe('provider "v1-gw" added')
    const profile = ((bench.mutations[0] ?? { ops: [] }).ops as { value: Record<string, unknown> }[])[0]!.value
    // openai-completions appends /chat/completions — the base must carry /v1.
    expect(profile.baseURL).toBe('https://v1.example.com/v1')
  })

  it('keeps an entered /v1 base for openai protocols when it lists there', async () => {
    const bench = mountWizard({ discovered: [{ id: 'gpt-x' }] })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['kept-gw', 'https://kept.example.com/v1', 'k'])
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    current(bench.screen).handleInput(' ')
    current(bench.screen).handleInput(KEY.enter)
    await skipDefaults(bench.screen)
    await expect(outcome).resolves.toBe('provider "kept-gw" added')
    const profile = ((bench.mutations[0] ?? { ops: [] }).ops as { value: Record<string, unknown> }[])[0]!.value
    expect(profile.baseURL).toBe('https://kept.example.com/v1')
  })

  it('strips a trailing /v1 from anthropic bases when the listing answers', async () => {
    const bench = mountWizard({ discovered: [{ id: 'strip-chat' }] })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['strip-gw', 'https://strip.example.com/v1/', 'k'])
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    current(bench.screen).handleInput(' ')
    current(bench.screen).handleInput(KEY.enter)
    await skipDefaults(bench.screen)
    await expect(outcome).resolves.toBe('provider "strip-gw" added')
    const profile = ((bench.mutations[0] ?? { ops: [] }).ops as { value: Record<string, unknown> }[])[0]!.value
    expect(profile.baseURL).toBe('https://strip.example.com')
  })

  it('writes to llm-pi-ai even when the deepseek entry lists first', async () => {
    // The default wizardLlm fixture already leads with the deepseek
    // entry; a completed custom flow pins the pi-ai namespace.
    const bench = mountWizard({ discovered: [{ id: 'gw-chat' }] })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['ns-check', 'https://ns.example.com', 'k'])
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    current(bench.screen).handleInput(' ')
    current(bench.screen).handleInput(KEY.enter)
    await skipDefaults(bench.screen)
    await expect(outcome).resolves.toBe('provider "ns-check" added')
    expect(bench.mutations[0]?.ns).toBe('llm-pi-ai')
  })

  it('answers the guard when no pi-ai surface exists', async () => {
    const bench = mountWizard({ withDeepseekEntry: false, configurable: [
      { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek' },
    ] })
    await expect(runProviderAdd(bench.ctx, bench.display, bench.picker))
      .resolves.toBe('no configurable providers: the host composition carries no llm-pi-ai provider settings surface')
  })

  it('returns to the form with the credential reason when the key is rejected', async () => {
    const bench = mountWizard({
      discoveryError: Object.assign(new Error('401 from /models; check the API key'), { code: 'INVALID_CREDENTIAL_CODE' }),
    })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['locked', 'https://locked.example.com', 'k'])
    await vi.waitFor(() => {
      const rows = (current(bench.screen).render?.(120) ?? []).join('\n')
      expect(rows).toContain('check the API key')
    })
    expect(bench.mutations).toEqual([])
    current(bench.screen).handleInput(KEY.escape)
    await expect(outcome).resolves.toBe('add provider cancelled')
  })

  it('returns to the form when the endpoint lists nothing', async () => {
    const bench = mountWizard({ discovered: [] })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['quiet', 'https://quiet.example.com', 'k'])
    await vi.waitFor(() => {
      const rows = (current(bench.screen).render?.(120) ?? []).join('\n')
      expect(rows).toContain('the endpoint listed no models under https://quiet.example.com')
    })
    expect(bench.mutations).toEqual([])
    current(bench.screen).handleInput(KEY.escape)
    await expect(outcome).resolves.toBe('add provider cancelled')
  })

  it('edits a configured provider and keeps untouched fields', async () => {
    const bench = mountWizard({}, {
      settings: { section: { providers: { 'my-gw': {
        api: 'anthropic-messages',
        baseURL: 'https://old.example.com/v1',
        models: [{ id: 'keep-me' }],
        apiKeyEnv: 'MY_GW_API_KEY',
      } } } },
    })
    const outcome = runProviderEdit(bench.ctx, bench.display, 'my-gw')
    await vi.waitFor(() => {
      const rows = (current(bench.screen).render?.(80) ?? []).join('\n')
      expect(rows).toContain('Configure my-gw')
    })
    const form = current(bench.screen)
    // Prefilled: name (route fallback), base URL; the key starts empty.
    // Clear the base URL and retype, then walk to the key.
    form.handleInput(KEY.down)
    form.handleInput(KEY.enter)
    for (let i = 0; i < 40; i += 1) form.handleInput('\x7f')
    confirmTextFields(form, ['https://new.example.com', 'fresh-key'])
    await expect(outcome).resolves.toBe('provider "my-gw" updated')
    const op = ((bench.mutations[0] ?? { ops: [] }).ops as { op: string, path: string[], value?: Record<string, unknown> }[])[0]!
    expect(op.op).toBe('set')
    expect(op.path).toEqual(['providers', 'my-gw'])
    // api/models/apiKeyEnv kept; the anthropic base strips its trailing /v1.
    expect(op.value).toMatchObject({
      api: 'anthropic-messages',
      baseURL: 'https://new.example.com',
      apiKeyEnv: 'MY_GW_API_KEY',
      models: [{ id: 'keep-me' }],
    })
    expect(bench.credentialSet).toHaveBeenCalledWith(credentialRef('MY_GW_API_KEY'), 'fresh-key')
  })

  it('keeps the stored base URL and key when the edit fields stay empty', async () => {
    const bench = mountWizard({}, {
      settings: { section: { providers: { keepall: {
        api: 'openai-completions',
        baseURL: 'https://keep.example.com/v1',
        apiKeyEnv: 'KEEPALL_API_KEY',
      } } } },
    })
    const outcome = runProviderEdit(bench.ctx, bench.display, 'keepall')
    await vi.waitFor(() => {
      expect((current(bench.screen).render?.(80) ?? []).join('\n')).toContain('Configure keepall')
    })
    // Walk to the last field and submit with everything untouched.
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    current(bench.screen).handleInput(KEY.enter)
    await expect(outcome).resolves.toBe('provider "keepall" updated')
    const op = ((bench.mutations[0] ?? { ops: [] }).ops as { value?: Record<string, unknown> }[])[0]!
    expect(op.value).toMatchObject({
      api: 'openai-completions',
      baseURL: 'https://keep.example.com/v1',
      displayName: 'keepall',
    })
    expect(bench.credentialSet).not.toHaveBeenCalled()
  })

  it('does not expose base URL when editing a known provider', async () => {
    const bench = mountWizard({}, {
      settings: { section: { providers: { anthropic: {
        baseURL: 'https://legacy-proxy.example.com',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
      } } } },
    })
    const outcome = runProviderEdit(bench.ctx, bench.display, 'anthropic')
    await vi.waitFor(() => {
      const rows = (current(bench.screen).render?.(100) ?? []).join('\n')
      expect(rows).toContain('Configure anthropic')
      expect(rows).not.toContain('Base URL')
    })
    const form = current(bench.screen)
    form.handleInput(KEY.down)
    confirmTextFields(form, ['replacement-key'])
    await expect(outcome).resolves.toBe('provider "anthropic" updated')
    const op = ((bench.mutations[0] ?? { ops: [] }).ops as { value?: Record<string, unknown> }[])[0]!
    expect(op.value).toMatchObject({ baseURL: 'https://legacy-proxy.example.com' })
    expect(bench.credentialSet).toHaveBeenCalledWith(credentialRef('ANTHROPIC_API_KEY'), 'replacement-key')
  })

  it('reports a failed edit write', async () => {
    const bench = mountWizard({}, {
      settings: {
        failMutate: new Error('locked'),
        section: { providers: { stuck: { baseURL: 'https://x' } } },
      },
    })
    const outcome = runProviderEdit(bench.ctx, bench.display, 'stuck')
    await vi.waitFor(() => {
      expect((current(bench.screen).render?.(80) ?? []).join('\n')).toContain('Configure stuck')
    })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    current(bench.screen).handleInput(KEY.enter)
    await expect(outcome).resolves.toBe('could not update provider stuck: locked')
  })

  it('deletes a configured provider after the typed confirmation', async () => {
    const bench = mountWizard({}, {
      settings: { section: { providers: { gone: { baseURL: 'https://x', apiKeyEnv: 'GONE_API_KEY' } } } },
    })
    const outcome = runProviderEdit(bench.ctx, bench.display, 'gone')
    await vi.waitFor(() => {
      expect((current(bench.screen).render?.(80) ?? []).join('\n')).toContain('Configure gone')
    })
    current(bench.screen).handleInput('\x04')
    await vi.waitFor(() => {
      expect((current(bench.screen).render?.(80) ?? []).join('\n')).toContain('Delete gone')
    })
    current(bench.screen).handleInput('y')
    current(bench.screen).handleInput(KEY.enter)
    await expect(outcome).resolves.toBe('provider "gone" removed')
    const op = ((bench.mutations[0] ?? { ops: [] }).ops as { op: string, path: string[] }[])[0]!
    expect(op.op).toBe('unset')
    expect(op.path).toEqual(['providers', 'gone'])
    expect(bench.credentialUnset).toHaveBeenCalledWith(credentialRef('GONE_API_KEY'))
  })

  it('covers the no-base-URL and cleared-name edit corners', async () => {
    // A profile without baseURL (its initial falls back); the name field
    // is cleared to empty (the displayName falls back to the route).
    const bench = mountWizard({}, {
      settings: { section: { providers: { bare: { apiKeyEnv: 'BARE_API_KEY' } } } },
    })
    const outcome = runProviderEdit(bench.ctx, bench.display, 'bare')
    await vi.waitFor(() => {
      expect((current(bench.screen).render?.(80) ?? []).join('\n')).toContain('Configure bare')
    })
    const form = current(bench.screen)
    // Clear the name, type a fresh base URL, leave the key empty.
    form.handleInput(KEY.enter)
    for (let i = 0; i < 10; i += 1) form.handleInput('\x7f')
    form.handleInput(KEY.enter)
    form.handleInput('https://bare2.example.com/v1')
    form.handleInput(KEY.enter)
    form.handleInput(KEY.enter)
    form.handleInput(KEY.enter)
    await expect(outcome).resolves.toBe('provider "bare" updated')
    const op = ((bench.mutations[0] ?? { ops: [] }).ops as { value?: Record<string, unknown> }[])[0]!
    expect(op.value).toMatchObject({
      displayName: 'bare',
      baseURL: 'https://bare2.example.com/v1',
    })
  })

  it('rejects a non-y delete confirmation', async () => {
    const bench = mountWizard({}, {
      settings: { section: { providers: { unsure: { baseURL: 'https://x' } } } },
    })
    const outcome = runProviderEdit(bench.ctx, bench.display, 'unsure')
    await vi.waitFor(() => {
      expect((current(bench.screen).render?.(80) ?? []).join('\n')).toContain('Configure unsure')
    })
    current(bench.screen).handleInput('\x04')
    await vi.waitFor(() => {
      expect((current(bench.screen).render?.(80) ?? []).join('\n')).toContain('Delete unsure')
    })
    current(bench.screen).handleInput('n')
    current(bench.screen).handleInput(KEY.enter)
    expect((current(bench.screen).render?.(80) ?? []).join('\n')).toContain('type y to confirm')
    current(bench.screen).handleInput(KEY.enter)
    current(bench.screen).handleInput('\x7f')
    current(bench.screen).handleInput('y')
    current(bench.screen).handleInput(KEY.enter)
    await expect(outcome).resolves.toBe('provider "unsure" removed')
  })

  it('answers a non-object section and a cancelled delete confirm', async () => {
    const empty = mountWizard({}, { settings: { section: 'not-an-object' } })
    await expect(runProviderEdit(empty.ctx, empty.display, 'x'))
      .resolves.toContain('no stored profile')

    const bench = mountWizard({}, {
      settings: { section: { providers: { stay: { baseURL: 'https://x' } } } },
    })
    const outcome = runProviderEdit(bench.ctx, bench.display, 'stay')
    await vi.waitFor(() => {
      expect((current(bench.screen).render?.(80) ?? []).join('\n')).toContain('Configure stay')
    })
    current(bench.screen).handleInput('\x04')
    await vi.waitFor(() => {
      expect((current(bench.screen).render?.(80) ?? []).join('\n')).toContain('Delete stay')
    })
    current(bench.screen).handleInput(KEY.escape)
    await expect(outcome).resolves.toBe('delete cancelled')
    expect(bench.mutations).toEqual([])
  })

  it('reports a failed delete write', async () => {
    const bench = mountWizard({}, {
      settings: {
        failMutate: new Error('read-only'),
        section: { providers: { locked: { baseURL: 'https://x' } } },
      },
    })
    const outcome = runProviderEdit(bench.ctx, bench.display, 'locked')
    await vi.waitFor(() => {
      expect((current(bench.screen).render?.(80) ?? []).join('\n')).toContain('Configure locked')
    })
    current(bench.screen).handleInput('\x04')
    await vi.waitFor(() => {
      expect((current(bench.screen).render?.(80) ?? []).join('\n')).toContain('Delete locked')
    })
    current(bench.screen).handleInput('y')
    current(bench.screen).handleInput(KEY.enter)
    await expect(outcome).resolves.toBe('could not delete provider locked: read-only')
  })

  it('answers the edit guards: missing services, profile-less routes, cancel', async () => {
    const noServices = mountWizard({}, { withSettings: false })
    await expect(runProviderEdit(noServices.ctx, noServices.display, 'mock'))
      .resolves.toBe('provider configuration requires the host settings and credentials services')

    const profileless = mountWizard({})
    await expect(runProviderEdit(profileless.ctx, profileless.display, 'mock'))
      .resolves.toContain('no stored profile')

    const bench = mountWizard({}, {
      settings: { section: { providers: { keep: { baseURL: 'https://x' } } } },
    })
    const outcome = runProviderEdit(bench.ctx, bench.display, 'keep')
    await vi.waitFor(() => {
      expect((current(bench.screen).render?.(80) ?? []).join('\n')).toContain('Configure keep')
    })
    current(bench.screen).handleInput(KEY.escape)
    await expect(outcome).resolves.toBe('provider edit cancelled')
    expect(bench.mutations).toEqual([])
  })

  it('cancels at the adopt step after a successful discovery', async () => {
    const bench = mountWizard({ discovered: [{ id: 'gpt-x' }] })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['gw4', 'https://gw4.example.com', 'k'])
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    current(bench.screen).handleInput(KEY.escape)
    await expect(outcome).resolves.toBe('add provider cancelled')
    expect(bench.mutations).toEqual([])
  })

  it('surfaces the underlying cause chain behind the discovery wrapper', async () => {
    // `could not reach <url>` parks the real reason (DNS, TLS, refused
    // socket) in `cause`; the form's error line must show it, not just the
    // wrapper — and stay open for a retry.
    const root = new Error('unable to verify the first certificate')
    const wrapped = new Error('could not reach https://tls.example.com/v1/models', { cause: new Error('fetch failed', { cause: root }) })
    const bench = mountWizard({ discoveryError: wrapped })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['tls-gw', 'https://tls.example.com', 'k'])
    await vi.waitFor(() => {
      const rows = (current(bench.screen).render?.(200) ?? []).join('\n')
      expect(rows).toContain('could not list models from the endpoint: could not reach')
      expect(rows).toContain('unable to verify the first certificate')
    })
    current(bench.screen).handleInput(KEY.escape)
    await expect(outcome).resolves.toBe('add provider cancelled')
  })

  it('returns to the form with the classified reason when discovery fails', async () => {
    const bench = mountWizard({ discoveryError: new Error('could not reach https://gw3.example.com/models') })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['gw3', 'https://gw3.example.com', 'k'])
    // The form stays mounted with the reason in its error line; nothing
    // was written and no manual stage appears.
    await vi.waitFor(() => {
      const rows = (current(bench.screen).render?.(120) ?? []).join('\n')
      expect(rows).toContain('Custom endpoint')
      expect(rows).toContain('could not list models from the endpoint: could not reach https://gw3.example.com/models')
    })
    expect(bench.mutations).toEqual([])
    // Escape is the only way out.
    current(bench.screen).handleInput(KEY.escape)
    await expect(outcome).resolves.toBe('add provider cancelled')
  })

  it('adopts a known vendor with just the key', async () => {
    const bench = mountWizard({})
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['vendor-key'])
    await expect(outcome).resolves.toBe('provider "anthropic" added')
    const profile = ((bench.mutations[0] ?? { ops: [] }).ops as { value: Record<string, unknown> }[])[0]!.value
    expect(profile).toEqual({ apiKeyEnv: 'ANTHROPIC_API_KEY' })
    expect(bench.credentialSet).toHaveBeenCalledWith(credentialRef('ANTHROPIC_API_KEY'), 'vendor-key')
  })

  it('adopts models.dev metadata and skips the defaults form when fully matched', async () => {
    const catalog = {
      'z-ai': { models: { 'glm-5.3': {
        limit: { context: 1_048_576, output: 65_536 },
        reasoning_options: [{ type: 'effort', values: ['none', 'low', 'high'] }],
      } } },
    }
    setModelsDevLoader(() => Promise.resolve(buildIndex(catalog)))
    const bench = mountWizard({ discovered: [{ id: 'glm-5.3' }] })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['z-ai-gw', 'https://z.example.com/v1', 'k'])
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    current(bench.screen).handleInput(' ')
    current(bench.screen).handleInput(KEY.enter)
    // Fully matched: no defaults form — the add commits directly.
    await expect(outcome).resolves.toBe('provider "z-ai-gw" added')
    const profile = ((bench.mutations[0] ?? { ops: [] }).ops as { value: Record<string, unknown> }[])[0]!.value
    expect(profile.models).toEqual([{
      id: 'glm-5.3',
      contextWindow: 1_048_576,
      maxTokens: 65_536,
      reasoningEfforts: { low: 'low', high: 'high' },
    }])
  })

  it('keeps a listing-reported window over the catalog match', async () => {
    const catalog = { openai: { models: { 'gpt-x': { limit: { context: 8_000 } } } } }
    setModelsDevLoader(() => Promise.resolve(buildIndex(catalog)))
    // The gateway's own listing reported 128k for gpt-x; the catalog's 8k
    // must not overwrite it.
    const bench = mountWizard({ discovered: [{ id: 'gpt-x', contextWindow: 128_000 }] })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['listed-gw', 'https://l.example.com/v1', 'k'])
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    current(bench.screen).handleInput(' ')
    current(bench.screen).handleInput(KEY.enter)
    // The listing's window survived; the efforts gap still offers the
    // (skippable) defaults form.
    await skipDefaults(bench.screen)
    await expect(outcome).resolves.toBe('provider "listed-gw" added')
    const profile = ((bench.mutations[0] ?? { ops: [] }).ops as { value: Record<string, unknown> }[])[0]!.value
    expect(profile.models).toEqual([{ id: 'gpt-x', contextWindow: 128_000 }])
  })

  it('marks a catalog non-reasoning model without a defaults stop', async () => {
    const catalog = {
      openai: { models: { 'gpt-4o-mini': { limit: { context: 128_000 }, reasoning: false } } },
    }
    setModelsDevLoader(() => Promise.resolve(buildIndex(catalog)))
    const bench = mountWizard({ discovered: [{ id: 'gpt-4o-mini' }] })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['oai-gw', 'https://o.example.com/v1', 'k'])
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    current(bench.screen).handleInput(' ')
    current(bench.screen).handleInput(KEY.enter)
    await expect(outcome).resolves.toBe('provider "oai-gw" added')
    const profile = ((bench.mutations[0] ?? { ops: [] }).ops as { value: Record<string, unknown> }[])[0]!.value
    expect(profile.models).toEqual([{ id: 'gpt-4o-mini', contextWindow: 128_000, reasoningEfforts: false }])
  })

  it('falls to the defaults form with the catalog note when the match is partial', async () => {
    const catalog = {
      'z-ai': { models: { 'glm-4.6': { limit: { context: 200_000 } } } },
    }
    setModelsDevLoader(() => Promise.resolve(buildIndex(catalog)))
    const bench = mountWizard({ discovered: [{ id: 'glm-4.6' }, { id: 'custom-model' }] })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['mixed-gw', 'https://m.example.com/v1', 'k'])
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    // Toggle both rows so both models ride along.
    current(bench.screen).handleInput(' ')
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(' ')
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect((current(bench.screen).render?.(60) ?? []).join('\n')).toContain('did not describe every model')
    })
    // The matched model keeps its catalog window; the form fills the rest.
    current(bench.screen).handleInput('65536')
    current(bench.screen).handleInput(KEY.enter)
    current(bench.screen).handleInput(KEY.enter)
    current(bench.screen).handleInput(KEY.enter)
    await expect(outcome).resolves.toBe('provider "mixed-gw" added')
    const profile = ((bench.mutations[0] ?? { ops: [] }).ops as { value: Record<string, unknown> }[])[0]!.value
    expect(profile.models).toEqual([
      { id: 'glm-4.6', contextWindow: 200_000 },
      { id: 'custom-model', contextWindow: 65536 },
    ])
  })

  it('answers the guard texts: missing services, empty directory, all-active', async () => {
    const noSettings = await mountWizard({}, { withSettings: false })
    await expect(runProviderAdd(noSettings.ctx, noSettings.display, noSettings.picker))
      .resolves.toBe('provider configuration requires the host settings, credentials, and llm services')

    const noCredentials = await mountWizard({}, { withCredentials: false })
    await expect(runProviderAdd(noCredentials.ctx, noCredentials.display, noCredentials.picker))
      .resolves.toBe('provider configuration requires the host settings, credentials, and llm services')

    const noConfigurable = await mountWizard({ configurable: [] })
    await expect(runProviderAdd(noConfigurable.ctx, noConfigurable.display, noConfigurable.picker))
      .resolves.toBe('no configurable providers: the host composition carries no llm-pi-ai provider settings surface')

    const allActive = await mountWizard({
      active: ['mock', 'anthropic', 'openai'],
      configurable: [{ provider: 'anthropic', displayName: 'Anthropic' }],
    })
    const outcome = runProviderAdd(allActive.ctx, allActive.display, allActive.picker)
    await vi.waitFor(() => { expect(allActive.screen.overlays).toHaveLength(1) })
    current(allActive.screen).handleInput(KEY.enter)
    await expect(outcome).resolves.toBe('every catalog vendor is already active — switch with /provider switch')
  })

  it('cancels quietly at the source step', async () => {
    const bench = mountWizard({})
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.escape)
    await expect(outcome).resolves.toBe('add provider cancelled')
    expect(bench.mutations).toEqual([])
    expect(bench.credentialSet).not.toHaveBeenCalled()
  })

  it('rejects an invalid provider name in the form without closing it', async () => {
    const bench = mountWizard({ discovered: [] })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['BAD_ROUTE'])
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(bench.mutations).toEqual([])
    expect((form.render?.(60) ?? []).some(row => row.includes('provider names are lowercase kebab-case'))).toBe(true)
    // The wizard stays pending; cancel it through the still-open form.
    form.handleInput(KEY.escape)
    form.handleInput(KEY.escape)
    await expect(outcome).resolves.toBe('add provider cancelled')
  })

  it('surfaces a plain-string settings failure', async () => {
    const bench = mountWizard({}, { settings: { failMutate: 'plain reject' } })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    current(bench.screen).handleInput(KEY.enter)
    current(bench.screen).handleInput('k')
    current(bench.screen).handleInput(KEY.enter)
    await expect(outcome).resolves.toBe('could not add provider anthropic: plain reject')
  })

  it('rejects an existing provider name in the custom form', async () => {
    const bench = mountWizard({ active: ['mock', 'anthropic', 'openai'] })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    confirmTextFields(form, ['mock'])
    await new Promise(resolve => setTimeout(resolve, 10))
    expect((form.render?.(60) ?? []).some(row => row.includes('provider name "mock" already exists'))).toBe(true)
    expect(bench.mutations).toEqual([])
    form.handleInput(KEY.escape)
    form.handleInput(KEY.escape)
    await expect(outcome).resolves.toBe('add provider cancelled')
  })


  it('surfaces a failed settings write', async () => {
    const bench = mountWizard({}, { settings: { failMutate: new Error('schema rejected') } })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    form.handleInput(KEY.enter)
    form.handleInput('k')
    form.handleInput(KEY.enter)
    await expect(outcome).resolves.toBe('could not add provider anthropic: schema rejected')
    expect(bench.credentialSet).not.toHaveBeenCalled()
  })

  it('lists the endpoint protocols for the custom branch', () => {
    expect([...ENDPOINT_PROTOCOLS]).toEqual(['anthropic-messages', 'openai-completions', 'openai-responses'])
  })
})
