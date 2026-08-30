/**
 * Core-private arbitration for optional terminal surfaces. The public pane
 * registry owns declaration validation; this module receives already compiled
 * components and turns them into deterministic lane decisions.
 */

import type { BlueComponent, BlueFocusable } from './types.ts'
import { sliceByColumn, visibleWidth } from './width.ts'

export type SurfacePlacement = 'header' | 'left' | 'right' | 'bottom'
export type SurfaceNarrowPolicy = 'bottom' | 'overlay' | 'hidden'

export interface SurfaceContribution {
  readonly id: string
  readonly title?: string
  readonly placement: SurfacePlacement
  readonly priority?: number
  readonly size?: {
    readonly min?: number
    readonly preferred?: number | 'auto'
    readonly max?: number
  }
  readonly narrow?: SurfaceNarrowPolicy
  readonly component: BlueComponent
  readonly focusTarget?: BlueFocusable | null
}

export interface SurfaceUserLayoutState {
  readonly hiddenIds: readonly string[]
  readonly order: readonly string[]
  readonly active: Readonly<Partial<Record<SurfacePlacement, string>>>
  readonly placements: Readonly<Record<string, SurfacePlacement>>
  readonly pinnedIds: readonly string[]
  readonly sizes: Readonly<Record<string, number>>
}

export type SurfaceUserLayoutInput = Partial<SurfaceUserLayoutState>

export interface SurfaceLaneEntry extends SurfaceContribution {
  readonly placement: SurfacePlacement
  readonly priority: number
  readonly pinned: boolean
}

export interface SurfaceLaneLayout {
  readonly placement: SurfacePlacement
  readonly entries: readonly SurfaceLaneEntry[]
  readonly active: SurfaceLaneEntry
  readonly width?: number
}

export interface SurfaceOverflowEntry {
  readonly entry: SurfaceLaneEntry
  readonly reason: 'hidden' | 'overlay'
}

export interface SurfaceLayout {
  readonly columns: number
  readonly rows: number
  readonly transcriptColumns: number
  readonly header?: SurfaceLaneLayout
  readonly left?: SurfaceLaneLayout
  readonly right?: SurfaceLaneLayout
  readonly bottom?: SurfaceLaneLayout
  readonly overflow: readonly SurfaceOverflowEntry[]
}

export interface SurfaceRegistration {
  readonly disposed: boolean
  setHidden(hidden: boolean): void
  replace(component: BlueComponent, focusTarget?: BlueFocusable | null): void
  dispose(): void
}

export interface SurfaceManagerOptions {
  readonly userState?: SurfaceUserLayoutInput
  readonly onChange?: () => void
  readonly onUserStateChange?: (state: SurfaceUserLayoutState) => void
  readonly onSurfaceFocusTransition?: (previous: BlueFocusable, next: BlueFocusable | null) => void
}

export const SURFACE_TRANSCRIPT_MIN_COLUMNS = 40
export const SURFACE_TRANSCRIPT_REOPEN_COLUMNS = 44
export const SURFACE_SIDE_MIN_COLUMNS = 20
export const SURFACE_SIDE_PREFERRED_COLUMNS = 32
export const SURFACE_SIDE_MAX_COLUMNS = 48
export const SURFACE_HEADER_MAX_ROWS = 4

const PLACEMENTS: readonly SurfacePlacement[] = ['header', 'left', 'right', 'bottom']

interface RegisteredSurface {
  contribution: SurfaceContribution
  hidden: boolean
}

function finiteInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.floor(value)
}

function compareId(left: string, right: string): number {
  /* v8 ignore next -- registered ids are unique, so sort never compares equal ids */
  return left < right ? -1 : left > right ? 1 : 0
}

function freezeUserState(input: SurfaceUserLayoutInput = {}): SurfaceUserLayoutState {
  const active = Object.freeze({ ...input.active })
  const placements = Object.freeze({ ...input.placements })
  const sizes = Object.freeze({ ...input.sizes })
  return Object.freeze({
    hiddenIds: Object.freeze([...(input.hiddenIds ?? [])]),
    order: Object.freeze([...(input.order ?? [])]),
    active,
    placements,
    pinnedIds: Object.freeze([...(input.pinnedIds ?? [])]),
    sizes,
  })
}

function safeDimension(value: number): number {
  return Math.max(1, Number.isFinite(value) ? Math.floor(value) : 1)
}

function fit(value: string, width: number): string {
  const available = safeDimension(width)
  return visibleWidth(value) <= available ? value : sliceByColumn(value, 0, available, true)
}

function contributionFocusTarget(contribution: SurfaceContribution): BlueFocusable | null {
  if (contribution.focusTarget !== undefined) return contribution.focusTarget
  return typeof (contribution.component as BlueComponent & { focused?: unknown }).focused === 'boolean'
    ? contribution.component as BlueFocusable
    : null
}

/** ANSI-aware Blue-owned lane tab chrome with deterministic overflow. */
export function renderSurfaceTabs(lane: SurfaceLaneLayout, width: number): string {
  const available = safeDimension(width)
  const tokens = lane.entries.map(entry => ({
    id: entry.id,
    value: entry.id === lane.active.id ? `[${entry.title ?? entry.id}]` : (entry.title ?? entry.id),
  }))
  const complete = tokens.map(token => token.value).join(' ')
  if (visibleWidth(complete) <= available) return complete

  const activeIndex = tokens.findIndex(token => token.id === lane.active.id)
  const kept = new Set<number>([activeIndex])
  for (let index = 0; index < tokens.length; index += 1) {
    if (kept.has(index)) continue
    const trial = [...kept, index].sort((left, right) => left - right).map(item => tokens[item]!.value)
    const hidden = tokens.length - trial.length
    /* v8 ignore next -- the full set was already proven too wide above */
    if (visibleWidth(`${trial.join(' ')}${hidden === 0 ? '' : ` +${String(hidden)}`}`) <= available) kept.add(index)
  }
  const ordered = [...kept].sort((left, right) => left - right).map(index => tokens[index]!.value)
  const hidden = tokens.length - ordered.length
  const suffix = ` +${String(hidden)}`
  const labelWidth = Math.max(1, available - visibleWidth(suffix))
  return fit(`${fit(ordered.join(' '), labelWidth)}${suffix}`, available)
}

/** Render one active lane contribution and clamp hostile component output. */
export function renderSurfaceLane(lane: SurfaceLaneLayout | undefined, width: number, maxRows = Number.MAX_SAFE_INTEGER): string[] {
  if (lane === undefined) return []
  const available = safeDimension(width)
  const tabs = lane.entries.length > 1 ? [renderSurfaceTabs(lane, available)] : []
  const body = lane.active.component.render(available).map(row => fit(row, available))
  return [...tabs, ...body].slice(0, Math.max(0, finiteInteger(maxRows, 0)))
}

/** In-memory manager; persistence adapters consume and replace its frozen user state. */
export class SurfaceManager {
  private readonly entries = new Map<string, RegisteredSurface>()
  private readonly collapsed: Record<'left' | 'right', boolean> = { left: false, right: false }
  private userStateValue: SurfaceUserLayoutState
  private focusedIdValue: string | undefined
  private activeIdValue: string | undefined

  constructor(private readonly options: SurfaceManagerOptions = {}) {
    this.userStateValue = freezeUserState(options.userState)
  }

  get userState(): SurfaceUserLayoutState {
    return this.userStateValue
  }

  get empty(): boolean {
    return this.visibleEntries().length === 0
  }

  get focusedId(): string | undefined {
    return this.focusedIdValue
  }

  invalidate(): void {
    for (const registered of this.entries.values()) registered.contribution.component.invalidate()
  }

  register(contribution: SurfaceContribution): SurfaceRegistration {
    if (this.entries.has(contribution.id)) throw new Error(`Duplicate surface id: ${contribution.id}`)
    const registered: RegisteredSurface = { contribution, hidden: false }
    this.entries.set(contribution.id, registered)
    this.options.onChange?.()
    let disposed = false
    return {
      get disposed() {
        return disposed
      },
      setHidden: hidden => {
        if (disposed || registered.hidden === hidden) return
        registered.hidden = hidden
        if (hidden && this.focusedIdValue === contribution.id) {
          this.focusedIdValue = undefined
          const previous = contributionFocusTarget(registered.contribution)
          if (previous !== null) this.options.onSurfaceFocusTransition?.(previous, null)
        }
        if (hidden && this.activeIdValue === contribution.id) this.activeIdValue = undefined
        this.options.onChange?.()
      },
      replace: (component, focusTarget) => {
        if (disposed || registered.contribution.component === component) return
        const previous = contributionFocusTarget(registered.contribution)
        const identity = previous?.captureFocusIdentity?.()
        const { focusTarget: _previousTarget, ...metadata } = registered.contribution
        registered.contribution = focusTarget === undefined
          ? { ...metadata, component }
          : { ...metadata, component, focusTarget }
        const next = contributionFocusTarget(registered.contribution)
        if (identity !== undefined) next?.restoreFocusIdentity?.(identity)
        this.options.onChange?.()
        if (this.focusedIdValue === contribution.id) {
          if (next === null) this.focusedIdValue = undefined
          if (previous !== null) this.options.onSurfaceFocusTransition?.(previous, next)
        }
      },
      dispose: () => {
        if (disposed) return
        disposed = true
        const placement = this.effectivePlacement(registered.contribution)
        const activePlacements = PLACEMENTS.filter(item => this.userStateValue.active[item] === contribution.id)
        const wasFocused = this.focusedIdValue === contribution.id
        const previousFocus = wasFocused ? contributionFocusTarget(registered.contribution) : null
        this.entries.delete(contribution.id)
        if (this.activeIdValue === contribution.id) this.activeIdValue = undefined
        if (placement === 'left' || placement === 'right') this.collapsed[placement] = false
        let focusSuccessor: SurfaceLaneEntry | undefined
        if (activePlacements.length > 0) {
          const active = { ...this.userStateValue.active }
          for (const item of activePlacements) {
            const successor = this.activationCandidates(item)[0]
            focusSuccessor ??= successor
            if (successor === undefined) delete active[item]
            else active[item] = successor.id
          }
          this.setUserState({ ...this.userStateValue, active })
        } else {
          focusSuccessor = this.activationCandidates(placement)[0]
          this.options.onChange?.()
        }
        if (wasFocused) {
          const nextFocus = focusSuccessor === undefined ? null : contributionFocusTarget(focusSuccessor)
          this.focusedIdValue = nextFocus === null ? undefined : focusSuccessor?.id
          if (previousFocus !== null) this.options.onSurfaceFocusTransition?.(previousFocus, nextFocus)
        }
      },
    }
  }

  replaceUserState(state: SurfaceUserLayoutInput): void {
    const focusedContribution = this.focusedIdValue === undefined ? undefined : this.entries.get(this.focusedIdValue)?.contribution
    const focused = focusedContribution === undefined ? null : contributionFocusTarget(focusedContribution)
    this.userStateValue = freezeUserState(state)
    this.collapsed.left = false
    this.collapsed.right = false
    this.focusedIdValue = undefined
    this.activeIdValue = undefined
    if (focused !== null) this.options.onSurfaceFocusTransition?.(focused, null)
    this.options.onChange?.()
  }

  activate(placement: SurfacePlacement, id: string): boolean {
    const lane = this.activationCandidates(placement)
    if (!lane.some(entry => entry.id === id)) return false
    const previous = this.lane(placement, lane)?.active
    const next = lane.find(entry => entry.id === id)!
    this.activeIdValue = id
    const active = { ...this.userStateValue.active, [placement]: id }
    if (placement === 'bottom' && next.placement !== 'bottom') active[next.placement] = id
    this.setUserState({
      ...this.userStateValue,
      active,
    })
    if (previous !== undefined && previous.id !== next.id && this.focusedIdValue === previous.id) {
      const previousFocus = contributionFocusTarget(previous)
      const nextFocus = contributionFocusTarget(next)
      this.focusedIdValue = nextFocus === null ? undefined : next.id
      if (previousFocus !== null) this.options.onSurfaceFocusTransition?.(previousFocus, nextFocus)
    }
    return true
  }

  setFocused(id: string | undefined): boolean {
    if (id !== undefined && !this.visibleEntries().some(entry => entry.id === id)) return false
    if (this.focusedIdValue === id) return true
    this.focusedIdValue = id
    this.options.onChange?.()
    return true
  }

  setFocusedComponent(component: BlueComponent | null): void {
    const entry = component === null
      ? undefined
      : this.visibleEntries().find(item => contributionFocusTarget(item) === component)
    this.setFocused(entry?.id)
  }

  linearLayout(columns: number, rows: number): SurfaceLayout {
    const grouped = this.groupedEntries()
    const sides = (['left', 'right'] as const).flatMap(placement => {
      const lane = this.lane(placement, grouped[placement])
      return lane === undefined ? [] : [{ placement, lane, width: this.sideWidth(lane.active) }]
    })
    return this.finishLayout(safeDimension(columns), safeDimension(rows), grouped, sides, [])
  }

  layout(columns: number, rows: number): SurfaceLayout {
    const safeColumns = safeDimension(columns)
    const safeRows = safeDimension(rows)
    const grouped = this.groupedEntries()
    const sideLanes = (['left', 'right'] as const).flatMap(placement => {
      const lane = this.lane(placement, grouped[placement])
      return lane === undefined ? [] : [{ placement, lane, width: this.sideWidth(lane.active) }]
    })
    for (const placement of ['left', 'right'] as const) {
      if (grouped[placement].length === 0) this.collapsed[placement] = false
    }

    const retained = sideLanes.filter(side => !this.collapsed[side.placement])
    const collapsed = sideLanes.filter(side => this.collapsed[side.placement])
    collapsed.sort((left, right) => this.compareSideStrength(right.lane, left.lane))
    for (const side of collapsed) {
      const trial = [...retained, side]
      if (this.transcriptWidth(safeColumns, trial) >= SURFACE_TRANSCRIPT_REOPEN_COLUMNS) {
        this.collapsed[side.placement] = false
        retained.push(side)
      }
    }
    const strongestCollapsed = collapsed.find(side => this.collapsed[side.placement])
    const weakestRetained = [...retained]
      .sort((left, right) => this.compareSideStrength(left.lane, right.lane))
      .at(0)
    if (
      strongestCollapsed !== undefined
      && weakestRetained !== undefined
      && this.compareSideStrength(strongestCollapsed.lane, weakestRetained.lane) > 0
    ) {
      const replacementTranscriptWidth = this.transcriptWidth(safeColumns, retained)
        + weakestRetained.width - strongestCollapsed.width
      if (replacementTranscriptWidth >= SURFACE_TRANSCRIPT_MIN_COLUMNS) {
        this.collapsed[weakestRetained.placement] = true
        this.collapsed[strongestCollapsed.placement] = false
        retained.splice(retained.indexOf(weakestRetained), 1, strongestCollapsed)
      }
    }
    retained.sort((left, right) => left.placement.localeCompare(right.placement))
    while (retained.length > 0 && this.transcriptWidth(safeColumns, retained) < SURFACE_TRANSCRIPT_MIN_COLUMNS) {
      const weakest = [...retained].sort((left, right) => this.compareSideStrength(left.lane, right.lane)).at(0)!
      this.collapsed[weakest.placement] = true
      retained.splice(retained.indexOf(weakest), 1)
    }

    const fallback: SurfaceLaneEntry[] = []
    const overflow: SurfaceOverflowEntry[] = []
    for (const side of sideLanes) {
      if (!this.collapsed[side.placement]) continue
      for (const entry of side.lane.entries) {
        const narrow = entry.narrow ?? 'bottom'
        if (narrow === 'bottom') fallback.push(entry)
        else overflow.push({ entry, reason: narrow })
      }
    }
    const unavailableFocused = overflow.find(item => item.entry.id === this.focusedIdValue)
    if (unavailableFocused !== undefined) {
      this.focusedIdValue = undefined
      const previous = contributionFocusTarget(unavailableFocused.entry)
      if (previous !== null) this.options.onSurfaceFocusTransition?.(previous, null)
    }
    if (overflow.some(item => item.entry.id === this.activeIdValue)) this.activeIdValue = undefined
    const effectiveGroups = {
      ...grouped,
      left: retained.find(side => side.placement === 'left')?.lane.entries ?? [],
      right: retained.find(side => side.placement === 'right')?.lane.entries ?? [],
      bottom: this.sortEntries([...grouped.bottom, ...fallback]),
    }
    return this.finishLayout(safeColumns, safeRows, effectiveGroups, retained, overflow)
  }

  private setUserState(state: SurfaceUserLayoutInput): void {
    this.userStateValue = freezeUserState(state)
    this.options.onUserStateChange?.(this.userStateValue)
    this.options.onChange?.()
  }

  private activationCandidates(placement: SurfacePlacement): SurfaceLaneEntry[] {
    const grouped = this.groupedEntries()
    return placement === 'bottom'
      ? this.sortEntries([...grouped.bottom, ...grouped.left, ...grouped.right]
          .filter(entry => entry.placement === 'bottom' || (entry.narrow ?? 'bottom') === 'bottom'))
      : grouped[placement]
  }

  private visibleEntries(): SurfaceLaneEntry[] {
    const hidden = new Set(this.userStateValue.hiddenIds)
    const pinned = new Set(this.userStateValue.pinnedIds)
    return [...this.entries.values()].flatMap(registered => {
      if (registered.hidden || hidden.has(registered.contribution.id)) return []
      const placement = this.effectivePlacement(registered.contribution)
      return [{
        ...registered.contribution,
        placement,
        priority: finiteInteger(registered.contribution.priority, 0),
        pinned: pinned.has(registered.contribution.id),
      }]
    })
  }

  private effectivePlacement(contribution: SurfaceContribution): SurfacePlacement {
    return this.userStateValue.placements[contribution.id] ?? contribution.placement
  }

  private groupedEntries(): Record<SurfacePlacement, SurfaceLaneEntry[]> {
    const grouped: Record<SurfacePlacement, SurfaceLaneEntry[]> = { header: [], left: [], right: [], bottom: [] }
    for (const entry of this.visibleEntries()) grouped[entry.placement].push(entry)
    for (const placement of PLACEMENTS) grouped[placement] = this.sortEntries(grouped[placement])
    return grouped
  }

  private sortEntries(entries: readonly SurfaceLaneEntry[]): SurfaceLaneEntry[] {
    const order = new Map(this.userStateValue.order.map((id, index) => [id, index]))
    return [...entries].sort((left, right) => {
      const leftOrder = order.get(left.id)
      const rightOrder = order.get(right.id)
      if (leftOrder !== undefined || rightOrder !== undefined) {
        if (leftOrder === undefined) return 1
        if (rightOrder === undefined) return -1
        /* v8 ignore next -- one id has one index in the user order map */
        if (leftOrder !== rightOrder) return leftOrder - rightOrder
      }
      return Number(right.pinned) - Number(left.pinned)
        || right.priority - left.priority
        || compareId(left.id, right.id)
    })
  }

  private lane(placement: SurfacePlacement, entries: readonly SurfaceLaneEntry[]): SurfaceLaneLayout | undefined {
    if (entries.length === 0) return undefined
    const requested = placement === 'bottom'
      ? [
          this.focusedIdValue,
          this.activeIdValue,
          this.userStateValue.active.bottom,
          this.userStateValue.active.left,
          this.userStateValue.active.right,
        ]
      : [this.userStateValue.active[placement]]
    const active = requested.flatMap(id => entries.find(entry => entry.id === id) ?? []).at(0) ?? entries[0]!
    return { placement, entries, active }
  }

  private sideWidth(entry: SurfaceLaneEntry): number {
    const minimum = Math.max(SURFACE_SIDE_MIN_COLUMNS, Math.min(SURFACE_SIDE_MAX_COLUMNS, finiteInteger(entry.size?.min, SURFACE_SIDE_MIN_COLUMNS)))
    const maximum = Math.max(minimum, Math.min(SURFACE_SIDE_MAX_COLUMNS, finiteInteger(entry.size?.max, SURFACE_SIDE_MAX_COLUMNS)))
    const preferred = entry.size?.preferred === 'auto'
      ? SURFACE_SIDE_PREFERRED_COLUMNS
      : finiteInteger(entry.size?.preferred, SURFACE_SIDE_PREFERRED_COLUMNS)
    const user = finiteInteger(this.userStateValue.sizes[entry.id], preferred)
    return Math.max(minimum, Math.min(maximum, user))
  }

  private compareSideStrength(left: SurfaceLaneLayout, right: SurfaceLaneLayout): number {
    const leftPinned = left.entries.some(entry => entry.pinned)
    const rightPinned = right.entries.some(entry => entry.pinned)
    const leftFocused = left.entries.some(entry => entry.id === this.focusedIdValue)
    const rightFocused = right.entries.some(entry => entry.id === this.focusedIdValue)
    const leftActive = left.entries.some(entry => entry.id === this.activeIdValue)
    const rightActive = right.entries.some(entry => entry.id === this.activeIdValue)
    const order = new Map(this.userStateValue.order.map((id, index) => [id, index]))
    const leftOrder = left.entries.reduce<number | undefined>((best, entry) => {
      const index = order.get(entry.id)
      return index === undefined ? best : best === undefined ? index : Math.min(best, index)
    }, undefined)
    const rightOrder = right.entries.reduce<number | undefined>((best, entry) => {
      const index = order.get(entry.id)
      return index === undefined ? best : best === undefined ? index : Math.min(best, index)
    }, undefined)
    return Number(leftPinned) - Number(rightPinned)
      || (leftOrder === undefined && rightOrder === undefined
        ? 0
        : leftOrder === undefined
          ? -1
          : rightOrder === undefined
            ? 1
            : rightOrder - leftOrder)
      || Number(leftFocused) - Number(rightFocused)
      || Number(leftActive) - Number(rightActive)
      || left.active.priority - right.active.priority
      || -compareId(left.active.id, right.active.id)
  }

  private transcriptWidth(columns: number, sides: readonly { readonly width: number }[]): number {
    return Math.max(1, columns - sides.reduce((total, side) => total + side.width, 0) - sides.length)
  }

  private finishLayout(
    columns: number,
    rows: number,
    grouped: Record<SurfacePlacement, readonly SurfaceLaneEntry[]>,
    sides: readonly { readonly placement: 'left' | 'right'; readonly lane: SurfaceLaneLayout; readonly width: number }[],
    overflow: readonly SurfaceOverflowEntry[],
  ): SurfaceLayout {
    const leftSide = sides.find(side => side.placement === 'left')
    const rightSide = sides.find(side => side.placement === 'right')
    const left = leftSide === undefined ? this.lane('left', grouped.left) : { ...leftSide.lane, width: leftSide.width }
    const right = rightSide === undefined ? this.lane('right', grouped.right) : { ...rightSide.lane, width: rightSide.width }
    const transcriptColumns = sides.length === 0 ? columns : this.transcriptWidth(columns, sides)
    return {
      columns,
      rows,
      transcriptColumns,
      ...(this.lane('header', grouped.header) === undefined ? {} : { header: this.lane('header', grouped.header)! }),
      ...(left === undefined ? {} : { left }),
      ...(right === undefined ? {} : { right }),
      ...(this.lane('bottom', grouped.bottom) === undefined ? {} : { bottom: this.lane('bottom', grouped.bottom)! }),
      overflow,
    }
  }
}
