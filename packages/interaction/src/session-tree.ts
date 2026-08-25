/**
 * Session-header lineage projection for the `/sessions` picker. This is a
 * renderer-only tree over dsh's existing parentSession metadata; it never
 * creates, mutates, or persists a Blue-specific index.
 *
 * @module @dsh-blue/blue-interaction/session-tree
 */

import type { SessionHeader } from '@deepseek-ai/dsh-session'

/** One flattened tree row suitable for the shared single-select panel. */
export interface SessionTreeRow {
  /** The persisted session id selected by Enter. */
  readonly value: string
  /** Indented branch glyph plus the human-facing title or id. */
  readonly label: string
  /** Date/id detail shown after the label. */
  readonly description?: string
  /** Search text containing hidden metadata as well as the visible label. */
  readonly filterText: string
  /** Whether this row is the active session. */
  readonly current?: boolean
}

/**
 * Flatten session headers into a deterministic, cycle-safe lineage tree.
 * Missing parents and cyclic components are promoted to roots so a malformed
 * persistence result remains navigable rather than causing recursive UI work.
 * @param headers - cwd-filtered session headers.
 * @param titles - optional persisted title snapshots keyed by session id.
 * @param currentId - the active session id.
 * @param formatDate - timestamp formatter supplied by the command layer.
 * @returns rows in display order.
 */
export function flattenSessionTree(
  headers: readonly SessionHeader[],
  titles: ReadonlyMap<string, string>,
  currentId: string | undefined,
  formatDate: (createdAt: number) => string,
): readonly SessionTreeRow[] {
  const byId = new Map<string, SessionHeader>()
  for (const header of headers) byId.set(String(header.id), header)
  const children = new Map<string, SessionHeader[]>()
  const roots: SessionHeader[] = []
  for (const header of headers) {
    const parent = header.parentSession === undefined ? undefined : String(header.parentSession)
    if (parent === undefined || !byId.has(parent) || parent === String(header.id)) {
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

  const rows: SessionTreeRow[] = []
  const visited = new Set<string>()
  const visit = (header: SessionHeader, depth: number, branch: string): void => {
    const id = String(header.id)
    if (visited.has(id)) return
    visited.add(id)
    const title = titles.get(id)
    const date = formatDate(header.createdAt)
    const current = id === currentId
    const visible = title ?? id
    const prefix = depth === 0 ? '' : `${'  '.repeat(depth - 1)}${branch} `
    rows.push({
      value: id,
      label: depth === 0 && title === undefined ? `${prefix}${id} · ${date}` : `${prefix}${visible}`,
      ...(depth === 0 && title === undefined ? {} : { description: `${id} · ${date}` }),
      filterText: `${title ?? ''} ${id} ${date}`,
      ...(current ? { current: true } : {}),
    })
    const descendants = children.get(id) ?? []
    descendants.forEach((child, index) => {
      visit(child, depth + 1, index === descendants.length - 1 ? '└─' : '├─')
    })
  }
  for (const root of roots) visit(root, 0, '')
  // A cycle can leave every node out of the root set. Promote any remaining
  // node in stable order; visited still prevents a cyclic component looping.
  for (const header of [...headers].sort(order)) visit(header, 0, '')
  return rows
}
