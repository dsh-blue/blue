/**
 * The `/skills` command (S29): the read-only `InfoPanel` over the settled
 * user-invocable skills — one source-layered section per origin (the
 * project roots fold into `Project`, the user roots into `User`, any other
 * source heads its section as delivered), each skill listing its name (with
 * a `user-only` marker when the model cannot invoke it), its description,
 * and its `whenToUse` guidance when present. The listing shares the
 * catalog with the `#` completion branch and the submit rewrite
 * (`./skills-catalog.ts`): the handler refreshes it first, so the panel and
 * the dropdown never disagree. This module injects nothing and resolves
 * every service through `ctx.get` (the `/theme` fiber-dispose trap, the
 * session-info family's discipline).
 *
 * @module @dsh-blue/blue-interaction/skills-command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import type { InfoRow, InfoSection } from './info-panel.ts'
import { InfoPanel } from './info-panel.ts'
import { displayServices } from './display-services.ts'
import { mountEditorReplacement } from './editor-instance.ts'
import { refresh, userInvocableSkills } from './skills-catalog.ts'

/**
 * The folded section order: the conventional layers first, then any other
 * source by first appearance in the settled (name-sorted) list.
 */
const SECTION_ORDER: readonly string[] = ['Project', 'User']

/**
 * The section heading for one skill source layer: the two project roots
 * (`project-dsh`, `project-agents`) fold into `Project` and the two user
 * roots (`user-dsh`, `user-agents`) into `User`; every other source
 * (`custom`, `runtime`, `bundled`, …) heads its section as delivered.
 * @param source - the summary's discovery source.
 * @returns the section heading.
 */
function sectionHeading(source: string): string {
  if (source === 'project-dsh' || source === 'project-agents') return 'Project'
  if (source === 'user-dsh' || source === 'user-agents') return 'User'
  return source
}

/**
 * Build the `/skills` panel's sections (pure, for the spec): the settled
 * skills grouped by folded source layer in section order, each skill as
 * its name row (carrying the `user-only` marker when the model cannot
 * invoke it) followed by its description and — when present — its
 * `whenToUse` guidance.
 * @param skills - the user-invocable summaries to list.
 * @returns the sections in display order.
 */
export function buildSkillsSections(skills: readonly SkillSummary[]): InfoSection[] {
  const byHeading = new Map<string, SkillSummary[]>()
  for (const skill of skills) {
    const heading = sectionHeading(skill.source)
    const bucket = byHeading.get(heading)
    if (bucket === undefined) byHeading.set(heading, [skill])
    else bucket.push(skill)
  }
  const rank = (heading: string): number => {
    const index = SECTION_ORDER.indexOf(heading)
    return index === -1 ? SECTION_ORDER.length : index
  }
  return [...byHeading.keys()]
    .sort((left, right) => rank(left) - rank(right))
    .map(heading => ({ heading, rows: byHeading.get(heading)!.flatMap(skillRows) }))
}

/** The rows of one skill: name (with the user-only marker), description, whenToUse. */
function skillRows(skill: SkillSummary): InfoRow[] {
  return [
    {
      label: skill.name,
      segments: skill.invocation.modelInvocable ? [] : [{ text: 'user-only', style: 'muted' }],
    },
    { label: '', segments: [{ text: skill.description, style: 'muted' }] },
    ...(skill.whenToUse !== undefined
      ? [{ label: '', segments: [{ text: skill.whenToUse, style: 'textMuted' as const }] }]
      : []),
  ]
}

/**
 * Register the `/skills` command on `ctx.commands`.
 * @param ctx - plugin context carrying the command registry.
 * @returns the registration disposer.
 */
export function registerSkillsCommand(ctx: Context): () => void {
  return ctx.commands.register({
    name: 'skills',
    description: 'List available skills (the # prompt invokes one)',
    handler: async (): Promise<CommandResult> => {
      if (ctx.blueCurrentAgent.current() === null) {
        return { kind: 'error', text: 'no active session' }
      }
      // Refresh before listing: the panel and the `#` dropdown share the
      // catalog, and a fresh filesystem edit should surface here.
      await refresh(ctx)
      const skills = userInvocableSkills(ctx)
      if (skills.length === 0) {
        return { kind: 'success', text: 'no skills' }
      }
      const display = displayServices(ctx)
      if (display === undefined) {
        return { kind: 'error', text: 'skills panel is unavailable: the Blue screen is not mounted' }
      }
      const restore = mountEditorReplacement(ctx, new InfoPanel({
        keymap: display.keymap,
        theme: display.theme,
        components: display.components,
        title: 'skills',
        sections: buildSkillsSections(skills),
        onClose: () => {
          restore()
        },
      }))
      return { kind: 'success' }
    },
  })
}
