# Session reads and actions

Blue splits its public session seam into two independent capabilities. Request `session.read` when a plugin only observes the current session. Add `session.act` only when it must submit a followup, steer, or interrupt action.

| Capability | Field returned by `open()` | Exposed methods |
|---|---|---|
| `session.read` | `api.session` | `current()`, `subscribe()` |
| `session.act` | `api.sessionActions` | `request()` |

The facades never merge their method sets. A plugin requesting only `session.read` has no `sessionActions`; a plugin requesting only `session.act` has no `session`. The app is the sole real owner. Public objects expose neither Harness Agent/Session objects, the event log, nor the app's broader action service.

## Read-only snapshots

`current()` returns the current `BlueSessionSnapshot`, or `null` when no session is active:

```ts
interface BlueSessionSnapshot {
  readonly revision: number
  readonly id: string
  readonly cwd: string
  readonly status: 'idle' | 'running' | 'waiting' | 'failed'
  readonly mode: 'normal' | 'plan' | 'yolo'
  readonly model?: {
    readonly id: string
    readonly provider?: string
    readonly effort?: string
  }
}
```

The host copies and deeply freezes each snapshot, including nested `model` data. `revision` increases monotonically when the app owner publishes a new state. The host ignores duplicate or regressing revisions in one owner generation and drops callbacks arriving after an old owner unloads.

`subscribe(listener)` registers before synchronously replaying the current value, so a reentrant publication during subscription cannot be missed. Its `BlueRegistration` is idempotently disposable, and consumer Fiber unload also removes the subscription. During an owner gap, a retained live reader observes `null`; after activation it receives snapshots only from the new owner generation.

```ts
export const inject = ['bluePluginHost']

export function apply(ctx) {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'com.example.session-badge',
    api: '^1.0.0',
    capabilities: ['session.read'],
  })
  if (!opened.ok) throw new Error(`${opened.code}: ${opened.message}`)

  const reader = opened.value.session
  const registration = reader.subscribe(snapshot => {
    if (snapshot !== null) console.log(snapshot.revision, snapshot.id, snapshot.status)
  })
  // The ctx Fiber owns registration; registration.dispose() may end it early.
}
```

## Structured actions

`sessionActions.request()` accepts these actions:

```ts
{ kind: 'followup', text: 'continue with tests' }
{ kind: 'steer', text: 'focus on the parser' }
{ kind: 'interrupt' }
```

The app owner serializes actions through one global FIFO, including requests from different plugin consumers. Each request captures its admission-time session id and owner generation. A queued request crossing a session switch, or a running result settling after switch/unload, returns `BLUE_ACTION_REJECTED`; late success cannot enter the current session.

Callers may pass an `AbortSignal`. Pre-abort, queued abort, and active abort all return `BLUE_ABORTED`, and active owner work receives the aborted signal. No active session returns `BLUE_SESSION_UNAVAILABLE`; an owner gap for a live consumer returns `BLUE_CAPABILITY_ABSENT`; a disposed consumer returns `BLUE_ACTION_REJECTED`.

```ts
export function apply(ctx) {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'com.example.session-action',
    api: '^1.0.0',
    capabilities: ['session.act'],
  })
  if (!opened.ok) throw new Error(`${opened.code}: ${opened.message}`)

  const controller = new AbortController()
  void opened.value.sessionActions
    .request({ kind: 'interrupt' }, { signal: controller.signal })
    .then(result => {
      if (!result.ok) console.error(result.code, result.message)
    })
}
```

If the session owner bridge is inactive when `open()` runs, either capability returns `BLUE_CAPABILITY_ABSENT`. This normally indicates a mismatched Blue profile or a missing owner row. A plugin must not fall back to owner-only `blueSessionReader`, `blueSessionActions`, or raw Harness Session objects.
