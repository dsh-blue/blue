/**
 * Renderer-neutral model and effort picker projections. Catalog metadata is
 * converted to generic list rows, variants, and structured actions; terminal
 * focus, filtering, grouping, width, and keys stay in the document controller.
 *
 * @module @dsh-blue/blue-interaction/model-picker-model
 */

import type { Action } from '@dsh-blue/blue-frontend'
import type { FrontendPanelDocument, FrontendPanelVariant } from './frontend-panel.ts'

/** One selectable model catalog row. */
export interface ModelPickerItem {
  readonly provider: string
  readonly providerLabel: string
  readonly id: string
  readonly name: string
  readonly contextWindow?: number | undefined
  readonly efforts?: readonly string[] | undefined
  readonly defaultEffort?: string | undefined
  readonly current?: boolean | undefined
}

/** One renderer-neutral effort choice. */
export interface EffortPickerItem {
  readonly id: string
  readonly label: string
}

/** Format a token count as a compact 1024-base context size. */
export function formatContextWindow(tokens: number): string {
  if (tokens < 1024) return `${tokens}`
  const units = ['k', 'm', 'g']
  let value = tokens
  let unit = -1
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const text = Number.isInteger(value) || value >= 10 ? `${Math.round(value)}` : value.toFixed(1)
  return `${text}${units[unit]}`
}

function pickerAction(item: ModelPickerItem, effort: string | undefined, persist: boolean): Action {
  return {
    kind: 'model.select',
    provider: item.provider,
    model: item.id,
    persist,
    ...(effort === undefined ? {} : { effort }),
  }
}

function effortAction(effort: string | undefined, persist: boolean): Action {
  return { kind: 'effort.select', persist, ...(effort === undefined ? {} : { effort }) }
}

function effortLabel(id: string): string {
  return id.length === 0 ? id : id[0]!.toUpperCase() + id.slice(1)
}

function variants(item: ModelPickerItem, currentEffort: string | undefined): { rows: readonly FrontendPanelVariant[], selected?: string } {
  const efforts = item.efforts ?? []
  if (efforts.length === 0) return { rows: [] }
  const preferred = item.current === true && currentEffort !== undefined && efforts.includes(currentEffort)
    ? currentEffort
    : item.defaultEffort !== undefined && efforts.includes(item.defaultEffort)
      ? item.defaultEffort
      : efforts[0]!
  return {
    rows: efforts.map(effort => ({
      id: effort,
      label: effortLabel(effort),
      action: pickerAction(item, effort, true),
      secondaryAction: pickerAction(item, effort, false),
    })),
    selected: preferred,
  }
}

/** Build the generic grouped/filterable model catalog panel. */
export function modelPickerPanelModel(
  items: readonly ModelPickerItem[],
  options: { readonly currentEffort?: string | undefined; readonly warning?: string | undefined; readonly title?: string | undefined } = {},
): FrontendPanelDocument {
  const rows = items.map(item => {
    const effort = variants(item, options.currentEffort)
    const details = [
      item.contextWindow === undefined ? undefined : `· ctx ${formatContextWindow(item.contextWindow)}`,
      item.current === true ? '← current' : undefined,
    ].filter((value): value is string => value !== undefined)
    return {
      id: `${item.provider}\u0000${item.id}`,
      label: `${item.providerLabel}/${item.name}`,
      group: item.providerLabel,
      ...(details.length === 0 ? {} : { detail: details.join(' · ') }),
      ...(effort.rows.length === 0
        ? { action: pickerAction(item, undefined, true), secondaryAction: pickerAction(item, undefined, false) }
        : { variants: effort.rows, selectedVariantId: effort.selected! }),
    }
  })
  const current = rows.find((_row, index) => items[index]?.current === true)
  return {
    mode: 'select',
    title: options.title ?? 'Select a model',
    ...(options.warning === undefined ? {} : { header: { kind: 'text', content: `?  ${options.warning}?`, tone: 'warning' } as const }),
    items: rows,
    filterable: true,
    grouped: true,
    ...(current === undefined ? {} : { selectedId: current.id }),
  }
}

/** Build the generic single-row effort-variant panel. */
export function effortPickerPanelModel(
  efforts: readonly EffortPickerItem[],
  activeId: string | undefined,
): FrontendPanelDocument {
  return {
    mode: 'select',
    title: 'Thinking effort',
    selectedId: 'effort', items: [{
      id: 'effort',
      label: 'Thinking effort',
      variants: efforts.map(effort => ({
        ...effort,
        action: effortAction(effort.id === 'default' ? undefined : effort.id, true),
        secondaryAction: effortAction(effort.id === 'default' ? undefined : effort.id, false),
      })),
      ...(activeId === undefined ? {} : { selectedVariantId: activeId }),
    }],
  }
}

export { effortLabel }
