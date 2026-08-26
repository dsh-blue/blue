/** Renderer-neutral model/effort picker projection coverage. */

import { describe, expect, it } from 'vitest'
import {
  effortLabel,
  effortPickerPanelModel,
  formatContextWindow,
  modelPickerPanelModel,
  type ModelPickerItem,
} from '../src/model-picker-model.ts'

const item = (overrides: Partial<ModelPickerItem> = {}): ModelPickerItem => ({
  provider: 'mock', providerLabel: 'Mock', id: 'chat', name: 'Chat', ...overrides,
})

describe('model picker models', () => {
  it('formats context windows across every unit shape', () => {
    expect(formatContextWindow(512)).toBe('512')
    expect(formatContextWindow(1024)).toBe('1k')
    expect(formatContextWindow(1536)).toBe('1.5k')
    expect(formatContextWindow(12 * 1024)).toBe('12k')
    expect(formatContextWindow(1024 ** 3)).toBe('1g')
  })

  it('projects grouped rows, current metadata, warnings, and plain actions', () => {
    const model = modelPickerPanelModel([
      item({ current: true, contextWindow: 65536 }),
      item({ provider: 'other', providerLabel: 'Other', id: 'plain', name: 'Plain' }),
    ], { title: 'Choose', warning: 'fresh cache' })
    expect(model).toMatchObject({
      title: 'Choose',
      header: { text: '?  fresh cache?' },
      view: { kind: 'list', selectedId: 'mock\u0000chat', filterable: true, grouped: true },
    })
    if (model.view?.kind !== 'list') throw new Error('expected list')
    expect(model.view.items[0]).toMatchObject({
      detail: '· ctx 64k · ← current',
      action: { kind: 'model.select', provider: 'mock', model: 'chat', persist: true },
      secondaryAction: { kind: 'model.select', persist: false },
    })
  })

  it('seeds model effort variants from live, default, then first metadata', () => {
    const live = modelPickerPanelModel([item({ current: true, efforts: ['low', 'high'], defaultEffort: 'high' })], { currentEffort: 'low' })
    const fallback = modelPickerPanelModel([item({ efforts: ['low', 'high'], defaultEffort: 'missing' })])
    if (live.view?.kind !== 'list' || fallback.view?.kind !== 'list') throw new Error('expected lists')
    expect(live.view.items[0]).toMatchObject({ selectedVariantId: 'low' })
    expect(live.view.items[0]?.variants?.[1]).toMatchObject({
      id: 'high', label: 'High', action: { effort: 'high', persist: true }, secondaryAction: { persist: false },
    })
    expect(fallback.view.items[0]).toMatchObject({ selectedVariantId: 'low' })
    expect(modelPickerPanelModel([])).toMatchObject({ title: 'Select a model', view: { items: [] } })
    expect(effortLabel('')).toBe('')
  })

  it('projects default and explicit effort actions', () => {
    const model = effortPickerPanelModel([
      { id: 'default', label: 'Default' },
      { id: 'high', label: 'High' },
    ], 'high')
    if (model.view?.kind !== 'list') throw new Error('expected list')
    expect(model.view.items[0]).toMatchObject({ selectedVariantId: 'high' })
    expect(model.view.items[0]?.variants?.[0]).toMatchObject({ action: { kind: 'effort.select', persist: true } })
    expect(model.view.items[0]?.variants?.[0]?.action).not.toHaveProperty('effort')
    expect(model.view.items[0]?.variants?.[1]).toMatchObject({
      action: { kind: 'effort.select', effort: 'high', persist: true },
      secondaryAction: { kind: 'effort.select', effort: 'high', persist: false },
    })
    const unset = effortPickerPanelModel([{ id: 'default', label: 'Default' }], undefined)
    if (unset.view?.kind !== 'list') throw new Error('expected list')
    expect(unset.view.items[0]).not.toHaveProperty('selectedVariantId')
  })
})
