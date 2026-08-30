# `@dsh-blue/blue-interaction`

English | [中文](README.zh.md)

Blue's input, command, dialog, and notification layer. It uses the renderer contracts from `@dsh-blue/blue-core` and the app-owned session reader/action/projection services; it never receives a Harness Agent or Session.

The main plugin mounts the prompt editor, keymap actions, built-in commands, question and approval panels, settings, provider onboarding, terminal-title updates, and the startup update check. Its optional `displayVersion` config identifies a dedicated acceptance profile without changing release metadata.

## Editor

The prompt editor supports multiline editing, history, slash-command discovery, queued follow-up and steer, interruption/retraction, external editing, and editor-slot replacement by dialogs. Up/Down navigate editor history; wheel input and PageUp/PageDown scroll the transcript. `EditorHostService` owns renderer references and submit transformers inside one frontend tree. `EditorModelService` exposes only readonly editor state and structured set, submit, and abort actions.

Draft text, prompt/bash mode, history, command aliases, settings/theme identity, models.dev cache, update state, file-probe cache, and image-paste markers/cooldowns are owned by `InteractionStateService`. Theme swaps may rebuild renderer children while this parent service survives; a separate Cordis tree receives independent state.

The optional `./editor-plus` plugin adds `!` shell mode, slash completion, `@` file mentions, and `#` skill completion. File mentions use `fd`/`fdfind` when available and a bounded filesystem fallback otherwise. The executable probe is cached per frontend tree.

Public `editor.extensions` contributions can add passive rows, hints, diagnostics, actions, completion items, and asynchronous submit transforms. Blue keeps registrations inert until the active interaction owner invokes them, composes completion with the built-in slash/`@`/`#` sources, and rebuilds extension chrome around the same editor engine. Submit transforms run before the editor clears; the draft and image attachments remain recoverable when a transform aborts, times out, fails, unloads, or the submitted follow-up is safely retracted. Session changes and extension refreshes reject late results.

## Commands And Panels

Built-in command families cover project init (`/init`), session navigation and rewind, help, themes, models and reasoning effort, providers, permissions and presets, modes, status/context/version/changelog, export/copy, tools, skills, MCP, trace, settings, and profile updates. The effort panel presents the provider's available levels in one horizontal bracketed row and moves the highlight with Left/Right. Commands read immutable snapshots and invoke `blueSessionActions`; they do not fold session events or mutate Harness objects.

`/plugin` is local-first while the marketplace remains paused. Bare `/plugin`
shows only profile dependencies that publish a canonical Blue manifest, with
compatible/incompatible/invalid state. `/plugin verify <package-or-directory>`
runs the published static validator. Installs accept an existing local path or
tarball, an exact npm `package@version`, or a GitHub source pinned to a full
commit; mutations are delegated to `dsh plugin` and require a restart rather
than replacing the live tree.

Dialogs replace the editor slot and compile the same renderer-neutral Blue UI nodes used by plugin surfaces. Help/info windows, lists, forms, settings, questions, approvals, models, loading states, and plan review therefore share core-owned chrome, focus, semantic paint, and narrow-width containment. Question and approval work is Fiber-bound, abort-aware, and rejects late completion after unload or session changes. Third-party renderer-neutral commands, notifications, and editor extensions enter through `./plugin-host-bridge`, which advertises those capabilities only while its owner Fiber is active and restores retained definitions after replacement. Its private owner lease fences command dispatch and both fulfilled/rejected settlement, editor callbacks, and notification observation by generation; retained stale handlers never invoke plugin code. Notification observer failures are isolated from sibling observers and from the publisher result.

Blue-owned interaction chrome is available in English and Simplified Chinese. `/settings` lists Language first and cycles Follow system, 中文, and English through Harness's `locale.preference`; switching refreshes open settings, help, approval, questionnaire, command models, and slash completion in place without replacing controllers/editors, losing selection, or discarding an open form draft. User/model/tool content, paths, ids, command names, provider/model names, and upstream error details are not translated.

Forms keep inline validation below the failing field, while text fields retain the Blue editor's cursor, IME, and bracketed-paste behavior. Enter advances fields or submits the last field; Tab/Down moves forward and Shift-Tab/Up moves backward. Question panels show bounded progress, use the same canonical input for free-text and `Other` answers, preserve drafts while moving between questions, and accept 1-9 direct selection.

Readable export uses the official `blueConversation` projection after flushing and reading the durable artifact. Full export deliberately emits the decoded audit event stream. `/copy` uses the official conversation value and the OSC 52/native clipboard pipeline.

The `blue` settings namespace persists both exclusive provider choices. `statusProvider` selects the footer and `editorProvider` selects the editor shell; `blue.default` keeps the shipped implementation for each surface. Another non-empty id remains configured even while its candidate is absent or failing, so installing, repairing, or reloading that provider can satisfy the original choice without a settings rewrite.

`./editor-provider-owner` consumes the exclusive editor-shell selection. A candidate stays inert until selected, then Blue validates and dry-renders it at the live width around the same editing engine before atomically replacing the inner shell. Provider swaps preserve draft, cursor, history, IME, attachments, focus, completion, and submit transactions. Invalid or failing candidates retain the same-session interactive shell or fall back to `blue.default`; repeated failures open a bounded three-in-60-second breaker without retaining timers.

## Optional Subpaths

- `./editor-plus`: shell mode and completion.
- `./pane-queue`: canonical queued-message bottom pane with immediate inbox-change refresh.
- `./mode-status`: canonical footer status node derived from the current mode snapshot.
- `./attachments`: bounded filesystem image store.
- `./paste-image`: native clipboard image/file ingestion.
- `./command-model`: renderer-neutral command models and execution actions.
- `./plugin-host-bridge`: public command/notification/editor-extension adapter.
- `./editor-provider-owner`: exclusive editor-shell selection and event owner.

All registrations, async work, screen children, aliases, and host contributions are disposed with their owning Fiber.

## Model Experience

The package adds no prompt prefix. Only explicit user answers, approvals, commands, and submitted editor content affect the model-facing session.
