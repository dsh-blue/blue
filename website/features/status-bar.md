# 状态栏

Footer 最多两行。所有内置与第三方 entry 都注册在同一个 `blueStatus`
service，并使用 renderer-neutral `BlueStatusNode`。

| Entry | Priority | 内容 |
| --- | --- | --- |
| basic | 0 | 当前 model |
| mode | 2 | plan/yolo 状态 |
| cwd | 5 | 当前工作目录 |
| git | 10 | branch 与变更摘要 |
| context | 20 | context 占用 |
| title | 30 | session title |

同 band 按 priority/id 排序；右侧 band 在宽度压力下先让位。Entry 自己声明
`row` 与 `overflow`，无法容纳时按低优先级隐藏。

第三方贡献：

```ts
export const inject = ['blueStatus']

export function apply(ctx: Context): void {
  ctx.blueStatus.register({
    id: 'acme.health',
    priority: 15,
    band: 'right',
    visible: true,
    node: { kind: 'text', content: 'healthy', tone: 'success' },
  })
}
```

Registration 随 Fiber 清理。详情见[插件状态栏](/plugins/status)。
