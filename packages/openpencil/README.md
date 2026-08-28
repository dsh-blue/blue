# `@dsh-blue/blue-openpencil`

Optional renderer-neutral adapter for `@zseven-w/dsh-openpencil`. It observes official `tools/result` outcomes, converts Harness tool views at the domain boundary, and publishes bounded Blue tool presentation models whose call/result values are canonical `BlueUiNode` data, with canonical text or diff fallback.

The adapter never copies browser canvas state, Agent or Session objects, or signed editor capabilities from tool-result metadata. OpenPencil's headless tools continue to run when this adapter or Blue's renderer services are absent.
