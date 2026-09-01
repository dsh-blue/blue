# 创造模式实战

`blue-cordis` preset 可以用动态 Cordis tool 在当前进程热挂载原型。原型仍是
普通 Cordis plugin，直接访问当前 service graph。

流程：

1. `cordis_inspect_list` 列出当前 service/event/tool provider。
2. 查询计划使用的精确 method schema。
3. `cordis_define` 定义带 `name / inject / apply(ctx)` 的 host package。
4. `cordis_run` 激活；修改时定义新 immutable package 并 `update`。
5. `cordis_stop` 暂停，`cordis_undefine` 删除。
6. 用户接受后，再询问 local/GitHub/npm/ephemeral，不能擅自持久化。

```js
return {
  name: 'health-probe',
  inject: ['commands', 'blueOverlays'],
  apply(ctx) {
    ctx.commands.register({
      name: 'health-probe',
      description: 'Open health',
      handler() {
        ctx.blueOverlays.open({
          id: 'probe.health',
          capturing: true,
          render: () => ({ kind: 'text', content: 'healthy' }),
        })
        return { kind: 'success', text: 'opened health' }
      },
    })
  },
}
```

Dynamic `code.host` 是普通 JavaScript function body，不能 import/require 或
写 TypeScript。原型在 restart 后消失。持久化时使用普通 package.json、
compiled entry 与 cordis.patch.yml。
