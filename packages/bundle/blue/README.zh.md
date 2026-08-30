# `@dsh-blue/blue`

[English](README.md) | 中文

dsh Blue 组合包：交互式终端 UI profile。[`cordis.patch.yml`](cordis.patch.yml) 直接叠加在 [`dsh-base`](https://github.com/deepseek-ai/deepseek-harness) 之上，共插入 33 条 Blue 自有行：2 条宿主支撑行、1 条私有 runtime composition group，加上分为基线、增强、装配三段的 30 条产品行。私有 group 隔离 management authority 与 raw app session/projection/action service，同时保留公共 `bluePluginHost` facade。locale runtime/settings adapter、projection-backed 的 `blue-conversation` 与 `blue-transcript-official` 已是 9 条自足基线的一部分；15 条增强行可逐项移除。`blue-context`、`blue-remote`、`blue-openpencil` 与 `blue-lark` 保持为 bundle 之外的 validation-only 包。

bundle 自己持有 Blue 的完整 Agent preset roster。标准、PTC 与极简模式跟随当前固定的 harness 版本；`cordis` / 创造模式携带认识 Blue 的 persona 与受能力约束的插件创作指导。无论通过 `blue` 还是直接 `dsh --profile` 启动，都会读取这份不可变的 bundle payload，不会改写宿主共享 preset。创造模式原型以 API `1.0.0-beta.1` 为目标，可以通过 `bluePluginHost` 增加 pane、status、command、overlay 与 publish-only notification 贡献，或申请按字段/键授权的 readonly `session.read` 与 `session.projections.read` 数据。editor extension 与 status/editor provider 仅保留为 Experimental/reference facet；只有 Blue 持有的持久化设置能激活 provider candidate。原型不能解析 `bluePluginControl`、raw session/projection/action service、owner registry 或替换 core 功能 id。当前兼容 host 会跨 owner gap 持久缓冲 definition-style registration，但绝不排队或 replay notice、overlay、gesture、action 与旧 callback result。原型验收后，Agent 必须先询问用户是保留本地、创建 GitHub 仓库还是发布 npm 包；随后可直接调用已安装的 `blue-plugin` 机器 catalog、canonical 本地生成器、validator 与当前/上一 Harness packed conformance，无需 Blue checkout。

## 模型体验

模型可见 persona 由当前 preset 提供。创造模式会明确说明自己运行在 Blue 中，并约束为“先做会话内原型、持久化前先询问”。

#### KV Cache 影响

fallback persona 是静态前缀；各插入行的前缀影响由所属包各自承担。

## 已知限制与暂缓事项

- **无已知的组合包级限制**——组合后的 profile 由全树 e2e 端到端覆盖，其中包含真实的动态 Cordis define/run/stop/update 链路；测试使用脚本化 mock LLM adapter 与 core 的录制型 FakeTerminal，仅替换模型与进程终端。
