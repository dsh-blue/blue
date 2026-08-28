# `@dsh-blue/blue-harness-adapter`

F2 compatibility layer. It depends only on documented, narrow source interfaces and Blue public contracts. The six adapters are independently removable: session, projection, action, model, question/approval, and locale. Capability probing returns explicit absent results. Every attach, action, subscription, and timer is scoped to an adapter instance and must be disposed before a session switch.

Removal conditions are recorded per adapter in its source module: delete the bridge when the corresponding Harness capability exposes the same snapshot/watermark and structured action contract.
`ProjectionBridge.attach` treats snapshot loader failures as structured `BLUE_ACTION_REJECTED` results and always aborts/disposes the subscription before replacing a session. This is the adapter boundary used by context and remote fixtures.
`AdapterCapabilityAbsentError` carries action-level absence through async source methods; `SessionBridge.request` maps it to `BLUE_CAPABILITY_ABSENT` while retaining ordinary handler failures as `BLUE_ACTION_REJECTED`.

`./locale` owns the removable Harness settings bridge for the official `locale.preference` wire shape. An absent preference follows `LC_ALL` -> `LC_MESSAGES` -> `LANG` -> `Intl`; every `zh-*` variant maps to `zh`, while unsupported/C/POSIX locales fall back to `en`. The adapter mounts one `BlueLocaleService` per frontend tree, follows live settings updates, and returns to the system locale when the settings provider unloads. Delete it when Harness publishes a renderer-neutral locale service with equivalent detection, live-update, and unload contracts.
