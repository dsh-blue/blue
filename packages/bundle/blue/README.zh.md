# `@deepseek-ai/dsh-blue`

[English](README.md) | 中文

dsh Blue 组合包：交互式终端 UI profile。[`cordis.patch.yml`](cordis.patch.yml) 直接叠加在 [`dsh-base`](../base/README.md) 之上；通过 `dsh --profile blue` 选用（模板为 `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-blue']`）。patch 覆盖 `system-prompt` 的 persona、保持共享 HMR 行关闭，并插入五个 Blue 行：`blue-core`（全树唯一的 pi-tui 适配：终端生命周期与 `blueScreen`/`blueTheme`/`blueKeymap` 服务）、`blue-transcript`（会话事件渲染）、`blue-interaction`（输入编辑器、`/quit` 与 `/resume`、用户提问、审批）、`blue-startup`（`@deepseek-ai/dsh-blue-app/startup`，解析 `[task]` 与 `--resume <id>`）、`blue-app`（Agent 驱动，通过惰性 `!!js ctx.blueStartup.*` 配置插值读取启动值）。

## 模型体验

间接影响，通过被插入的行：本组合包只是 patch 列表的载体，除 patch 中引用的 persona 覆盖外，自身不贡献任何模型可见文本。

#### KV Cache 影响

persona 覆盖是静态前缀；各插入行的前缀影响由所属包各自承担。

## 已知限制与暂缓事项

- **尚无组装冒烟**：transcript 与 interaction 并行开发中，组合后的 profile 尚未端到端验证；`dsh --profile blue` 的 loader 冒烟在联调步骤落地。
