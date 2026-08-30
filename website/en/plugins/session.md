# Read-only session data

The canonical Beta exposes two independent read-only capabilities: `session.read` for a bounded current-session summary, and `session.projections.read` for projection JSON owned by Host plugins. The Blue plugin host provides no generic write gateway; generic `session.act` has been removed from manifests, types, and the public facade.

| Capability | Field returned by `open()` | Exposed methods |
|---|---|---|
| `session.read` | `api.session` | `current()`, `subscribe()` |
| `session.projections.read` | `api.projections` | `current()`, `currentMany()`, `subscribe()` |

The public objects expose no Harness Agent or Session, event log, unscoped projection reader, or broad app action service. Requesting the removed `session.act` fails manifest/open validation; there is no compatibility fallback.

## Exact resources

A canonical manifest declares the fields and keys it needs. The host returns only data covered by the resulting grants:

```json
{
  "capabilities": {
    "required": [
      {
        "name": "session.read",
        "version": "^1.0.0",
        "resources": { "fields": ["identity", "status", "model"] }
      },
      {
        "name": "session.projections.read",
        "version": "^1.0.0",
        "resources": { "keys": ["costUsage", "contextTimeline"] }
      }
    ],
    "optional": []
  }
}
```

`session.read` accepts `identity`, `cwd`, `status`, `mode`, and `model`. The `identity` resource maps to `id` in the snapshot. `revision` and `sessionEpoch` are mandatory fencing metadata and cannot be removed through resource scoping. Projection keys are defined by the Host plugin that owns each projection; Blue does not redefine their schemas or domain meaning.

## Session snapshots

Canonical `current()` returns `BlueResult<BluePluginSessionSnapshot | null>`:

```ts
interface BluePluginSessionSnapshot {
  readonly revision: number
  readonly sessionEpoch: number
  readonly id?: string
  readonly cwd?: string
  readonly status?: 'idle' | 'running' | 'waiting' | 'failed'
  readonly mode?: 'normal' | 'plan' | 'yolo'
  readonly model?: {
    readonly id: string
    readonly provider?: string
    readonly effort?: string
  }
}
```

Only granted fields become own properties. Even when `model` is granted, it is omitted when no model is selected. The host copies and deeply freezes every snapshot. `null` means the owner is online with no active session; it never means the capability is missing.

Within one session epoch, the host accepts only increasing revisions. A same-id session may restart at a lower revision after its epoch advances. Old epochs, duplicate revisions, and callbacks arriving after the old owner unloads are rejected.

`subscribe(listener)` returns `BlueResult<BlueRegistration>` and synchronously replays the current result after its effect registration succeeds. The listener also receives `BlueResult<BluePluginSessionSnapshot | null>`. An owner gap produces `BLUE_CAPABILITY_ABSENT`; owner reload replays the current generation. Once the consumer Fiber unloads, retained facades permanently return `BLUE_ACTION_REJECTED`.

```ts
const opened = ctx.bluePluginHost.open(ctx, manifest)
if (!opened.ok || opened.value.session === undefined) return

const initial = opened.value.session.current()
if (initial.ok && initial.value !== null) {
  console.log(initial.value.sessionEpoch, initial.value.id, initial.value.status)
}

const subscribed = opened.value.session.subscribe(result => {
  if (!result.ok) return
  if (result.value !== null) console.log(result.value.revision, result.value.status)
})
if (!subscribed.ok) console.error(subscribed.code, subscribed.message)
```

## Projection cuts

`current(key)` returns one granted key as `BlueResult<BlueSessionProjectionSnapshot | null>`. `currentMany(keys)` obtains every key from one owner snapshot and returns a consistent cut:

```ts
interface BlueSessionProjectionCut {
  readonly sessionEpoch: number
  readonly asOfSeq: number
  readonly values: Readonly<Record<string, BlueJson>>
}
```

Each value must be finite, acyclic JSON. Accessors, sparse arrays, `undefined`, symbols, non-finite numbers, and cycles are rejected. The host detaches and deeply freezes every value. One value is limited to 262,144 encoded bytes and one complete cut to 1,048,576 bytes.

A missing or unloaded key returns `BLUE_CAPABILITY_ABSENT` without reusing an old value. An old epoch or lower `asOfSeq` returns `BLUE_STALE`. `subscribe(keys, listener)` replays one consistent cut after registration and reads a new cut only when one of those keys changes. Duplicate, stale, malformed, or late owner notifications never reach the listener.

```ts
const projections = opened.value.projections
if (projections !== undefined) {
  const cut = projections.currentMany(['costUsage', 'contextTimeline'])
  if (cut.ok && cut.value !== null) {
    console.log(cut.value.asOfSeq, cut.value.values.costUsage)
  }

  const subscribed = projections.subscribe(['costUsage'], result => {
    if (result.ok && result.value !== null) console.log(result.value.values.costUsage)
  })
  if (!subscribed.ok) console.error(subscribed.code, subscribed.message)
}
```

## Inline-manifest transition lane

The old flat `capabilities: ['session.read']` manifest retains its original inline-host reader shape for PR #77 compatibility. It does not expose `session.projections.read` and does not represent canonical v1 resource/epoch semantics. New plugins and R3 ecosystem adapters should use a canonical manifest with `$schema`, required/optional groups, and exact resources.

## Writes belong to the domain owner

When a feature needs followup, steer, interrupt, or another domain mutation:

- prefer the public Harness Cordis service, command, or feature action that owns the semantic operation;
- perform the write in the domain package and project a renderer-neutral result to the Blue adapter;
- when no public domain boundary exists, stop and propose one to the capability owner instead of reading package internals or copying Session state.

A plugin must not directly inject owner-only `blueSessionReader`, `blueSessionProjections`, `blueSessionActions`, or `bluePluginControl`, and must not unwrap `bluePluginHost` to obtain them. The default bundle isolates those unscoped services in its private runtime realm; public plugins use only manifest-scoped facades.
