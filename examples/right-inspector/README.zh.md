# Right Inspector 示例

这是一个 opt-in Blue 插件，向公开 `right` pane lane 贡献上下文检查器；
窄视口下由宿主将它降级到 `bottom`。

```sh
dsh plugin --profile blue-dev add @dsh-blue-example/right-inspector
```

pane 只使用公开 API/UI 包与共享示例 Kit；包 Fiber 卸载后贡献立即消失。
