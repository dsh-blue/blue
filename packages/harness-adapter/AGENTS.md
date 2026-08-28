# `@dsh-blue/blue-harness-adapter`

F2 compatibility layer. It depends only on documented, narrow source interfaces and Blue public contracts. The five adapters are independently removable: session, projection, action, model, and question/approval. Capability probing returns explicit absent results. Every attach, action, subscription, and timer is scoped to an adapter instance and must be disposed before a session switch.

Removal conditions are recorded per adapter in its source module: delete the bridge when the corresponding Harness capability exposes the same snapshot/watermark and structured action contract.
`SessionBridge.reader` is a frozen `current`/`subscribe`-only facet and `SessionBridge.requester` is a frozen `request`-only facet. The class retains the same methods for remote compatibility, but public `session.read` and `session.act` owner attachments must use the strict facets instead of the combined class object.
`ProjectionBridge.attach` treats snapshot loader failures as structured `BLUE_ACTION_REJECTED` results and always aborts/disposes the subscription before replacing a session. This is the adapter boundary used by context and remote fixtures.
`AdapterCapabilityAbsentError` carries action-level absence through async source methods; `SessionBridge.request` maps it to `BLUE_CAPABILITY_ABSENT` while retaining ordinary handler failures as `BLUE_ACTION_REJECTED`.
