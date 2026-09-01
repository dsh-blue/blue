# 插件市场

Blue `0.2.0-alpha.1` 插件是普通 Cordis npm package。它直接使用 dsh
service，并按需注入 `bluePanes`、`blueStatus`、`blueOverlays` 或
`blueEditorExtensions`。

安装一个插件：

```sh
dsh plugin --profile blue add <npm-package>
dsh --profile blue
```

市场条目必须指向可独立安装的 package，明确注入的 service、支持的
Blue/Harness/Node 版本、主要工作流、unload 行为与验证证据。开发入口见
[快速开始](/plugins/quickstart)。
