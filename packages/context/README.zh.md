# `@dsh-blue/blue-context`

无渲染器依赖的 dsh-context interaction adapter 与 `/context` model。它读取 Harness 官方 session-projection service 的 `contextTimeline`、`contextPressure`、`contextBreakdown` 和 `tokenUsage`，把同一 seq 的多 key push 合并为一致切片，并跟随 Blue 当前 session，不对外暴露 Agent 或 Session 对象。

model 包含 provider usage、context occupancy、composition、当前 surface 分类以及最近的 request/context event。它的 panel node 与 provider-status node 都使用公开的 canonical `BlueUiNode` contract，不再定义 context 专属 view 词汇表。projection key 可独立卸载；下一次官方切片会移除对应 section 和 capability。兼容 source 仍可提供结构化 refresh action。该包不依赖 terminal 或 renderer。
