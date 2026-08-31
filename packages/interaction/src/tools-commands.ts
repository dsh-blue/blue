/**
 * The `/tools` command (S28): a two-step catalog browser. The first panel
 * is the shared single-select picker — one row per visible tool, the tool
 * name beside its first sentence — and Enter opens the detail panel
 * stacked above it: the full description (source lines, long ones
 * word-wrapped) and the JSON-Schema parameters, one row each. Escape walks
 * back one panel at a time (picker → editor), the danger-gate stacking
 * the permission picker already uses.
 *
 * The app action boundary resolves the current preset's standing scope and
 * returns only immutable visible schemas; Agent context and registry scope
 * keys never cross into interaction. The panels are display-only: managing
 * MCP servers is a profile-patch concern upstream.
 *
 * @module @dsh-blue/blue-interaction/tools-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { BlueSessionToolSchema } from '@dsh-blue/blue-app'
// Empty type imports carry the commands registration and app-owned session
// action services.
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@dsh-blue/blue-app'
import { displayServices } from './display-services.ts'
import { mountEditorReplacement } from './editor-instance.ts'
import { InfoPanel, type InfoSection } from './info-panel.ts'
import { CanonicalSelectController, type SelectRow } from './select-list.ts'

/** The public prefix of MCP-served tool names (`mcp__<server>__<raw>`). */
const MCP_PREFIX = 'mcp__'

/** Character budget the detail panel word-wraps description lines to. */
const DETAIL_WRAP = 64

/**
 * The one-line brief the picker shows: the description's first non-empty
 * line, cut after its first sentence-ending punctuation (the default the
 * row falls back to when a tool ships no hand-written brief).
 * @param description - the raw tool description.
 * @returns the brief, or `''` when the description has no text.
 */
export function firstSentence(description: string): string {
  const firstLine = description.split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0) ?? ''
  // Latin sentence ends need a following space (a bare `.` at line end is
  // the whole sentence); CJK ends cut at the punctuation itself, space or
  // not. Both matches sit one past their punctuation, so the index is the
  // cut either way.
  const cut = /(?<=[.!?])\s|(?<=[。！？])(?=.)/.exec(firstLine)
  return cut === null ? firstLine : firstLine.slice(0, cut.index)
}

/**
 * Split a text block into display lines: source lines, empty ones dropped,
 * lines past {@link DETAIL_WRAP} word-wrapped (the panel's width truncation
 * stays the backstop, never the primary cut).
 * @param text - the raw multi-line text.
 * @returns the display lines.
 */
export function wrapLines(text: string): string[] {
  const lines: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    if (line.length <= DETAIL_WRAP) {
      lines.push(line)
      continue
    }
    let current = ''
    for (const word of line.split(/\s+/)) {
      const next = current === '' ? word : `${current} ${word}`
      if (next.length > DETAIL_WRAP && current !== '') {
        lines.push(current)
        current = word
      } else {
        current = next
      }
    }
    // A nonempty source line always leaves a nonempty remainder.
    lines.push(current)
  }
  return lines
}

/**
 * Build the picker rows: one per tool, name-sorted, the tool's first
 * sentence as the muted tail.
 * @param schemas - the live per-scope tool enumeration.
 * @returns the panel rows, display order.
 */
export function buildToolPickerRows(schemas: readonly BlueSessionToolSchema[]): SelectRow[] {
  return [...schemas]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(schema => {
      const brief = firstSentence(schema.description)
      return { value: schema.name, label: schema.name, ...(brief === '' ? {} : { description: brief }) }
    })
}

/** The parameter facts a detail row renders; extracted defensively from a raw JSON Schema. */
interface ParameterFacts {
  readonly name: string
  readonly type: string
  readonly description: string
  readonly required: boolean
}

/**
 * Extract one tool's parameters from the raw JSON Schema, tolerating any
 * malformed shape (the registry whitelists nothing about `properties`).
 * @param parameters - the schema's `parameters` value.
 * @returns the parameter facts, property order; `undefined` when the
 *   schema declares no usable properties object.
 */
export function readParameters(parameters: Readonly<Record<string, unknown>> | undefined): ParameterFacts[] | undefined {
  if (parameters === undefined || typeof parameters !== 'object') return undefined
  const properties = parameters.properties
  if (properties === undefined || properties === null || typeof properties !== 'object') return undefined
  const required = new Set(Array.isArray(parameters.required)
    ? parameters.required.filter((name): name is string => typeof name === 'string')
    : [])
  const facts: ParameterFacts[] = []
  for (const [name, shape] of Object.entries(properties as Record<string, unknown>)) {
    if (shape === null || typeof shape !== 'object') continue
    const record = shape as Record<string, unknown>
    facts.push({
      name,
      type: typeof record.type === 'string' ? record.type : 'any',
      description: typeof record.description === 'string' ? firstSentence(record.description) : '',
      required: required.has(name),
    })
  }
  return facts.length === 0 ? undefined : facts
}

/**
 * Build the detail panel sections for one tool: the identity rows (name,
 * and the MCP server when the name carries one), the full description as
 * wrapped display lines, and one row per parameter (type muted, the
 * description beside it, `· required` marking the mandatory ones).
 * @param schema - the tool's schema.
 * @returns the panel sections, display order.
 */
export function buildToolDetailSections(schema: BlueSessionToolSchema): InfoSection[] {
  const sections: InfoSection[] = [{
    heading: 'Tool',
    rows: [
      { label: 'name', segments: [{ text: schema.name }] },
      ...schema.name.startsWith(MCP_PREFIX)
        ? [{ label: 'server', segments: [{ text: schema.name.slice(MCP_PREFIX.length).split('__')[0]! }] }]
        : [],
    ],
  }]
  const descriptionLines = wrapLines(schema.description)
  sections.push({
    heading: 'Description',
    rows: descriptionLines.length === 0
      ? [{ label: '', segments: [{ text: '(no description)', style: 'muted' as const }] }]
      : descriptionLines.map(line => ({ label: '', segments: [{ text: line }] })),
  })
  const parameters = readParameters(schema.parameters)
  sections.push({
    heading: parameters === undefined ? 'Parameters' : `Parameters (${parameters.length})`,
    rows: parameters === undefined
      ? [{ label: '', segments: [{ text: '(no parameters)', style: 'muted' as const }] }]
      : parameters.map(parameter => ({
        label: parameter.name,
        segments: [
          { text: parameter.type, style: 'muted' as const },
          ...(parameter.description === '' ? [] : [{ text: ` — ${parameter.description}` }]),
          ...(parameter.required ? [{ text: ' · required', style: 'warning' as const }] : []),
        ],
      })),
  })
  return sections
}

/** The empty-catalog panel sections: one muted line, nothing to select. */
function emptyCatalogSections(): InfoSection[] {
  return [{
    heading: 'tools',
    rows: [{ label: 'none', segments: [{ text: 'no tools visible to this session', style: 'muted' }] }],
  }]
}

/**
 * Register the `/tools` command: mount the catalog picker.
 * @param ctx - plugin context (`commands` via the calling plugin).
 * @returns the disposer removing the registration.
 */
export function registerToolsCommands(ctx: Context): () => void {
  const reader = ctx.blueSessionReader
  const actions = ctx.blueSessionActions
  // The fiber-unload flag: the standing-key await can span a tree unload.
  let unloaded = false
  ctx.effect(() => () => {
    unloaded = true
  })

  /**
   * The `/tools` handler: guards, resolve the view scope, enumerate, mount.
   * @returns the command outcome.
   */
  async function showTools(): Promise<CommandResult> {
    if (reader.current() === null) {
      return { kind: 'error', text: 'no session is live yet' }
    }
    const catalog = await actions.toolCatalog()
    if (!catalog.ok) return { kind: 'error', text: catalog.message }
    if (unloaded) return { kind: 'success' }
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: 'tools panel is unavailable: the Blue screen is not mounted' }
    }
    const schemas = catalog.value.visible
    if (schemas.length === 0) {
      // Nothing to select: the read-only empty panel stays the honest view.
      const restoreEmpty = mountEditorReplacement(ctx, new InfoPanel({
        keymap: display.keymap,
        theme: display.theme,
        components: display.components,
        title: 'tools',
        sections: emptyCatalogSections(),
        onClose: () => {
          restoreEmpty()
        },
      }))
      return { kind: 'success' }
    }
    const byName = new Map(schemas.map(schema => [schema.name, schema]))
    // The picker stays mounted under the detail panel: closing the detail
    // pops the stack back onto the picker instead of rebuilding it.
    const openDetail = (schema: BlueSessionToolSchema): void => {
      const restoreDetail = mountEditorReplacement(ctx, new InfoPanel({
        keymap: display.keymap,
        theme: display.theme,
        components: display.components,
        title: schema.name,
        sections: buildToolDetailSections(schema),
        onClose: () => {
          restoreDetail()
        },
      }))
    }
    const restorePicker = mountEditorReplacement(ctx, new CanonicalSelectController({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      rows: buildToolPickerRows(schemas),
      title: 'Tools',
      onSelect: row => {
        openDetail(byName.get(row.value)!)
      },
      onCancel: () => {
        restorePicker()
      },
    }))
    return { kind: 'success' }
  }

  const tools = ctx.commands.register({
    name: 'tools',
    description: 'List the tools visible to the current session',
    handler: () => showTools(),
  })
  return () => {
    tools()
  }
}
