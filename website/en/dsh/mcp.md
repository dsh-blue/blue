# MCP setup

[MCP (Model Context Protocol)](https://modelcontextprotocol.io/) is the standard protocol for wiring external tools into dsh. dsh connects to MCP servers through the official bridge plugin **`@deepseek-ai/dsh-mcp-client`**, which registers the server's tools as native tools — the model sees them under server-qualified names `mcp__<serverName>__<toolName>` (the same shape Claude Code and Codex use).

::: info Version
The bridge plugin is on its own version line (currently `0.0.1-rc.1` on npm), independent of dsh's main line. **Only Tools are bridged** — MCP Resources and Prompts have no harness consumer yet and are deferred upstream.
:::

## Quick start

**One MCP server = one plugin instance**, added as a row in the profile's patch file (`$DSH_HOME/profiles/<name>/cordis.patch.yml`). Install the plugin first, then configure:

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-mcp-client
```

**stdio (local program) — the GitHub server example:**

```yaml
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN
```

**streamable-http (remote or already-running HTTP service):**

```yaml
- id: mcp-web
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: web
    transport: streamable-http
    url: http://localhost:3000/mcp
    headers:
      Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

The model will see tools like `mcp__github__create_issue`, `mcp__web__search`, and so on.

## Config fields

| Field | Transport | Required | Description |
| --- | --- | --- | --- |
| `transport` | both | yes | `"stdio"` or `"streamable-http"` |
| `serverName` | both | yes | namespace for the server's model-facing tool names: `[A-Za-z0-9_-]{1,32}`, unique across live instances |
| `command` | stdio | yes | executable to spawn |
| `args` | stdio | no | arguments passed to the command |
| `env` | stdio | no | extra env vars merged on top of a scrubbed ambient env |
| `cwd` | stdio | no | working directory for the child process |
| `url` | http | yes | the MCP server URL |
| `headers` | http | no | extra headers (e.g. auth tokens) |
| `toolCallTimeoutMs` | both | no | per-`callTool` timeout (default 60000) |
| `failOnStartupError` | both | no | reject plugin activation when the initial connection/sync fails (default `false` — activates with no tools) |
| `reconnect.enabled` | both | no | reconnect automatically after a lost connection (default `true`) |
| `reconnect.initialDelayMs` | both | no | first reconnect delay; doubles per consecutive failure (default 500) |
| `reconnect.maxDelayMs` | both | no | backoff ceiling; also the uptime that resets the attempt budget (default 30000) |
| `reconnect.maxAttempts` | both | no | consecutive failures per outage before giving up (default 10) |

**Credentials always come from environment variables** (`!!js process.env.XXX` or template-string interpolation) — never hardcode secrets in config files.

## Naming & multiple servers

- Public names are normalized (the DeepSeek function-name contract: 64 chars, `[A-Za-z0-9_-]`); when renaming or truncation changes a name, a deterministic 12-hex-char hash of `(serverName, rawName)` is appended so distinct tools never collapse into one name;
- names are a **pure function of `(serverName, rawName)`**: connection order, re-syncs, and other servers never rename an existing tool;
- two servers publishing the same raw name (e.g. both `search`) coexist under their namespaces; a duplicate `serverName` fails the later instance **at load**;
- a server listing the same tool twice is rejected as an invalid tool list.

## Behavior & operations

- **HMR hot-swap**: editing the entry triggers disconnect + reconnect, **no process restart**; an unchanged `serverName` reproduces identical tool names;
- **Registration timing**: plugin activation awaits `listTools()` and registers everything before the composition starts its first turn; discovery failure defaults to "activated with no tools" (`failOnStartupError: true` rejects activation);
- **Reconnect budget**: after `maxAttempts` consecutive failures the server's tools are unregistered and reconnection stops (until an HMR reload); a connection surviving past `maxDelayMs` resets the budget — an occasionally-crashing server recovers indefinitely, a crash-looping one eventually stops;
- **During an outage**: the last good generation stays registered and calls against it fail until recovery; `notifications/tools/list_changed` triggers a re-sync;
- **KV cache**: prefix-stable while the tool set and schemas are unchanged; a re-sync that adds/removes/renames tools invalidates reuse from the first changed schema token; a reconnect recovering an unchanged list stays prefix-stable.

## Limitations

- **Tools only**; Resources / Prompts are deferred;
- connection/discovery timeouts inherit the MCP SDK's 60-second default (dsh does not expose a connect timeout yet);
- reconnection triggers on transport close — a crashed stdio child fires it; unreachable HTTP services are retried per request;
- **images are the only durable rich-result bridge** (PNG/JPEG/WebP/GIF, requiring a mounted `ctx.attachments` and an exact proof that the model route supports image input); audio, embedded resources, resource links, and unknown blocks degrade to bounded diagnostic text and never enter session events.

## Relation to Blue

- Once registered on `ctx.tools`, MCP tools are ordinary tool calls in a Blue session — rendered as the [generic tool card](/en/features/streaming) (Blue has no MCP-specific card yet);
- under the image conditions above, MCP image blocks render in a Blue session (Blue's `blue-attachments` is the `ctx.attachments` implementation);
- every request pays token cost for the registered MCP tool schemas — the more servers mounted, the longer the system prompt (see [System prompt](/en/dsh/system-prompt)).

::: tip Source
Fields and behavior follow the official [@deepseek-ai/dsh-mcp-client README](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/mcp/mcp-client).
:::
