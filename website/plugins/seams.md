# Seam 参考

## 什么是 Seam（缝）

**缝**是 Blue 的核心架构概念：**为替换与贡献而显式留出的接合面**。Blue 没有字面的 `Seam` 类型或 `registerSeam()` API——缝以五种代码形态落地：

1. **Cordis 服务 + 声明合并** —— `Service` 子类挂到 `Context` 上（`ctx.blueScreen`、`ctx.blueStatus` ……），插件注入即用；
2. **registry + disposer** —— `register(entry): () => void`，重复 id 抛错；插件 fiber 卸载自动回滚（"注册即 effect"）；
3. **provider 替换** —— 单一活跃 provider（如主题），换装时 Cordis 自动 reload 所有注入方；
4. **模块级缝** —— 跨插件共享单例（如共享编辑器），经事件感知挂载与重挂；
5. **子路径插件 + patch 行** —— 每条增强是包的 subpath export，组合层用 `cordis.patch.yml` 行启停（零代码定制）。

每条缝上的角色分三份：**definition**（契约归宿主包）、**provider / contributor**（实现或贡献者，plain 默认是第一个注册者）、**consumer**（消费方，只依赖契约不依赖实现）。这就是"一切皆插件"能成立的机制底座——你的插件和 Blue 内置增强走的是同一批缝。

## Blue 自有缝

下游插件只允许 import 文档化契约与子路径，不得 import Blue 包内部模块：

| 缝 | 入口 | 契约 | plain 默认 | 你能做什么 |
| --- | --- | --- | --- | --- |
| 屏幕挂载 | `ctx.blueScreen` | `BlueScreen` / `BlueComponent` | —（核心能力） | 挂组件（`addChild` 返回 disposer）、弹 overlay、`setFocus`、请求重绘 |
| 键位注册 | `ctx.blueKeymap` | `BlueKeymap` / `BlueKeyAction` | — | 注册语境/全局快捷键；冲突在注册期暴露，不运行时抢键 |
| 组件工厂 | `ctx.blueComponents` | `BlueComponents` | — | 造 editor/markdown/select/image 组件 + 宽度/模糊纯函数，全程不碰 pi-tui |
| 终端事实 | `ctx.blueTerminalInfo` | `BlueTerminalInfo` | — | 读 OSC 11 背景探测与键盘协议能力 |
| 主题 | `blueTheme` provider 替换 | `BlueTheme`（28 token 调色板） | `blue-theme-dark` | 提供整套调色板；`/theme` 热切换，依赖方自动 reload |
| 状态栏 | `ctx.blueStatus` | `BlueStatus` / `BlueStatusEntry` | `blue-status-basic` | 注册 footer 条目（priority / row / align） |
| 渲染意图 | `ctx.blueIntents` | `BlueIntents` / `BlueIntentEntry` | generic 工具卡 | 为新工具类型提供定制卡片（diff、terminal 卡即此缝） |
| 会话事实 | `ctx.blueSession` + 事件 | `BlueSession` + `blue/session-changed` 等 | — | 读当前 Agent、跟踪会话切换、发起 resume/new/fork |
| 共享编辑器 | 模块级 `editor-instance` + `blue/input-editor-changed` 事件 | `SharedEditor` / `SubmitTransformer` | 工厂 plain 编辑器 | 叠补全 provider、`onKey` 按键拦截、`insertText`、提交变换器 |
| chrome 辅助 | `@dsh-blue/blue-core/chrome` 子路径 | 纯函数（不经服务） | — | 主题无关的框/规则/提示绘制（`framePanel`、`topRule`……），色函数由调用方注入 |
| 组合 | `cordis.patch.yml` 行 | — | 基线 8 行 | 零代码启停、重排任何插件行 |

## 继承自 harness 的缝

harness（dsh-base）开的缝，对你的插件同样开放：

| 缝 | 用途 |
| --- | --- |
| `ctx.commands.register` | 注册斜杠命令，自动进入编辑器补全菜单与 `/help` |
| `ctx.userQuestions.registerProvider` | 接管提问交互（问卷面板） |
| `'approval/request'` waterfall | 审批应答（不调 `next()` 即短路） |
| `attachments`（`AttachmentStore`） | 附件存储——rc.8 是纯缝，实现由 Blue 的 `blue-attachments` 提供，你的插件可消费 |
| `ctx.tools` / `ctx.agents` / `ctx.sessions` | 工具注册/守卫、会话与 agent 操作 |

harness 侧 `permissionPresets`、`sessionProjections` 等缝 rc.8 尚未开放——开放后 Blue 会同步适配呈现。

## 设计纪律

1. 每条缝：契约归宿主包、注册返回 disposer、plain 默认是第一个注册者、未知输入回退 plain；
2. 新缝只在首个真实消费者出现时开，不为假想需求开缝；P3 冻结签名；
3. 下游只依赖文档化缝与契约包，不得 import Blue 包内部模块；
4. plain-first：Blue 自家增强与下游插件同权经缝注册；基线拔掉全部增强行后仍完整可用。

::: tip 工程视角的完整清单
契约的源码位置、每条缝由哪个文件实现、与 patch 全表的逐行映射，见仓库内的工程文档 [`docs/blue-seams.md`](https://github.com/dsh-blue/blue/blob/master/docs/blue-seams.md)（中文）。
:::
