# System prompt

Before every model step, dsh **assembles the system prompt** sent to the model from parts contributed by plugins. This page covers what it is made of, how it loads, and how to customize it.

## Composition: four kinds of registered contributions

| Contribution | Description |
| --- | --- |
| **PromptSection** | a named prompt section: `name` + `order` + `text` (static, or a provider evaluated at each assembly); sections concatenate in ascending `order`. The canonical convention: `-100` harness identity, `0` deployment persona, `100–199` tool guidance |
| **PromptContext** | dynamic model context materialized as a durable user-role snapshot — cache-safe: re-recorded only when the whole snapshot changes or compaction removes it |
| **Tool schemas** | the schemas each tool provider contributes, plus `knownNames` (the pre-restriction name universe for config validation — telling "typo" from "deliberately hidden in a scope") |
| **Prompt variables** | named `{{variable}}` entries, evaluated per assembly; sections reference them, interpolated at render time |

One special flag: a section marked **`complete`** makes assembly restore to "that section alone"; more than one effective complete section fails assembly.

## Loading & assembly

- The registry service is `ctx.systemPrompt`; plugins contribute via `section()` / `context()` / `tools()` / `variable()`, or `suppressRuntimeContext()` (disables runtime-context contributions without changing the services that own those facts);
- **Scoped layering**: scoped sections and variables shadow globals; duplicates within one layer and non-finite orders throw at registration;
- Every model step calls `assemble(context)`: merge global and scoped providers → detach tool parameters → canonical ordering → the assembly waterfall;
- Two events drive it:
  - **`system-prompt/assemble`** (waterfall) — the expert rewrite over the assembled sections; its return value is authoritative; a registered `complete` section is restored afterwards, so listeners can't replace it;
  - **`system-prompt/change`** (emit) — fired when any prompt provider changes (a global change affects every scope; unfiltered).

## Configuration & customization

The `systemPrompt` config block (the dsh-base system-prompt plugin) defines the deployment identity through `persona`, whose text can reference variables like `{{model}}`, `{{cwd}}`. **The first row of Blue's `cordis.patch.yml` replaces this entry's config and overrides the persona** — a live example of "upper layers always overwrite lower ones":

```yaml
# Blue bundle patch (excerpt)
- id: system-prompt
  config:
    persona: >-
      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.
```

- Tool ordering in the prompt is configured via `systemPrompt.toolOrder` (full keys and defaults live in the official [config catalog](https://deepseek-harness.github.io/deepseek-harness/reference/config-catalog));
- For deep customization: register a `system-prompt/assemble` listener and rewrite the assembled result (authoritative — but a `complete` section is still restored afterwards).

## Relation to Blue

- **No KV-cache impact**: Blue layers add nothing to the model request prefix;
- **Injected context is the complementary surface**: the harness injects runtime-context snapshots, AGENTS.md instructions, and the like as synthetic user messages (rendered as nothing in Blue — see the [FAQ](/en/guide/faq)) — the system prompt owns "who you are and how to work", injected context owns "the facts of this session";
- **The persona is one line away**: as the patch above shows, a profile patch replaces the deployment persona wholesale.

::: tip Source & versions
Facts follow the official [system-prompt subsystem doc](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/system-prompt); when in doubt, trust your installed `dsh --version` and `--dump-config`.
:::
