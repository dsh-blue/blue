/**
 * Stateful session-header lineage projection for the `/sessions` picker.
 * The current session's ancestor chain is revealed without flooding the
 * panel with sibling branches; every other branch starts collapsed and can
 * be disclosed with Space. Search may request the complete tree without
 * changing that disclosure state.
 *
 * @module @dsh-blue/blue-interaction/session-tree
 */

import type { SessionHeader } from '@deepseek-ai/dsh-session'

/** One flattened tree row suitable for the shared single-select panel. */
export interface SessionTreeRow {
  /** The persisted session id selected by Enter. */
  readonly value: string
  /** Indented branch/disclosure glyphs plus the human-facing title or id. */
  readonly label: string
  /** Date/id detail shown after the label. */
  readonly description?: string
  /** Search text containing hidden metadata as well as the visible label. */
  readonly filterText: string
  /** Whether this row is the active session. */
  readonly current?: boolean
}

/** Interactive projection consumed by the sessions picker. */
export interface SessionTreeProjection {
  /**
   * Flatten the currently disclosed rows.
   * @param revealAll - show every node for global search without mutating disclosure state.
   * @returns rows in display order.
   */
  rows(revealAll?: boolean): readonly SessionTreeRow[]
  /**
   * Toggle one branch between fully expanded and collapsed.
   * @param id - focused session id.
   */
  toggle(id: string): void
}

/** Disclosure marker for a fully expanded branch. */
const EXPANDED = '▾'
/** Disclosure marker for a branch whose current-lineage child alone is revealed. */
const LINEAGE = '▿'
/** Disclosure marker for a collapsed branch. */
const COLLAPSED = '▸'

/**
 * Build a deterministic, cycle-safe interactive lineage tree. Missing
 * parents, self-parenting, and cyclic components are promoted to roots.
 * Only the direct ancestor chain of the current session is initially
 * revealed; on those path nodes, sibling branches stay hidden until Space
 * explicitly expands the node.
 * @param headers - cwd-filtered session headers.
 * @param titles - optional persisted title snapshots keyed by session id.
 * @param currentId - the active session id.
 * @param formatDate - timestamp formatter supplied by the command layer.
 * @returns the stateful tree projection.
 */
export function createSessionTree(
  headers: readonly SessionHeader[],
  titles: ReadonlyMap<string, string>,
  currentId: string | undefined,
  formatDate: (createdAt: number) => string,
): SessionTreeProjection {
  const byId = new Map<string, SessionHeader>()
  for (const header of headers) byId.set(String(header.id), header)
  const children = new Map<string, SessionHeader[]>()
  const roots: SessionHeader[] = []
  for (const header of headers) {
    const id = String(header.id)
    const parent = header.parentSession === undefined ? undefined : String(header.parentSession)
    if (parent === undefined || !byId.has(parent) || parent === id) {
      roots.push(header)
      continue
    }
    const bucket = children.get(parent)
    if (bucket === undefined) children.set(parent, [header])
    else bucket.push(header)
  }
  const order = (a: SessionHeader, b: SessionHeader): number =>
    b.createdAt - a.createdAt || String(b.id).localeCompare(String(a.id))
  roots.sort(order)
  for (const bucket of children.values()) bucket.sort(order)
  const rooted = new Set<string>()
  const markRooted = (header: SessionHeader): void => {
    const id = String(header.id)
    rooted.add(id)
    for (const child of children.get(id) ?? []) markRooted(child)
  }
  for (const root of roots) markRooted(root)

  // parent -> child along the current lineage. A cycle invalidates the
  // whole automatic path; the root-promotion pass below still exposes it.
  const lineageChild = new Map<string, string>()
  const lineageSeen = new Set<string>()
  let cursor = currentId
  let cyclic = false
  while (cursor !== undefined) {
    if (lineageSeen.has(cursor)) {
      cyclic = true
      break
    }
    lineageSeen.add(cursor)
    const header = byId.get(cursor)
    const parent = header?.parentSession === undefined ? undefined : String(header.parentSession)
    if (parent === undefined || parent === cursor || !byId.has(parent)) break
    lineageChild.set(parent, cursor)
    cursor = parent
  }
  if (cyclic) lineageChild.clear()

  const expanded = new Set<string>()
  const collapsed = new Set<string>()

  /** Flatten against the current disclosure state. */
  const rows = (revealAll = false): readonly SessionTreeRow[] => {
    const result: SessionTreeRow[] = []
    const visited = new Set<string>()
    const visit = (header: SessionHeader, depth: number, branch: string): void => {
      const id = String(header.id)
      if (visited.has(id)) return
      visited.add(id)
      const descendants = children.get(id) ?? []
      const pathChild = collapsed.has(id) ? undefined : lineageChild.get(id)
      const fullyExpanded = revealAll || expanded.has(id)
      const shown = fullyExpanded
        ? descendants
        : pathChild === undefined
          ? []
          : descendants.filter(child => String(child.id) === pathChild)
      const marker = descendants.length === 0
        ? ' '
        : fullyExpanded
          ? EXPANDED
          : pathChild === undefined
            ? COLLAPSED
            : LINEAGE
      const title = titles.get(id)
      const date = formatDate(header.createdAt)
      const current = id === currentId
      const visible = title ?? id
      const prefix = depth === 0 ? '' : `${'  '.repeat(depth - 1)}${branch} `
      const bareRoot = depth === 0 && title === undefined
      result.push({
        value: id,
        label: `${prefix}${marker} ${bareRoot ? `${id} · ${date}` : visible}`,
        ...(bareRoot ? {} : { description: `${id} · ${date}` }),
        filterText: `${title ?? ''} ${id} ${date}`,
        ...(current ? { current: true } : {}),
      })
      shown.forEach((child, index) => {
        visit(child, depth + 1, index === shown.length - 1 ? '└─' : '├─')
      })
    }
    for (const root of roots) visit(root, 0, '')
    // A cycle can leave every node out of the root set. Promote each still
    // hidden component in stable order; visited prevents recursive loops.
    for (const header of [...headers].sort(order)) {
      if (!rooted.has(String(header.id))) visit(header, 0, '')
    }
    return result
  }

  return {
    rows,
    toggle: (id) => {
      if ((children.get(id)?.length ?? 0) === 0) return
      if (expanded.delete(id)) {
        collapsed.add(id)
        return
      }
      collapsed.delete(id)
      expanded.add(id)
    },
  }
}
