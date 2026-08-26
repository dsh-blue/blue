# `@dsh-blue/blue-api`

[English](README.md) | 中文

Blue Cordis 插件的稳定、renderer-independent 公共契约。本包不含任何 renderer、终端或 Harness 服务代码：它定义插件 manifest 格式、结构化 `BlueResult` 错误分类、renderer-neutral 的 `BlueView` 词汇，以及接纳第三方贡献的 `bluePluginHost` 服务。它还持有所有 Blue release 包对齐的 `BLUE_VERSION` 常量。

## Manifest 与 capability

插件声明一份静态 manifest——`{ id, api, capabilities }`——由 `validateBlueManifest` 在不执行插件代码的情况下校验。`api` 是针对宿主 `1.x` 线的 semver 范围。manifest 词汇共声明九个 capability：`commands`、`status`、`dock`、`notifications`、`tools`、`editor`、`panels`、`session.read` 与 `session.act`。

`bluePluginHost.open(consumer, manifest)` 先校验 manifest，再返回只暴露所请求表面的 capability-scoped `BluePluginApi`。所有 registration 都绑定消费者的 Cordis effect：插件卸载即释放全部贡献。跨消费者重复的 contribution id 会被拒绝，Blue 的 owner 命名空间（`blue.`、`blue:`、`blue-`、`@dsh-blue/`）被保留。

## 第一阶段开放的 capability

当前开放四个 capability：

- `commands`——带 label 与返回 `BlueResult` 的异步 `execute` 的 slash command。
- `status`——由 `BlueView` 渲染的 footer status 条目。
- `dock`——可选 priority 与行数预算的 dock pane view。
- `notifications`——发布与订阅 renderer-neutral 通知。

其余已声明的 capability（`tools`、`editor`、`panels`、`session.read`、`session.act`）按阶段门控：请求其中任何一个都会让 `open()` 以 `BLUE_CAPABILITY_DENIED` 失败。所有失败都以结构化 `BlueResult` 返回——插件错误绝不会以抛出对象的形式越过公共边界。
