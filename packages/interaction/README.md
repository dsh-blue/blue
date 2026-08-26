# `@dsh-blue/blue-interaction`

English | [中文](README.zh.md)

Blue's input, command, dialog, and notification layer. It uses the renderer contracts from `@dsh-blue/blue-core` and the app-owned session reader/action/projection services; it never receives a Harness Agent or Session.

The main plugin mounts the prompt editor, keymap actions, built-in commands, question and approval panels, settings, provider onboarding, terminal-title updates, and the startup update check. Its optional `displayVersion` config identifies a dedicated acceptance profile without changing release metadata.

## Editor

The prompt editor supports multiline editing, history, slash-command discovery, queued follow-up and steer, interruption/retraction, external editing, and editor-slot replacement by dialogs. Up/Down navigate editor history; wheel input and PageUp/PageDown scroll the transcript. `EditorHostService` owns renderer references and submit transformers inside one frontend tree. `EditorModelService` exposes only readonly editor state and structured set, submit, and abort actions.

Draft text, prompt/bash mode, history, command aliases, settings/theme identity, models.dev cache, update state, file-probe cache, and image-paste markers/cooldowns are owned by `InteractionStateService`. Theme swaps may rebuild renderer children while this parent service survives; a separate Cordis tree receives independent state.

The optional `./editor-plus` plugin adds `!` shell mode, slash completion, `@` file mentions, and `#` skill completion. File mentions use `fd`/`fdfind` when available and a bounded filesystem fallback otherwise. The executable probe is cached per frontend tree.

## Commands And Panels

Built-in command families cover session navigation and rewind, help, themes, models and reasoning effort, providers, permissions and presets, modes, status/context/version/changelog, export/copy, tools, skills, MCP, trace, settings, and profile updates. The effort panel presents the provider's available levels in one horizontal bracketed row and moves the highlight with Left/Right. Commands read immutable snapshots and invoke `blueSessionActions`; they do not fold session events or mutate Harness objects.

Dialogs replace the editor slot and render through shared list, form, info, settings, question, approval, model, and plan-review panels. Question and approval work is Fiber-bound, abort-aware, and rejects late completion after unload or session changes. Third-party renderer-neutral commands and notifications enter through `./plugin-host-bridge`, which advertises those capabilities only while its owner Fiber is active and restores retained commands after replacement.

Readable export uses the official `blueConversation` projection after flushing and reading the durable artifact. Full export deliberately emits the decoded audit event stream. `/copy` uses the official conversation value and the OSC 52/native clipboard pipeline.

## Optional Subpaths

- `./editor-plus`: shell mode and completion.
- `./pane-queue`: queued-message dock model with immediate inbox-change refresh.
- `./mode-status`: renderer-neutral footer status model.
- `./attachments`: bounded filesystem image store.
- `./paste-image`: native clipboard image/file ingestion.
- `./command-model`: renderer-neutral command models and execution actions.
- `./plugin-host-bridge`: public command/notification adapter.

All registrations, async work, screen children, aliases, and host contributions are disposed with their owning Fiber.

## Model Experience

The package adds no prompt prefix. Only explicit user answers, approvals, commands, and submitted editor content affect the model-facing session.
