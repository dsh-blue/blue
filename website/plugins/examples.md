# 示例目录

仓库提供一个共享 UI kit 和五个可运行的普通 Cordis 插件：

| 包 | 直接依赖 | 展示 |
| --- | --- | --- |
| `blue-user-kit` | `blue-ui` library | 可复用 `defineBlueComponent` |
| `header` | `bluePanes` | header lane |
| `right-inspector` | `bluePanes` | right lane 与窄屏 bottom fallback |
| `bottom-log` | `bluePanes` | passive bottom lane |
| `overlay` | `commands`, `blueOverlays` | 原生 command 打开 capturing overlay |
| `ui-gallery` | `bluePanes` | 公共 node builder 展示 |

`@dsh-blue-example/blue-ecosystem` 通过五条普通 Cordis row 一次启用五个
runtime 示例：

```sh
dsh plugin --profile blue-examples add @dsh-blue/blue@alpha
dsh plugin --profile blue-examples add @dsh-blue-example/blue-ecosystem
dsh --profile blue-examples
```

示例证明 package entry、direct `inject`、renderer-neutral output、Fiber
unload、publish-shaped pack/install 和窄宽渲染。它们不进入 Blue 默认 bundle。
