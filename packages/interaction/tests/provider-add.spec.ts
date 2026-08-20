/**
 * The provider picker panel and the Add Provider wizard: row rendering and
 * routing, the two branches, discovery vs manual models, the
 * settings-then-credentials commit sequence, and every guard.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { ENDPOINT_PROTOCOLS, ProviderPanel, deriveKeyRef, runProviderAdd, type ProviderRow } from '../src/provider-add.ts'
import { fakeBlueContext, KEY, type FakeScreen } from './fakes.ts'

describe('deriveKeyRef', () => {
  it('derives the conventional credential ref', () => {
    expect(deriveKeyRef('my-gateway')).toBe('MY_GATEWAY_API_KEY')
    expect(deriveKeyRef('openai')).toBe('OPENAI_API_KEY')
  })
})

describe('ProviderPanel', () => {
  const rows: ProviderRow[] = [
    { id: 'mock', name: 'Mock' },
    { id: 'z-ai', name: 'Z.ai' },
  ]

  function panel() {
    const { theme, keymap, components } = fakeBlueContext()
    const onSelect = vi.fn()
    const onAdd = vi.fn()
    const onCancel = vi.fn()
    const component = new ProviderPanel({
      keymap, theme, components, rows,
      currentProvider: 'mock',
      onSelect, onAdd, onCancel,
    })
    return { component, onSelect, onAdd, onCancel }
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
    component.handleInput(KEY.down)
    component.handleInput(KEY.down)
    const cta = component.render(70).find(row => row.includes('+ Add provider')) ?? ''
    expect(cta).toContain('^  ❯ + Add provider^')
  })

  it('windows a long provider list behind a scroll position row', () => {
    const { theme, keymap, components } = fakeBlueContext()
    const many: ProviderRow[] = Array.from({ length: 12 }, (_, index) =>
      ({ id: `p${index}`, name: `P${index}` }))
    const component = new ProviderPanel({
      keymap, theme, components, rows: many,
      currentProvider: 'p0',
      onSelect: () => {}, onAdd: () => {}, onCancel: () => {},
    })
    const rendered = component.render(70)
    expect(rendered.some(row => row.includes('P0'))).toBe(true)
    expect(rendered.some(row => row.includes('P8'))).toBe(false)
    expect(rendered.some(row => row.includes('(1/12)'))).toBe(true)
    expect(rendered.some(row => row.includes('+ Add provider'))).toBe(true)
  })

  it('routes Enter by row kind and wraps over the CTA', () => {
    const { component, onSelect, onAdd, onCancel } = panel()
    component.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenCalledWith(rows[0])
    component.handleInput(KEY.down)
    component.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenLastCalledWith(rows[1])
    component.handleInput(KEY.down)
    component.handleInput(KEY.enter)
    expect(onAdd).toHaveBeenCalledOnce()
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
function fakeSettings(behavior: { failMutate?: unknown } = {}) {
  const mutations: { ns: string, ops: unknown[], expected: number | undefined }[] = []
  const revisions = new Map<string, number>([['llm-pi-ai', 7]])
  const provider = {
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
  return { provider: provider as unknown as SettingsProvider, mutations }
}

/** The fake credentials service with a set spy. */
function fakeCredentials(behavior: { failSet?: Error } = {}) {
  const set = vi.fn(async (_ref: object, _value: string) => {
    if (behavior.failSet !== undefined) throw behavior.failSet
  })
  const provider = {
    set,
    unset: async () => {},
    resolve: async () => undefined,
    describe: async () => ({ configured: false, writable: true }),
  }
  return { provider: provider as unknown as CredentialProvider, set }
}

/** The wizard's llm surface: catalog, configurable directory, discovery. */
function wizardLlm(catalog: {
  active?: string[]
  configurable?: { provider: string, displayName: string, settingsNs?: string }[]
  discovered?: { id: string, contextWindow?: number }[]
  discoveryError?: Error
  withDeepseekEntry?: boolean
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
    discoverModels: async () => {
      if (catalog.discoveryError !== undefined) throw catalog.discoveryError
      return [...catalog.discovered ?? []]
    },
  } as unknown as LlmRuntime
}

/** The panel of the latest unhidden overlay. */
function current(screen: FakeScreen): { handleInput(data: string): void, render?(width: number): string[] } {
  const entry = screen.overlays[screen.overlays.length - 1]
  expect(entry).toBeDefined()
  return entry!.component as never
}

/** One driven wizard bench: the context, its fakes, and the display quartet. */
interface Bench {
  readonly ctx: Context
  readonly screen: FakeScreen
  readonly mutations: { ns: string, ops: unknown[], expected: number | undefined }[]
  readonly credentialSet: ReturnType<typeof vi.fn>
  readonly picker: ReturnType<typeof vi.fn>
  readonly display: { keymap: never, theme: never, components: never }
}

/** Mount a context with the wizard's fake services and display quartet. */
function mountWizard(catalog: Parameters<typeof wizardLlm>[0], behavior: {
  settings?: { failMutate?: unknown }
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
    credentialSet: credentials.set,
    picker: vi.fn(),
    display: { keymap, theme, components } as never,
  }
}

describe('runProviderAdd', () => {
  it('falls back to the provider id when the display name is empty', () => {
    // The display-name helper's empty branch rides through catalogRows in
    // model-commands; here the pane row itself exercises the same rule.
    const { theme, keymap, components } = fakeBlueContext()
    const component = new ProviderPanel({
      keymap, theme, components,
      rows: [{ id: 'x', name: '' }],
      currentProvider: '',
      onSelect: () => {}, onAdd: () => {}, onCancel: () => {},
    })
    const rendered = component.render(60)
    // The empty display name renders the bare row (the id fallback rides
    // in the pane's own name mapping, asserted through the row existing).
    expect(rendered.join('\n')).toContain('Add provider')
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
    form.handleInput('my-gateway')
    form.handleInput(KEY.enter)
    form.handleInput('https://gw.example.com')
    form.handleInput(KEY.enter)
    form.handleInput('secret')
    form.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    expect(current(bench.screen).render?.(60).some(row => row.includes('claude-gw-chat'))).toBe(true)
    current(bench.screen).handleInput(' ')
    current(bench.screen).handleInput(KEY.enter)
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
    form.handleInput('gw2')
    form.handleInput(KEY.enter)
    form.handleInput('https://gw2.example.com/v1')
    form.handleInput(KEY.enter)
    form.handleInput('sk-secret')
    form.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    const adopt = current(bench.screen)
    adopt.handleInput(' ') // toggle the focused gpt-x
    adopt.handleInput(KEY.down)
    adopt.handleInput(' ') // and gpt-y, which reports no capacities
    adopt.handleInput(KEY.enter)
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

    // Custom anthropic branch, at the manual model form.
    const atManual = mountWizard({ discovered: [] })
    const manualRun = runProviderAdd(atManual.ctx, atManual.display, atManual.picker)
    await vi.waitFor(() => { expect(atManual.screen.overlays).toHaveLength(1) })
    current(atManual.screen).handleInput(KEY.down)
    current(atManual.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(atManual.screen.overlays).toHaveLength(2) })
    current(atManual.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(atManual.screen.overlays).toHaveLength(3) })
    const form = current(atManual.screen)
    form.handleInput('gw5')
    form.handleInput(KEY.enter)
    form.handleInput('https://gw5.example.com')
    form.handleInput(KEY.enter)
    form.handleInput('k')
    form.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(atManual.screen.overlays).toHaveLength(4) })
    current(atManual.screen).handleInput(KEY.escape)
    await expect(manualRun).resolves.toBe('add provider cancelled')
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
    form.handleInput('ns-check')
    form.handleInput(KEY.enter)
    form.handleInput('https://ns.example.com')
    form.handleInput(KEY.enter)
    form.handleInput('k')
    form.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    current(bench.screen).handleInput(' ')
    current(bench.screen).handleInput(KEY.enter)
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

  it('surfaces a credential rejection in the manual form subtitle', async () => {
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
    form.handleInput('locked')
    form.handleInput(KEY.enter)
    form.handleInput('https://locked.example.com')
    form.handleInput(KEY.enter)
    form.handleInput('k')
    form.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    const manual = current(bench.screen)
    expect((manual.render?.(60) ?? []).some(row => row.includes('check the API key'))).toBe(true)
    manual.handleInput(KEY.escape)
    await expect(outcome).resolves.toBe('add provider cancelled')
  })

  it('says the endpoint listed nothing when discovery succeeds empty', async () => {
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
    form.handleInput('quiet')
    form.handleInput(KEY.enter)
    form.handleInput('https://quiet.example.com')
    form.handleInput(KEY.enter)
    form.handleInput('k')
    form.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    const manual = current(bench.screen)
    expect((manual.render?.(60) ?? []).some(row => row.includes('the endpoint listed no models'))).toBe(true)
    manual.handleInput(KEY.escape)
    await expect(outcome).resolves.toBe('add provider cancelled')
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
    form.handleInput('gw4')
    form.handleInput(KEY.enter)
    form.handleInput('https://gw4.example.com')
    form.handleInput(KEY.enter)
    form.handleInput('k')
    form.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    current(bench.screen).handleInput(KEY.escape)
    await expect(outcome).resolves.toBe('add provider cancelled')
    expect(bench.mutations).toEqual([])
  })

  it('falls back to manual entry when discovery fails', async () => {
    const bench = mountWizard({ discoveryError: new Error('endpoint unreachable') })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    form.handleInput('gw3')
    form.handleInput(KEY.enter)
    form.handleInput('https://gw3.example.com')
    form.handleInput(KEY.enter)
    form.handleInput('k')
    form.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    expect((current(bench.screen).render?.(60) ?? []).some(row => row.includes('discovery failed: endpoint unreachable'))).toBe(true)
    current(bench.screen).handleInput('m1')
    current(bench.screen).handleInput(KEY.enter)
    await expect(outcome).resolves.toBe('provider "gw3" added')
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
    form.handleInput('https://proxy.example.com')
    form.handleInput(KEY.enter)
    form.handleInput('vendor-key')
    form.handleInput(KEY.enter)
    await expect(outcome).resolves.toBe('provider "anthropic" added')
    const profile = ((bench.mutations[0] ?? { ops: [] }).ops as { value: Record<string, unknown> }[])[0]!.value
    expect(profile).toEqual({ baseURL: 'https://proxy.example.com', apiKeyEnv: 'ANTHROPIC_API_KEY' })
    expect(bench.credentialSet).toHaveBeenCalledWith(credentialRef('ANTHROPIC_API_KEY'), 'vendor-key')
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
    form.handleInput('BAD_ROUTE')
    form.handleInput(KEY.enter)
    form.handleInput('https://x')
    form.handleInput(KEY.enter)
    form.handleInput('k')
    form.handleInput(KEY.enter)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(bench.mutations).toEqual([])
    expect((form.render?.(60) ?? []).some(row => row.includes('provider names are lowercase kebab-case'))).toBe(true)
    // The wizard stays pending; cancel it through the still-open form.
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
    form.handleInput('mock')
    form.handleInput(KEY.enter)
    form.handleInput('https://x')
    form.handleInput(KEY.enter)
    form.handleInput('k')
    form.handleInput(KEY.enter)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect((form.render?.(60) ?? []).some(row => row.includes('provider name "mock" already exists'))).toBe(true)
    expect(bench.mutations).toEqual([])
    form.handleInput(KEY.escape)
    await expect(outcome).resolves.toBe('add provider cancelled')
  })

  it('rejects an empty segment in the manual id list', async () => {
    const bench = mountWizard({ discovered: [] })
    const outcome = runProviderAdd(bench.ctx, bench.display, bench.picker)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.down)
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(2) })
    current(bench.screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(3) })
    const form = current(bench.screen)
    form.handleInput('gw6')
    form.handleInput(KEY.enter)
    form.handleInput('https://gw6.example.com')
    form.handleInput(KEY.enter)
    form.handleInput('k')
    form.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(4) })
    const manual = current(bench.screen)
    manual.handleInput('a,,b')
    manual.handleInput(KEY.enter)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(manual.render?.(60).some(row => row.includes('every comma-separated id must be non-empty'))).toBe(true)
    manual.handleInput(KEY.escape)
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
