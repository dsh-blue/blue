# 插件市场

`0.1.2-alpha.1` 提供七项 Public Beta capability 的机器契约与 Host admission，并只支持 Harness `0.1.2-alpha.2`：
`commands`、`status`、`panes`、`overlays`、`notifications.publish`、
`session.read` 和 `session.projections.read`。

开发插件请从[快速开始](/plugins/quickstart)创建 canonical
`blue.plugin.json`，并用已发布的 `blue-plugin validate/conformance` 按
[调试与验证](/plugins/testing)完成免 checkout 验证。TUI 目录是随 Blue 发布的有界
元数据索引，不是市场 Service，也不开放收录。

## 收录

市场开放收录，流程见[收录指南](/marketplace/submit)：新收录以「未验证」状态进入，
完成兼容性验收后由维护者转为「已验证」。已经安装旧市场插件的用户，应先保留在
原 Blue 版本，待插件完成迁移后再升级。

## 状态图例

市场中的每个插件处于三种收录状态之一：

- **已验证**：通过 canonical manifest 与当前 Harness 线的兼容性验证，可在
  TUI `/plugin` 面板一键安装，也可使用卡片上的 CLI 命令安装。
- **未验证**：可通过 CLI 命令安装，但未完成完整兼容性验证，不保证完全兼容。
- **适配中**：已与开发者达成合作，正在适配当前 Harness 线，暂不提供安装；
  卡片附跟踪 issue，可查看适配进度。

注册表迁移期间，旧 `verified` 布尔标记不构成 alpha 兼容性证据，收录状态以
`status` 字段为准。

<MarketplaceGrid />
