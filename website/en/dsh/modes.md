# Modes & permissions

"Mode" shows up on four independent dsh layers that combine freely:

## 1. Agent presets (session shape)

These decide which capabilities the session's agent has and how its tools are presented. dsh ships four presets (switched in the host app's mode selector):

| Preset | Description |
| --- | --- |
| **标准模式 (Standard)** | the full-featured coding agent: file editing, shell, file & web retrieval, skills, planning, goals, subagents, and workflows |
| **PTC mode** | everything Standard has, with tools presented through the Code Mode SDK — the model composes multi-step operations as one TypeScript program (the `run_code` transport) |
| **极简模式 (Minimal)** | a two-tool coding agent: the persistent bash shell and `str_replace_editor` |
| **创造模式 (Creator)** | for authors of custom agent presets: Standard capabilities plus runtime inspection, plugin experimentation, and preset-authoring guidance |

Tool presentation is governed by the `tools.mode` config: `native` (default, function calling) / `code` (the `run_code` transport only) / `both`; a single agent may shadow the global default with its own selection.

## 2. Approval policy

Tool calls needing authorization go through `approval/request`; there are exactly two policies:

| Policy | Semantics |
| --- | --- |
| `ask` (default) | requests go to the chain of answerers — **Blue's four-choice approval panel is an answerer** (see [Approvals & questionnaires](/en/features/approval)); with no answerer, fail closed |
| `never` | never ask; every ask resolves to rejection — the strict headless stance for CI/unattended runs |

Outcomes form a closed set: `allowed-once` (grants only that single operation) / `rejected` / `cancelled` / `unavailable` — anything missing is treated as denial (fail-closed).

## 3. Sandbox mode

Constrains the filesystem blast radius of shell/process execution (network and process visibility are out of its domain):

| Mode | Semantics |
| --- | --- |
| `read-only` | all writes denied |
| `workspace-write` | writes allowed under the workspace root plus backend-defined temp areas |
| `danger-full-access` | isolation bypassed entirely |

Backends are chosen per platform: Landlock/bwrap on Linux, Seatbelt on macOS, ACL-restricted tokens on Windows; when no sandbox is available dsh fails loudly — never a silent pass-through. Some platform boundaries (old Landlock ABIs, Windows hardlinks) degrade to partial enforcement.

## 4. Permission presets

Permission presets **bundle the sandbox mode and the approval policy into named packages**, so a client can offer one "permissions" selector switching both:

| Preset | Sandbox | Approval |
| --- | --- | --- |
| `workspace-write` | `workspace-write` | `ask` |
| `danger-full-access` | `danger-full-access` | `never` |

::: tip Relation to Blue
Permission presets (`dsh-permission-presets`) **are in the default assembly** (one of dsh-base's 78 rows). Blue currently services the `ask` policy through its approval panel; the preset switcher has shipped — typing a bare `/permission` in the input box (intercepted by the input layer; an argumented line passes through to the host command) opens the preset panel, and the persisted default is maintained through the `/settings` panel's `permission.defaultPreset` row.
:::
