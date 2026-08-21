# Configuration: models, providers, and themes

Blue's configuration lives on two layers: **in-app slash commands** (the everyday surface) and **dsh's file system** (`settings.yaml`, `.credentials.yaml`, profile patches — the persistent source of truth). The in-app commands write to those same files; the two layers never fight. This page walks both.

| What you want | In-app | Where it lands |
| --- | --- | --- |
| API key | `/provider add`, the Providers panel's edit form | `~/.dsh/.credentials.yaml` |
| Default model / thinking effort | `/model`, `/effort`, `Alt+M` | the `agent-default-model:` section of `settings.yaml` |
| New provider / custom gateway | `/provider add` | the `llm-pi-ai:` section of `settings.yaml` + the credentials file |
| DeepSeek official endpoint tuning | — (files only) | the `llm-deepseek:` section of `settings.yaml` |
| Theme | `/theme` | session-only, no file ([Theming](/en/guide/theme)) |
| Plugin rows / composition | — | the profile's `cordis.patch.yml` ([Profiles & directories](/en/dsh/profiles)) |

## Minimal setup: one DEEPSEEK_API_KEY

The out-of-the-box assembly talks to the **DeepSeek official API** (provider route `deepseek-official`, endpoint `https://api.deepseek.com`, default model `deepseek-v4-flash`, thinking on at effort `high`). So getting from zero to your first reply takes exactly one key:

```sh
export DEEPSEEK_API_KEY=sk-...
dsh --profile blue
```

To skip the export every time, write the key into `~/.dsh/.credentials.yaml` — the whole document is a plain reference → value mapping and nothing else:

```yaml
DEEPSEEK_API_KEY: sk-...
```

One key can sit in four places, in **priority order**:

| Priority | Source | Use it for |
| --- | --- | --- |
| 1 | Process environment (`DEEPSEEK_API_KEY=… dsh …`) | Per-run override: CI secrets, a temporary key |
| 2 | `~/.dsh/.credentials.yaml` | The normal home; keys stored by `/provider add` land here |
| 3 | `./.env` in the launch directory | Project-level |
| 4 | `~/.dsh/.env` | User-level fallback |

::: tip It starts fine without a key
The key resolves **per request** — booting, browsing models, and the `/model` panel never need it. The first real message with no key anywhere fails with `MISSING_CREDENTIAL` naming every configuration entry point; store the key and ask again — **no restart needed**.
:::

`~/.dsh` is the Harness home; `DSH_HOME` relocates it (full directory table in [Profiles & directories](/en/dsh/profiles)).

## In-app configuration (the everyday surface)

### Model and thinking effort

- **`/model`** — no argument opens the model picker (`←` `→` step the thinking-effort segment); with an id it switches directly. A switch persists as the new default.
- **`Alt+M`** — cycles models without opening the panel.
- **`Alt+S`** (inside the panel) — confirm **for this session only**: the next step switches immediately without persisting a new default.
- **`/effort`** (alias `/thinking`) — switch the current model's thinking effort; `default` restores the provider default.

`/model` persistence lands in the `agent-default-model:` section of settings.yaml (shape [below](#the-three-core-settings-yaml-sections)).

### Providers: list, switch, add

```
/provider                  # open the Providers panel (configured routes + Add)
/provider list             # list providers and the current route
/provider switch <name>    # switch routes
/provider add              # the add-provider wizard
```

Selecting a configured route in the Providers panel opens its **edit form**: display name, baseURL, and key (empty keeps the stored value); `Ctrl+D` deletes the route after a typed confirmation. The built-in `deepseek-official` route has no stored profile to edit (the panel says "nothing to edit") — tune it through the `llm-deepseek:` section of `settings.yaml`.

`/provider add` branches two ways:

- **Known provider** (anthropic, openai, …) — pick a vendor from the host's configurable directory and enter the key (leave baseURL empty for the vendor default).
- **Custom endpoint** (self-hosted gateways, any OpenAI-compatible surface) — declare protocol and address:
  - one of three protocols: `anthropic-messages` / `openai-completions` / `openai-responses`;
  - baseURL conventions: the anthropic protocol takes **no trailing** `/v1` (the client appends `/v1/messages` itself); the openai protocols **need** the `/v1`;
  - the wizard interrogates the endpoint live for its model list (`GET /models`) for you to pick from, then enriches context windows and efforts from the [models.dev](https://models.dev) catalog — whatever it cannot describe, it asks you once (both fields skippable with Enter);
  - the key goes into the credentials file under a ref derived from the route id: `my-gateway` → `MY_GATEWAY_API_KEY`.

After the add completes, the new route's model picker opens; cancelling it keeps the provider (visible via `/provider list`).

## The file system: settings.yaml and credentials

Beyond the in-app commands, all of dsh's configuration sits in a handful of files under the Harness home, and **external edits hot-apply** (the watcher is on by default):

| File | Contents |
| --- | --- |
| `~/.dsh/settings.yaml` | Every plugin's settings section (one document, all namespaces) |
| `~/.dsh/.credentials.yaml` | Credentials (enforced mode `0600` under a `0700` directory) |
| `~/.dsh/.env` | User-level environment layer |
| `~/.dsh/profiles/<name>/cordis.patch.yml` | The profile's composition overlay (see [Profiles & directories](/en/dsh/profiles)) |

A document that exists but fails to parse fails boot (loud); an invalid edit while running keeps the last good snapshot and warns. Hand edits to settings.yaml keep their comments (writes diff at the leaf level).

### The three core settings.yaml sections

```yaml
# Default model — /model and /effort write here
agent-default-model:
  provider: deepseek-official
  model: deepseek-v4-flash
  reasoningEffort: high      # optional

# DeepSeek official endpoint (the llm-deepseek adapter) — every field optional
llm-deepseek:
  apiKeyEnv: DEEPSEEK_API_KEY    # credential ref (this is the default)
  baseURL: https://api.deepseek.com
  thinking: enabled              # enabled | disabled (disabled locks effort to off)
  reasoningEffort: high          # off | high | max
  maxTokens: 256000              # per-request output cap
  defaultContextWindow: 1000000  # fallback when a model declares no capacity
  models:                        # omit for the built-in V4 Flash / V4 Pro pair
    - id: deepseek-v4-flash
      name: DeepSeek-V4-Flash
      contextWindow: 1000000

# Custom provider routes (the pi-ai adapter) — /provider add writes here
llm-pi-ai:
  providers:
    my-gateway:
      displayName: Company gateway
      api: openai-completions          # anthropic-messages | openai-completions | openai-responses
      baseURL: https://gw.example.com/v1
      apiKeyEnv: MY_GATEWAY_API_KEY    # credential ref — the key in .credentials.yaml
      models:
        - id: glm-5.3
          contextWindow: 1000000       # capacity the catalog/endpoint did not declare
          maxTokens: 131072
          reasoningEfforts:            # offered efforts → their wire spellings
            low: low
            high: high
            max: max
```

Notes:

- **`llm-deepseek:` and `llm-pi-ai:` are two independent adapters**: the former owns the `deepseek-official` route to the official API; the latter registers arbitrary routes from its `providers:` dict (the route name is the dict key, lowercase kebab-case). They coexist fine.
- A user settings section overrides the composition baseline (the bundle's defaults) **field by field**; omitted fields keep the baseline value.
- pi-ai routes take further fields: `modelOverrides:` (reshape one catalog model without replacing the list), `compat:` (reasoning-parameter format switches), `defaultContextWindow:` / `defaultMaxTokens:` (route-wide fallbacks), and more — the complete list lives in the [upstream config catalog](https://deepseek-harness.github.io/deepseek-harness/reference/).
- List fields (like `models:`) **replace wholesale**, they never merge entry by entry.

### Verifying your edits

```sh
dsh --profile blue --dump-config        # print the fully assembled plugin tree
```

settings.yaml effects show up right in the UI: the `/model` panel lists each route's models, `/status` shows the current route and model.

## Themes

`/theme dark|light|auto` switches instantly; `/theme custom <path>` mounts a custom JSON palette — hot switches never lose your draft. The full semantic token table and the custom file format are in [Theming](/en/guide/theme).

## Other configuration surfaces

- **Permissions & sandbox** — permission presets (workspace-write / danger-full-access), approval policies, see [Modes & permissions](/en/dsh/modes); in-session `Shift+Tab` cycles normal → plan → yolo, `/yolo` toggles.
- **Agent presets** — `/preset` switches tool surface and persona across `standard` / `code` / `minimal` / `cordis` (blank sessions only).
- **Skills** — user-level skills live under `~/.dsh/skills/`, see [Skills](/en/dsh/skills).
- **MCP** — wiring MCP servers is covered in [MCP setup](/en/dsh/mcp).

## Environment variable quick reference

| Variable | Purpose | Default behavior |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek official API key (the default `apiKeyEnv` ref of `llm-deepseek`) | Missing → first request fails with `MISSING_CREDENTIAL` |
| `DEEPSEEK_BASE_URL` | DeepSeek official endpoint fallback | `https://api.deepseek.com` |
| `DSH_HOME` | Harness home directory | `~/.dsh` |
| `DSH_PERMISSION_MODE` | Process-level permission fallback: `read-only` / `workspace-write` / `danger-full-access` (the last also skips approvals) | `workspace-write` |
| `DSH_TELEMETRY_DISABLED` | Any non-empty value (including `'0'` / `'false'`) hard-disables session telemetry | Telemetry is off by default (`DISABLED`) |
| `DSH_BLUE_ATTACHMENT_DIR` | Blue attachment storage | `$DSH_HOME/attachments/` |
| `DSH_AGENTS_HOME` | Shared agent config root (the `~/.agents` layer of skill discovery) | `~/.agents` |

::: warning What cannot live in .env
`DEEPSEEK_API_KEY` resolves from all four layers (`.env` included), but `DEEPSEEK_BASE_URL` and **every `DSH_*`-prefixed variable** are bootstrap variables — a `.env` file entry is rejected outright (with an "export it instead" notice); set them in the launching environment. Credential environment variables always beat the file layers — to swap a key for one run: `DEEPSEEK_API_KEY=sk-… dsh --profile blue`.
:::
