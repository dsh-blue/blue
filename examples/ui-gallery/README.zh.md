# UI Gallery 示例

这是一个 opt-in Blue 插件，通过公开 `right` pane lane 静态展示
`@dsh-blue/blue-ui` 的全部公开 builder。Content、Layout、Patterns 三组演示
位于 tab strip 之下，在窄视口下按策略降级到 bottom lane。

```sh
dsh plugin --profile blue-dev add @dsh-blue-example/ui-gallery
```

包内自带单行 `cordis.patch.yml`，安装即激活；卸载时 pane 随 Cordis Fiber
一同清理。
