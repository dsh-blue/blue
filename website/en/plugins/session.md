# Read-only session data

The current Beta exposes only `session.read`. A plugin may read and subscribe to a bounded current-session summary, but it cannot write through the Blue plugin host. Generic `session.act` has been removed from manifests, types, and the public facade. Domain writes continue through their owning Harness Cordis service, Harness command, or feature-owned action.

| Capability | Field returned by `open()` | Exposed methods |
|---|---|---|
| `session.read` | `api.session` | `current()`, `subscribe()` |

The public object exposes no Harness Agent/Session object, event log, raw projection reader, or broad app action service. Requesting the removed `session.act` fails manifest/open validation; there is no compatibility fallback.

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

The host copies and deeply freezes each snapshot, including nested `model` data. `revision` increases monotonically when the app owner publishes new state. The host ignores duplicate or regressing revisions in one owner generation and drops callbacks arriving after an old owner unloads.

`subscribe(listener)` registers before synchronously replaying the current value, so a reentrant publication during subscription cannot be missed. Its `BlueRegistration` is idempotently disposable, and consumer Fiber unload also removes the subscription.

If the owner bridge is inactive when `open()` runs, `open()` returns `BLUE_CAPABILITY_ABSENT`. A reader that was already opened observes `null` during an owner reload, then receives the current snapshot from the new generation; it never reuses an old session value. A retained facade stays permanently fenced after its consumer unloads.

```ts
export const inject = ['bluePluginHost']

export function apply(ctx) {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'com.example.session-badge',
    api: '^1.0.0-beta.1',
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

## Writes belong to the domain owner

Blue provides no generic session write gateway. When a feature needs followup, steer, interrupt, or another domain mutation:

- prefer the public Harness Cordis service, command, or feature action that owns the semantic operation;
- perform the write in the domain package and project a renderer-neutral result to the Blue adapter;
- when no public domain boundary exists, stop and propose one to the capability owner instead of reading package internals or copying Session state.

A plugin must not directly inject owner-only `blueSessionReader`, `blueSessionProjections`, `blueSessionActions`, or `bluePluginControl`, and must not unwrap `bluePluginHost` to obtain them. The default bundle isolates those services in its private runtime realm; public `session.read` is the only executable session facade in the current Beta.
