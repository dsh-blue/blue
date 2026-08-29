# Header Pane 示例

这是一个 opt-in Blue 插件，通过公开 `header` pane lane 显示紧凑的工作区
摘要。它消费 `@dsh-blue-example/user-kit`，在窄视口下按策略隐藏。

```sh
dsh plugin --profile blue-dev add @dsh-blue-example/header
```

包内自带单行 `cordis.patch.yml`，安装即激活；卸载时 pane 随 Cordis Fiber
一同清理。
