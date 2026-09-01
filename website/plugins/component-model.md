# 组件模型

插件向 Blue service 提交 renderer-neutral definition，definition 的
`render()` 返回 canonical `BlueUiNode`。

```text
领域状态 / dsh projection
          │
   同步 render()
          │
     BlueUiNode
          │
 core admission + compile
          │
      pi-tui component
```

插件拥有领域状态与 definition；Blue registry 拥有当前 registration；core
拥有编译后的 component、focus、layout 与 width。

规则：

- render 只读取已经准备好的状态，不做 I/O；
- node 是数据，不携带 Agent、Session、terminal width 或 renderer object；
- 交互通过 surface 的 `onEvent(event, context)`，context 提供 AbortSignal 与
  revision；
- 状态变化后调用 registration 的 `refresh()`；
- Fiber unload 移除 definition，迟到异步结果不再生效；
- 每个可见组件必须在 20/40/80/120 列下保持宽度边界。

节点字段见 [UI 节点参考](/plugins/ui-reference)。
