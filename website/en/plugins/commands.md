# Commands

The `commands` capability registers slash commands into the Harness command registry: they automatically appear in the editor's slash completion and in `/help`, with no extra UI registration.

## Contract

```ts
api.commands?.register(contribution: BlueCommandContribution): BlueResult<BlueRegistration>
```

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | the command name (the user types `/id`). Must match `^[a-z][a-z0-9_-]*$` — note this is stricter than a general contribution id: **dots are not allowed** |
| `label` | `string` | a non-empty description, shown in completion and `/help` |
| `execute` | `(args, options?) => Promise<BlueResult>` | the handler, see below |
| `priority` | `number?` | optional integer metadata |

The arguments of `execute(args, options)`:

| Argument | Description |
| --- | --- |
| `args` | the array of `rawInput` trimmed and split on whitespace; `[]` when there are no arguments |
| `options.signal` | an `AbortSignal`, fired when the session is aborted — long-running tasks must respond to it |
| `options.rawInput` | the raw input line (unsplit), for when you need to parse quotes yourself |

## Full example

An abortable command that appends text to a file:

```ts
const opened = ctx.bluePluginHost.open(ctx, {
  id: 'my-plugin.clipboard',
  api: '^1.0.0',
  capabilities: ['commands', 'notifications'],
})
if (!opened.ok) return
const api = opened.value

api.commands?.register({
  id: 'clip',
  label: 'Append text to ~/clip.log',
  execute: async (args, { signal } = {}) => {
    if (args.length === 0) {
      return { ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'usage: /clip <text>' }
    }
    if (signal?.aborted) {
      return { ok: false, code: 'BLUE_ABORTED', message: 'aborted' }
    }
    await appendFile(`${homedir()}/clip.log`, `${args.join(' ')}\n`)
    api.notifications?.publish({
      id: 'clip.saved',
      view: { kind: 'text', content: `saved ${args.length} word(s)` },
      tone: 'success',
    })
    return { ok: true, value: undefined }
  },
})
```

## Behavior details

- **Duplicate ids are rejected**: `register()` returns `BLUE_DUPLICATE_ID`. Colliding with a built-in command or another plugin's command fails at registration time too — always check `register`'s return value and degrade on failure;
- **The return value is the user feedback**: the `message` of `{ ok: false, code, message }` is shown as error text in the editor notice bar; an exception thrown by `execute` is backstopped by the bridge layer into `plugin command failed: ...` — a backstop is not a contract, so return structured errors on your own;
- **Success is silent**: `{ ok: true }` produces no output. To give the user feedback, publish one through [`notifications`](/en/plugins/notifications);
- **Unload means disappearance**: registrations bind to the caller's Fiber; once the plugin unloads, the command is removed from the registry and vanishes from completion and `/help` alike.

## Common pitfalls

| Symptom | Cause |
| --- | --- |
| `BLUE_INVALID_CONTRIBUTION` | the id contains uppercase letters, dots, or a leading digit; `label` is empty; `execute` is not a function |
| `BLUE_ACTION_REJECTED` | the id starts with `blue.` / `blue:` / `blue-` / `@dsh-blue/` — that is Blue's reserved namespace |
| `BLUE_DUPLICATE_ID` | name collision with an already-registered command (including built-ins) |
| my command is missing from completion | `register()` failed and you never checked the return value; or the plugin row never made it into the patch |

## Reference

- The design rationale behind argument and abort semantics lives in [Core concepts](/en/plugins/concepts);
- How built-in commands register: see `blue-interaction` ([Built-in plugins](/en/plugins/builtins)).
