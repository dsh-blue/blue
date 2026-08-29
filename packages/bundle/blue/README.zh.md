# `@dsh-blue/blue`

[English](README.md) | 中文

dsh Blue 组合包：交互式终端 UI profile。[`cordis.patch.yml`](cordis.patch.yml) 直接叠加在 [`dsh-base`](https://github.com/deepseek-ai/deepseek-harness) 之上，共插入 32 条 Blue 自有行：2 条宿主支撑行，加上分为基线、增强、装配三段的 30 条产品行。locale runtime/settings adapter、projection-backed 的 `blue-conversation` 与 `blue-transcript-official` 已是 9 条自足基线的一部分；15 条增强行可逐项移除。`blue-context`、`blue-remote`、`blue-openpencil` 与 `blue-lark` 保持为 bundle 之外的 validation-only 包。

bundle 自己持有 Blue 的完整 Agent preset roster。标准、PTC 与极简模式跟随当前固定的 harness 版本；`cordis` / 创造模式携带认识 Blue 的 persona 与受能力约束的插件创作指导。无论通过 `blue` 还是直接 `dsh --profile` 启动，都会读取这份不可变的 bundle payload，不会改写宿主共享 preset。创造模式原型可以通过 `bluePluginHost` 增加 pane、status、command 与 notification 贡献，也可以注册 inert 的 `status.provider` 与 `editor.provider` candidate，或分别申请受限的 `session.read` 与 `session.act` facade；只有持久化的 `blue.statusProvider` 和 `blue.editorProvider` 用户选择能激活 provider candidate。原型不能解析 Blue 的 owner registry 或替换 core 功能 id。当前兼容 host 即使 frontend owner 缺位，也会接受并持久缓冲 command、status entry、pane、overlay、editor extension 与 provider candidate；它们在 owner 重放前保持 inert。`BLUE_CAPABILITY_ABSENT` 表示旧版或不兼容的 host/profile 缺少对应 durable buffer，或 notification/session 的 active owner 缺位。原型验收后，Agent 必须先询问用户是保留本地、创建 GitHub 仓库还是发布 npm 包。

## 模型体验

模型可见 persona 由当前 preset 提供。创造模式会明确说明自己运行在 Blue 中，并约束为“先做会话内原型、持久化前先询问”。

#### KV Cache 影响

fallback persona 是静态前缀；各插入行的前缀影响由所属包各自承担。

## 已知限制与暂缓事项

- **无已知的组合包级限制**——组合后的 profile 由全树 e2e 端到端覆盖，其中包含真实的动态 Cordis define/run/stop/update 链路；测试使用脚本化 mock LLM adapter 与 core 的录制型 FakeTerminal，仅替换模型与进程终端。
