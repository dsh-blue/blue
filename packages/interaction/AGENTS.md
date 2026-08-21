# @dsh-blue/blue-interaction — agent notes

Implementation detail for this package (the user-facing surface is `README.md`/`README.zh.md`). Repo-wide conventions live in the root [AGENTS.md](../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../docs/blue-decisions.md). Peer+dev dep on the harness line: `@deepseek-ai/dsh-attachment`.

## Editor and hint line

The bottom input editor (`src/input-plugin.ts`) is the pi-tui Editor behind `ctx.blueComponents.createEditor` plus a separate hint-line component. The editor mounts with `paddingX: 4` and the `>` prompt symbol (feeding the core rounded-box chrome); slash-prefixed input recolors the frame `primary` and anything else restores the neutral border (onChange chain). The hint line carries only its transient tiers — one-shot notices and slash discovery in `muted`. (A persistent key-affordance row was retired by the S15 dogfood verdict: kimi teaches affordances through the footer's rotating tips, which already cover every fragment the row carried.)

## Commands and aliases

`src/commands-plugin.ts` registers `/quit` `/resume` `/new` `/fork` `/sessions` `/help` `/init` (`/new`/`/fork` emit the app layer's `blue/request-new`/`blue/request-fork`; `/sessions` is a persistence-list picker panel; `/help` enumerates `commands.list` + `keymap.list()`). `/theme` (`src/theme-switch.ts`) hot-swaps the `blueTheme` provider via `ctx.registry.delete` + `ctx.plugin`, restoring dark on mount failure; the `/theme` listing marks the live palette with the shared `← current` vocabulary (the selected settings-list row styles in `primary`, not `accent`).

The alias-relation registry `src/command-meta.ts`: `/quit` answers to `/q` and `/exit`, `/new` to `/clear` (S27) — the kimi style: aliases are not registered commands, `blue-input` rewrites an alias line to its canonical command before `ctx.commands.execute`, so the session log and every discovery surface stay canonical-only. Re-registering a canonical replaces its relation; an alias claimed by another canonical fails loud.

## Dialog mount and framed surfaces (D26 view, D30 mount)

Every dialog surface is a bottom full-width pull-up panel framed with the core `framePanel` chrome. Since D30 the mount is the kimi editor-slot replacement, not a floating overlay: every dialog mounts through `mountEditorReplacement` (see the shared editor seams below) — the panel takes over the editor's dock slot, the editor leaves the tree for the panel's lifetime (buffer, draft, and history survive in the component), only the footer remains below an open panel, and dismissing restores the editor with focus. Dock-mounted panels own their height (the old overlay `maxHeight` bounds are gone). Centered modal popups are rejected unless a surface explicitly calls for one; `showOverlay` stays reserved for genuinely floating surfaces.

The framed surfaces:

- **Approval prompt** (`src/approval-plugin.ts`) — the kimi port: amber `borderFocus` full-width rules, indented `▶ Approve <tool>?` title, numbered choices `N. label` indented under the title with a `▶` pointer on the selected accent row and `textStrong` on the rest, and a `↑/↓ select · 1-4 choose · ↵ confirm` key row (`type feedback · ↵ submit · esc cancel` in feedback mode). Four choices with digit direct-select, session-scoped allowances in a module-level `WeakMap<Agent, Set<string>>`, reject-with-feedback steering, and a FIFO queue keeping one prompt visible.
- **User questions** (`src/questions-plugin.ts` + `src/questionnaire.ts`) — one tabbed overlay per request with a fixed `Other` free-text row; the `question` title, `(○)`/`(✓)` tab markers (two-space separated, active tab and option cursor on `primary`, rows indented two columns), and the `↑↓ select · space toggle · ↵ choose · tab switch · esc cancel` key row.
- **`/help`** (`src/help.ts` `HelpOverlay`) — a HelpPanel port: `help` title with its key hint, two-column sections (command labels `primary`, key labels `warning`, descriptions `muted`), and a sixteen-row scroll window with a `showing 1-N of M` tail, PageUp/PageDown scrolling ten rows.
- **`/sessions`** — the shared `SelectListPanel` (`src/select-list.ts`; originally a hand-rolled `SessionList` in `select.ts`): `❯ ` pointer on the `primary` cursor row, `← current` badge on the live session, `· esc cancel · ↵ resume` title hint.
- **`BlueSelect`** — frames itself with a `title` option, gives its cursor row the full-width `selectedBg` (the token's first real use) and a `❯ ` pointer, and joins the rest in `textMuted` scroll/key rows.

The shared selector symbols (`SELECT_POINTER`/`CURRENT_MARK`, the kimi `constant/symbols.ts` port) live in `src/symbols.ts`: both list classes draw the pointer from it.

## Model family (S23, D38)

`src/model-commands.ts` registers `/model` (the `ModelPanel` picker over the llm catalog — name/provider columns, `· ctx Nk` metadata, the `← current` badge, the cache-warning row, and the footer thinking-segment control from `src/thinking-segments.ts` drafting the highlighted model's effort with ←/→), `/effort` (the horizontal segment selector with a `Default` segment that omits the effort; `/thinking` is an alias), and `/provider` (`src/provider-add.ts`):

- Active routes open the scoped model picker; dormant pi-ai catalog vendors flash the configuration pointer.
- The `+ Add provider` CTA runs the wizard: known-vendor adoption or a custom endpoint with discovery-fed model adoption, committing through `settings.mutate` on the `llm-pi-ai` namespace (selected explicitly — the configurable directory mixes adapter families) then `credentials.set` under the conventional `<ROUTE>_API_KEY` ref.
- The models step is listing-only: discovery must answer or the add aborts with the classified reason (manual model entry disabled for now). A models.dev catalog pass runs after the models step (`src/models-dev.ts`, the kimi catalog-fetch port: matching the adopted ids against `https://models.dev/api.json` fills each match's context window and pi-ai-gated effort levels; offline quietly falls back), and an optional model-defaults form covers the gap (a context window for models the listing did not describe, and a thinking-effort set written as pi-ai's level→wire map); the discovery probe's classified failures ride the manual form's subtitle.
- The multi-field `src/form-panel.ts` carries Tab/↑↓ field routing, in-panel error lines, and masked bullet rows.

Every commit writes `blueSession.modelRef.current` (the next step's route); Enter additionally persists via `agentDefaultModel.saveSelection`; Alt+S (`blue.interaction.session-only`, one of three contextual actions beside ←/→ segment steps) commits session-only.

## Session info family (S25)

`src/session-commands.ts` registers `/status` and `/context` (named for CC's context panel rather than kimi's `/usage`) opening the read-only `InfoPanel` (`src/info-panel.ts` — headed two-column label/value rows whose values are styled `InfoSegment` runs, the `/help` scroll window and close keys), and `/version` flashing the banner constant (reached cross-package through the `./banner-content` subpath export). The numbers come from `sessionProjections.snapshot` (the base composition's token-meter/session-stats folds, replay-correct across resumes — the bundle e2e mounts the real projection family behind the `sessionProjections` boot flag), with `src/usage.ts` as the thin read layer whose pure `assistant/*` fold (replace-per-step, mirroring the upstream unit) answers on projection-less hosts — Blue owns no accumulator. The shared context section renders the kimi `█░` bar severity-colored at 50%/85% with the 1024-base counts, plus the CC-style composition section — the `contextBreakdown` projection's heuristic system/tools/message tokens as a stacked `█▓▒░` bar with component and free rows (sub-half-percent shares read an honest `0%`, the heading carries the heuristic caveat, and hosts without the seam omit the section).

## Export family (S26)

`src/session-export.ts` registers `/export [full] [path]` (writes the current session as Markdown) and `/copy` (pushes the last assistant message's text through `src/clipboard-write.ts`). `/copy` follows the kimi order:

1. **OSC 52 first** — core's `terminal-escape.ts` emitter (`buildClipboardOsc52` + `emitClipboardOsc52`, both legs injectable). The escape is pure stdout output the terminal consumes without rendering, so it neither touches scrollback nor pi-tui's differential frames; tmux runs wrap in the DCS passthrough with doubled ESC.
2. **Then the platform tools over stdin** (wl-copy → xclip, pbcopy, clip.exe) as the verified path with the paste-image timeout.

A tool win reports `native`; an all-tools-fail with the escape out reports the unverified `copied via terminal escape sequence` notice; both legs dead throws the aggregate `no clipboard tool is available (…)` failure with ENOENT classified as "not installed".

The default export is the readable view — the folded transcript in kimi's export-md shape (front-matter, overview, per-turn `### User`/`### Assistant` sections with `<details>` thinking/tool-result blocks). The `full` mode keyword exports the decoded event stream instead (`buildFullExportMarkdown`, `event_count` front-matter): nothing folded or filtered — the D28 injections appear labeled by `source.kind`, tool results carry their full text, turn/step boundaries and request rows stay visible, unknown event types dump their raw JSON, and only `assistant/chunk` rows stay out (the assembled message carries the whole text).

Both commands share one read path: the persistence backend's raw artifact (`supportsRawArtifacts` + `readRaw`, JSONL chunk rows expanded through dsh's `decodeStorageRecord`, peer+dev dep `@deepseek-ai/dsh-session`) folded by the transcript's `foldSessionEvents` — so the export mirrors exactly what the transcript renders (the D28 injection filter included) and survives compaction and resume. The durable read flushes the session first (`ctx.get('sessions')?.flush`, the SessionStore's documented pre-read channel — the persistence coordinator drains asynchronously), and every guard (no session, no persistence, non-raw backend, no artifact, empty fold, corrupt line, write failure) reports a classified error.

## Light commands (S27)

`src/session-init.ts` registers `/init`: sends the AGENTS.md exploration brief (the kimi `init` registry's spirit, English body) to the UI's current agent as a plain user followup — `agent.followup` on a `source.kind: 'user'` message, so the transcript echoes what was sent — when the agent is idle; refuses with an error notice while it runs or when no session is attached (the `/fork` guard rule). `/clear` joins as `/new`'s alias (the second command-meta consumer): `/clear` completes as `/new (clear)` in the dropdown, `/help` appends the annotation, and the submission rewrites to the canonical name.

## Tools and presets (S28, D37)

- `src/tools-commands.ts` registers `/tools` — a two-step catalog browser over `ctx.tools.schemas(roster.standingKeyFor(composedPreset(agent.ctx)))` under the thin-host roster, the global view otherwise. The first panel is the shared picker (one row per tool with its first sentence as the brief); Enter stacks a read-only detail `InfoPanel` above it: identity rows (name, the MCP server for `mcp__` names), the full description as wrapped source lines, and one row per JSON-Schema parameter with type, description, and a `· required` mark. Escape walks back one panel at a time. Note the cross-store lesson (D37 实施后记): `scopeOf` from a linked Blue's own `dsh-scope` copy reads `undefined` on CLI-tagged contexts — `kScope` is a module-level Symbol and the dev link loads two instances — so the roster's public standing-key API is the cross-store-safe path.
- `src/preset-commands.ts` registers `/preset` — the roster picker over `ctx.agentPresets.list()` with the live composition badged and broken rows disabled. A pick re-dispatches `/preset <id>` through the command runtime (one write path with the typed line); the switch core guards idle + blank (`turn/start` absent; in-process calls have no wire-layer lock), then `recompose(agent.ctx, id)` + the `agent-preset/selected` event append, which is what resume folds to rebuild the composition.

## Shared selectors and permission (S24b, D33)

The shared single-select `SelectListPanel` (`src/select-list.ts`): the center-on-cursor 8-row window, `❯ ` pointer, `← current` badge, `(n/m)` counter, plus the `cycle`/`windowedRange`/`counterRow`/`oneLine` helpers. `/sessions`, `/provider` (whose CTA became a uniform trailing row), the wizard's choose steps, and the `/permission` picker consume it; `BlueSelect` consumes the helpers; `ModelPanel` keeps its own tabbed geometry.

The `/permission` preset picker (`src/permission-panel.ts`, D33): `blue-input` intercepts a bare `/permission` line while `ctx.permissionPresets` is composed (type-only peer dep) and opens the panel; a pick dispatches `/permission <name>` through the command runtime so every switch logs the command and knob events; the danger-full-access row gates behind a typed-`y` `FormPanel` stacked on the picker; the derived `custom` state rides as a blocked display row.

The plan-review intent gets its dedicated panel (`src/plan-review-panel.ts`, the kimi approval shape): `questions-plugin` routes a single-question plan-review ask to the plan markdown in a bordered `plan` box (the btw pane's box idiom) — a viewport-filling window (live `blueScreen.rows` minus the panel chrome, minimum 6) with a showing tail — above the numbered decision list `1. Approve` (label from `intent.approve`) / `2. Reject` (answers with the other option's label) / `3. Revise` (the row carries the inline feedback input in the kimi `3. Revise  <text>` shape: a real editor owns the keys, the row derives from the tracked text with a cursor block and `Type feedback · ↵ submit.` beneath; non-empty submits `{selected: [], custom}`, empty declines plainly). Digits jump-and-fire from the list but type while the input holds focus; Escape dismisses through `ASK_CANCELLED` — the harness-wide code dsh-plan-mode catches, fixing the earlier Blue-invented `ASK_DISMISSED` leak; malformed pairs fall back to the questionnaire.

## Completions (S14, D31)

The pure `src/slash-filter.ts` (the kimi `scoreTokens` port) backs both the provider's slash branch and the hint line's discovery list so the two surfaces agree on what matches: the query splits on whitespace, every token must subsequence-match the command name through `blueComponents.fuzzyMatch`, survivors sort by summed score; the alias extension adds the kimi match rule — the canonical name scores first, aliases count only when it misses, a tie keeps the canonical match ahead, and an alias hit labels the command `/{name} (alias, alias)` while `/help` always appends `(/alias, /alias)`.

Slash items and the returned prefix carry the leading slash so pi-tui's Enter accepts-and-submits and its best-match preselection keys on the typed text; dropdown descriptions join the command's `input.hint` (`hint — description`). Bash mode declines slash suggestions outright (a leading `/` there is a path — with Enter submitting, an unguarded dropdown would run the wrong command).

The `@` branch is the kimi mention composition (D31): empty-tail tokens (a bare `@` or a directory drill-down like `@docs/`) take the deterministic one-level listing from `src/file-mention.ts` (`listDirectoryMentions` — the resolved directory's own entries, directories first then files by `localeCompare`, `.git`/`node_modules` skipped, capped at 50; a deliberate deviation from kimi, whose fd empty-query list re-ranks an arbitrary top-20 cut); query-bearing tokens delegate to `blueComponents.createFileMentionProvider` (scoped queries, substring scoring, top-20, quoted values, fd-respecting-gitignore) while fd is available. `src/file-mention.ts` also supplies the kimi `extractAtPrefix` gate, the `fd`→`fdfind` PATH probe (no managed download), and the fs fallback (2000-entry scan/50-suggestion caps, directories and hidden entries included, `.git` and `node_modules` skipped). `applyCompletion` always delegates (directories keep the cursor for drill-down, files append the trailing space, `@` Enter accepts without submitting); an empty result flashes the hint-line notice `no matching files under the session cwd` (aborted rounds stay quiet); and the core adapter's reopen hook re-opens the dropdown on a bare `@` token or text ending in `/` inside a mention.

The argument-hint ghost drives `setGhostHint` with the kimi `computeArgumentHint` rules: a completed `/command` plus at most one space, the hint lead-spaced until the user types the separator, never in bash, recomputed on re-attach for restored drafts, cleared on detach.

## Editor-plus, shell echo, and pane-queue

The optional `./editor-plus` subpath plugin (`src/editor-plus.ts`, `blue-editor-plus`) layers `!` bash mode — the triple cue of `!` symbol, ` ! shell mode ` border label, and the shellMode hue, re-asserted over the slash resolution while the mode is active — and slash/`@` autocomplete over the shared editor, mirroring the input mode into `draft-stash.ts` so a theme-swap reload rebuilds bash.

The shell echo (`ShellExecutor` contract split into `{code, stdout, stderr}` — the node `exec` callback provides them separately; rejections surface as red stderr with code 1) uses the kimi dim presentation: captured output is sanitized by `src/shell-sanitize.ts` (the kimi regex port — CSI/OSC/single-ESC/C0 stripped, `\n`/`\t` kept, never throws) before per-stream caps; the echo header leads with a `shellMode('$ ')` marker followed by the command in the default foreground; stdout and stderr render `textMuted` (stderr `error` on failure) with `(no output)` when both streams are empty; the muted truncation row stays; and the `exit code N` row remains per user ruling (failure stays visible even with silent stderr).

The `./pane-queue` subpath plugin (`src/pane-queue.ts`, `blue-pane-queue`) renders the agent's queued inbox messages (its `↑` glyph accented `primary`) and registers the keyless `blue.queue.recall` action that gates the empty-editor Up recall in `blue-input`.

## Key resolution and btw routing

Overlay key handling resolves through `ctx.blueKeymap`; text-editing keys are owned by the pi-tui Editor; the main editor's contextual keys (Escape/Ctrl-C/Ctrl-S) resolve through the editor's `onKey` pre-dispatch hook. Key discipline: a keymap action without a `handler` is contextual (components resolve it via `matches`); a handler-carrying action is global and is consumed by core's dispatcher before focus routing.

The side-question pane routes through the editor key chain: while `'blue/editor-connected-above'` is true (the listener mirrors it onto the editor via `setConnectedAbove` and the frame splices `├┤`), Escape closes the pane ahead of the draft clear — the draft survives — and Up/Down with an empty buffer scroll it, both emitted as `'blue/btw-command'`. The keymap's key-level conflict detection (Escape/Up/Down belong to the list surfaces) made a global-action registration impossible, so the editor chain is the sanctioned channel.

## Shared editor module seams (`src/editor-instance.ts`)

- **Submit-transformer seam**: `registerSubmitTransformer(fn)` returns a disposer; `applySubmitTransformers(text)` concatenates contributions in registration order (empty result keeps the historical single text block); both the followup and steer paths build content through it.
- **Editor-slot swap**: `setEditorSlotSwap` installs `blue-input`'s machinery on mount and clears it on unload; `mountEditorReplacement(component)` is the dialog-facing entry — it returns an idempotent restore disposer and degrades to a no-op while no input layer is mounted.
- **Draft stash** (`src/draft-stash.ts`): mirrors the unsubmitted editor text, the input mode, and the prompt history (mirrored after every submission, newest-first; `BlueEditor.getHistory()` reads it back through a single structural cast over pi-tui's private field, spec-pinned) so all three survive theme-swap reloads — text restored via `setText`, history replayed through `addToHistory`, on apply; the draft clears on submit/steer while history persists.

## Attachments and paste-image

- `./attachments` (`blue-attachments`, inject `[blueComponents]`) provides the harness `attachments` `AttachmentStore` backed by a filesystem store with magic-byte sniffing (shared sniffer export), a media-type whitelist plus caps (10 MB/image, 8 images/message, 30 MB/message, 16M pixels), files under `DSH_BLUE_ATTACHMENT_DIR ?? $DSH_HOME/attachments ?? ~/.dsh/attachments` as `<uuid>.<ext>`, and `AttachmentError` codes aligned with dsh-attachment's taxonomy.
- `./paste-image` (`blue-paste-image`, inject `[attachments, blueKeymap]`) registers the contextual ctrl+v action `blue.image.paste`, resolved in a wrapper on the shared editor's onKey chain: reads the clipboard through an injectable reader defaulting to wl-paste → xclip probes (3 s timeout), saves via `ctx.attachments`, inserts an `[image #N]` marker (module-level map, survives theme-swap reloads) that the submit transformer splits into ImageBlocks. Failures flash a notice; late completions after unload no-op.
