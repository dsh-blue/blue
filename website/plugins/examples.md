# 示例目录

仓库 `examples/` 提供一个共享用户 kit、六个可运行的 opt-in 插件，以及一个把
六行组合在一起的验证 bundle。它们是可打包发布的参考实现，但不进入 Blue 默认
bundle 或当前 release set。

::: warning 示例的契约层级
这六个运行插件来自 PR #77，`blue.plugin.json` 仍走旧 flat transition lane；两个
provider 也只属于 Experimental/reference。它们证明 public UI、打包、生命周期和宽度
行为，但**不是** P1 canonical manifest 模板。新插件的 manifest 只从
[快速开始](/plugins/quickstart)复制。
:::

| 包 | Capability | 证明的契约 |
| --- | --- | --- |
| `@dsh-blue-example/user-kit` | 无 | 纯组件 library；被两个插件共同依赖，安装不贡献 UI |
| `@dsh-blue-example/header` | `panes` | header lane、共享 kit、窄屏隐藏、Fiber unload |
| `@dsh-blue-example/right-inspector` | `panes` | right lane、共享 kit、窄屏降级到 bottom |
| `@dsh-blue-example/bottom-log` | `panes` | 被动 bottom pane，无 timer 或后台 reader |
| `@dsh-blue-example/overlay` | `commands`, `overlays` | `/example-overlay`、capturing gesture、关闭与 late-use containment |
| `@dsh-blue-example/status-provider` | `status.provider` | inert 候选；安装不选中、不写 settings |
| `@dsh-blue-example/editor-provider` | `editor.provider` | inert shell；恰好一个宿主 `editor-control` |

每个可运行插件都带 `blue.plugin.json`、单行 `cordis.patch.yml` 与公开构建入口。
`@dsh-blue-example/blue-ecosystem` 的 patch 按上表顺序装配六行；它不是第八个
运行场景。

## 使用方式

在源码 checkout 中可以把单个包 link 到专用 profile：

```sh
pnpm run build
dsh plugin --profile blue-examples add link:/path/to/blue/examples/header
dsh --profile blue-examples
```

也可以安装 composition bundle，一次激活六个插件。先确保同一 profile 已安装
Blue，再添加 `examples/blue-ecosystem` 的 link 或 packed tarball。示例包目前用于
契约验证，不要假定它们已发布到 npm registry。

Status/editor provider 安装后仍保持 inert。只有用户在 `settings.yaml` 显式选择
`example.status.compact` 或 `example.editor.focused` 才会激活；切回 `blue.default`
恢复内置实现。插件本身不得改写这些设置。

## 验证证据

```sh
pnpm check:examples
```

门禁先对八个 package 运行兼容 validator，再分别对当前与上一条 Harness 线：

- `pnpm pack` API、UI、core、kit、六个插件与 composition；
- 安装进一个无 workspace link 的临时 npm 项目；
- 只从安装后的 public exports 导入；
- 校验 transition manifest、单行 patch、六行 composition、无 `src/` 与本地协议泄漏；
- 执行八个场景和 20/40/80/120 列宽度扫描；
- 要求 `declared === executed === 8`、零 skipped/failure 且临时目录已清理。

开发自己的插件时从[快速开始](/plugins/quickstart)复制最小骨架，再按
[公共 UI Kit](/plugins/ui-kit)抽取共享组件。
