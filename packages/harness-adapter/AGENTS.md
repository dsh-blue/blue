# `@dsh-blue/blue-harness-adapter`

F2 compatibility layer. It depends only on documented, narrow source interfaces and Blue public contracts. The five adapters are independently removable: session, projection, action, model, and question/approval. Capability probing returns explicit absent results. Every attach, action, subscription, and timer is scoped to an adapter instance and must be disposed before a session switch.

Removal conditions are recorded per adapter in its source module: delete the bridge when the corresponding Harness capability exposes the same snapshot/watermark and structured action contract.
