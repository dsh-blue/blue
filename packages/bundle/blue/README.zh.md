# `@dsh-blue/blue`

[English](README.md) | 中文

dsh Blue 组合包：交互式终端 UI profile。[`cordis.patch.yml`](cordis.patch.yml) 直接叠加在 [`dsh-base`](https://github.com/deepseek-ai/deepseek-harness) 之上，分三段插入 27 条 Blue 行。plain 基线保持自足，增强行可逐项移除。frontend-runtime 的 `blue-context` 以及生态 adapter `blue-openpencil`/`blue-lark` 在专用 profile 人工验收前默认禁用。OpenPencil 只投影官方 tool result 且丢弃签名 editor metadata；Lark 通过官方 command 注册 status/retry，不保存 credentials。

## 模型体验

间接影响，通过被插入的行：本组合包只是 patch 列表的载体，除 patch 中引用的 persona 覆盖外，自身不贡献任何模型可见文本。

#### KV Cache 影响

persona 覆盖是静态前缀；各插入行的前缀影响由所属包各自承担。

## 已知限制与暂缓事项

- **无已知的组合包级限制**——组合后的 profile 由全树 e2e 端到端覆盖（`tests/e2e.spec.ts`，72 个用例：启动、任务执行、输入路由、审批 overlay（含 session 级放行记忆）、tab 化问卷、编辑器键语义、resume、`/theme` 调色板换装（含草稿保留与转录重渲染）、四个 dock pane、`/help`、`/sessions` + `/new` + `/fork`、`/btw`、diff 卡、terminal 卡（含 exit 徽章）、图片粘贴以图片块传递、step-summary 渲染、S23 模型族——picker 元数据与段控件草稿、session-only 与持久默认、resume 的 header 层、`/provider` 列表/切换、以及走真 settings/credentials/pi-ai 栈与 fixture 发现端点的 Add Provider 向导、卸载），使用脚本化 mock LLM adapter 与 core 的录制型 FakeTerminal——仅模型与进程终端被替换。
