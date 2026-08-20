# Skills

A skill is an **optional instruction pack**: a piece of Markdown with metadata telling the model "how to approach this kind of task". dsh injects a skills catalog (names + descriptions) at the session's first agent step, and the model loads full content itself through the `skill({ name })` tool when needed — skills are not events and never clutter the transcript.

## Discovery directories

In priority order (for same-named skills, the earlier rank wins):

| Rank | Source | Path |
| --- | --- | --- |
| 100 | project `.dsh` | `<projectRoot>/.dsh/skills` |
| 200 | project `.agents` | `<projectRoot>/.agents/skills` |
| 300 | custom | configured `customSkillDirs` |
| 400 | user dsh | `<dshHome>/skills` (default `~/.dsh/skills`) |
| 500 | user agents | `<agentsHome>/skills` (e.g. `~/.agents/skills`) |
| 600 | bundled | the configured `bundledSkillDir` (or the `DSH_BUNDLED_SKILL_DIR` env var) |

The project root is the **nearest ancestor containing `.git`** (falling back to the cwd); the `.system` subdirectory under the user dsh root is skipped; plugins may also contribute skills at runtime (after project entries, before user entries).

## File format

- names must be **kebab-case** (`^[a-z0-9]+(?:-[a-z0-9]+)*$`);
- two forms: a **directory pack** `<name>/SKILL.md`, or a **flat file** `<name>.md` (no nested `**/SKILL.md` discovery);
- frontmatter keys (kebab-case):

```yaml
---
disable-model-invocation: false   # forbid the model from invoking it itself (default false)
user-invocable: true              # appears in the user command catalog (default true)
---
```

The body is the instruction for the model; `description` (and the optional `whenToUse`) feed the catalog injected at session start — they are what makes the model remember the skill exists, so write the applicability clearly.

## Loading mechanism

1. The session's first agent step injects the **catalog reminder** (every skill's name + description, truncated past the default 500-character-per-entry cap);
2. the model calls `skill({ name })` on demand — invocation permissions are checked before and after loading (a skill with both switches false is reachable only by trusted code);
3. content returns to the model wrapped in `<skill_content>`; catalog changes publish a replacement reminder, and editing a skill file takes effect immediately (file watching is on by default).

## Advice for Blue users

- Project-specific workflows → `<projectRoot>/.dsh/skills/`, versioned with the repo;
- Personal general-purpose skills → `~/.dsh/skills/`, shared across every profile;
- `user-invocable` skills appear in the host's command catalog — pair them with the [slash commands](/en/reference/commands) completion experience.
