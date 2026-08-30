# `@dsh-blue/blue-interaction`

[English](README.md) | 中文

Blue 的输入、命令、对话框与通知层。它使用 `@dsh-blue/blue-core` 的 renderer contract 以及 app 所有的 session reader/action/projection 服务，不接收 Harness Agent 或 Session。

主插件挂载 prompt editor、keymap action、内置命令、question/approval panel、settings、provider onboarding、terminal title 更新与启动更新检查。可选 `displayVersion` 配置只用于标识专用验收 profile，不改变 release metadata。

## Editor

Prompt editor 支持多行编辑、history、slash command discovery、排队 follow-up 与 steer、interrupt/retraction、外部编辑，以及由 dialog 替换 editor slot。Up/Down 用于 editor history，滚轮与 PageUp/PageDown 用于滚动 transcript。`EditorHostService` 在单个 frontend tree 内拥有 renderer reference 与 submit transformer。`EditorModelService` 只暴露 readonly editor state 和结构化 set、submit、abort action。

Draft text、prompt/bash mode、history、command alias、settings/theme identity、models.dev cache、update state、file probe cache 以及图片粘贴 marker/cooldown 都由 `InteractionStateService` 持有。Theme swap 可重建 renderer child，而父级 service 继续存活；另一棵 Cordis tree 会得到完全独立的状态。

可选 `./editor-plus` 插件增加 `!` shell mode、slash completion、`@` 文件 mention 与 `#` skill completion。文件 mention 优先使用 `fd`/`fdfind`，不可用时走有界 filesystem fallback；可执行文件 probe 按 frontend tree 缓存。

公开 `editor.extensions` contribution 可以增加被动 row、hint、diagnostic、action、completion item 与异步 submit transform。Blue 在当前 interaction owner 主动调用前保持 registration 惰性，将公开 completion 与内置 slash/`@`/`#` source 合并，并围绕同一个 editor engine 重建 extension chrome。Submit transform 在 editor 清空前执行；transform abort、timeout、失败、unload，或已提交 follow-up 被安全撤回时，draft 与图片 attachment 都仍可恢复。Session 切换与 extension refresh 会拒绝迟到结果。

## 命令与 Panel

内置命令族覆盖项目初始化（`/init`）、会话导航与 rewind、help、theme、model 与 reasoning effort、provider、permission 与 preset、mode、status/context/version/changelog、export/copy、tool、skill、MCP、trace、settings 与 profile update。Effort panel 将 provider 提供的可选级别显示为一行 bracket 选项，并通过 Left/Right 移动高亮。命令读取不可变 snapshot 并调用 `blueSessionActions`，不会折叠 session event 或直接修改 Harness object。

插件市场保持暂停时，`/plugin` 只处理本地 profile。裸命令只显示已安装且发布
canonical Blue manifest 的依赖，并标出 compatible/incompatible/invalid；
`/plugin verify <package-or-directory>` 会真实运行公开静态校验器。安装只接受已存在的
本地目录或 tarball、精确 npm `package@version`，或锁到完整 commit 的 GitHub 源。
所有 mutation 都委托给 `dsh plugin`，重启后生效，不会替换当前运行中的 Cordis tree。

Dialog 替换 editor slot，并编译与插件 surface 相同的 renderer-neutral Blue UI node。Help/info window、list、form、settings、question、approval、model、loading state 与 plan review 因此共用 core 所有的 chrome、focus、语义颜色和窄宽收容。Question 与 approval 工作绑定 Fiber、支持 abort，并拒绝 unload 或会话切换后的迟到结果。第三方 renderer-neutral command、notification 与 editor extension 通过 `./plugin-host-bridge` 进入；它只在 owner Fiber 存活时宣告这些 capability，并会在替换后恢复 host 持有的 definition。私有 owner lease 会按 generation 约束 command dispatch 及 fulfilled/rejected settlement、editor callback 与 notification observation；保留的 stale handler 不会调用插件代码。Notification observer failure 与其它 observer、publisher result 相互隔离。

Blue 自有 interaction chrome 支持英文与简体中文。`/settings` 首行显示“语言”，通过 Harness 的 `locale.preference` 在“跟随系统”“中文”“English”之间循环；切换时会原地刷新已打开的 settings、help、approval、questionnaire、command model 与 slash completion，不替换 controller/editor、不丢选择，也不丢弃已打开 form 的草稿。用户/model/tool 内容、路径、id、命令名、provider/model 名与上游错误详情不翻译。

Form 将校验错误紧跟在失败字段下方，文本字段同时保留 Blue editor 的光标、IME 与 bracketed-paste 行为。Enter 在字段间前进或提交最后一个字段；Tab/Down 前进，Shift-Tab/Up 后退。Question panel 显示有界的答题进度，free-text 与 `Other` 共用同一种 canonical input，在切换问题时保留草稿，并支持 1-9 数字直选。

可读 export 在 flush 并读取 durable artifact 后使用官方 `blueConversation` projection；full export 则有意输出解码后的审计 event stream。`/copy` 使用官方 conversation 值与 OSC 52/native clipboard 管线。

`blue` settings namespace 会持久化两个独占 provider 选择：`statusProvider` 选择 footer，`editorProvider` 选择 editor shell；`blue.default` 使各自保持随包提供的默认实现。其他非空 id 即使对应 candidate 暂时缺失或失败也仍会保留，因此之后安装、修复或重载 provider 时可以继续满足原选择，无需回写 settings。

`./editor-provider-owner` 消费独占 editor shell 选择。Candidate 在被选中前保持 inert；选中后，Blue 会围绕同一个 editing engine，在实时宽度下校验并 dry-render，再原子替换内部 shell。Provider 切换会保留 draft、cursor、history、IME、attachment、focus、completion 与 submit transaction。非法或失败 candidate 会保留同会话可交互 shell，或回落 `blue.default`；重复失败会打开有界的 60 秒三次 breaker，且不保留 timer。

## 可选子路径

- `./editor-plus`：shell mode 与 completion。
- `./pane-queue`：随 inbox 变化即时刷新的 canonical 排队消息 bottom pane。
- `./mode-status`：从当前 mode snapshot 派生的 canonical footer status node。
- `./attachments`：有界 filesystem image store。
- `./paste-image`：原生 clipboard 图片/文件读取。
- `./command-model`：renderer-neutral command model 与执行 action。
- `./plugin-host-bridge`：公开 command/notification/editor-extension adapter。
- `./editor-provider-owner`：独占 editor shell 选择与事件 owner。

所有 registration、异步工作、screen child、alias 与 host contribution 都随所属 Fiber 释放。

## 模型体验

本包不添加 prompt prefix。只有用户明确提交的 editor 内容、回答、审批与命令会影响面向模型的会话。
