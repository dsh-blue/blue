# Editor 缝走查：四个角色

输入编辑器是走通 Blue 哲学最清晰的一条路径。（本文自 README 抽出独立维护，2026-08-21；README 只保留速览。）

四个角色、四个位置，层间没有捷径：

**1. 契约（L1）。** `BlueEditor` 是 `packages/core/src/types.ts:437` 里的接口——刻意不含任何 pi-tui 类型、任何 harness 类型：

```ts
export interface BlueEditor extends BlueFocusable {
  onSubmit?: ((text: string) => void) | undefined
  onChange?: ((text: string) => void) | undefined
  onKey?: ((data: string) => boolean) | undefined   // 前置拦截钩子
  getText(): string
  setBorderColor(color: BlueColorFn): void
  setGhostHint(hint: string | undefined): void
  setAutocompleteProvider(provider: BlueAutocompleteProvider): void
  insertText(text: string): void                    // 光标处原子插入
  getExpandedText(): string                         // 粘贴标记展开，提交时使用
  // …
}
```

**2. 实现（L0）。** 获得编辑器的唯一入口是 `ctx.blueComponents.createEditor()`（`packages/core/src/types.ts:655`）。core 内部，`EditorAdapter`（`packages/core/src/components.ts:162`）包装 pi-tui `Editor`，每次 render 后经 chrome 辅助层后处理，画出圆角框、提示符与幽灵提示。适配器是唯一知道背后是 pi-tui 的代码；未来的 vim 模式编辑器可以实现同一接口，消费者毫无感知。

**3. 消费（interaction）。** `blue-input` 创建并挂载编辑器，再通过 frontend-tree-scoped `EditorHostService` 发布 editor、slot replacement、submit transformer 与 enhancement presence；`blue/input-editor-changed` 只通知同一 tree 的后挂插件，不存在 module singleton。

**4. 增强（interaction 子路径插件）。** `blue-editor-plus` 经 `EditorHostService` 叠 `!` bash 模式与 slash/`@` 补全 provider；`blue-paste-image` 拦截 Ctrl-V、插入 `[image #N]` 标记并注册可回滚 submit transformer。两者都不持有跨 tree 状态，可以单独删除。

契约在 L1、实现锁在 L0、增强经缝在 L2——这就是"凡表面皆插件"在实践中的含义。完整清单——Blue 开的每条缝、契约位置、plain 默认、每个视觉表面由哪个插件实现——见 [blue-seams.md](./blue-seams.md)。
