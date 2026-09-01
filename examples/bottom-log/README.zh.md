# Bottom Log 示例

这是一个 opt-in Blue 插件，向公开 `bottom` pane lane 贡献小型被动活动日志。

```sh
dsh plugin --profile blue-dev add @dsh-blue-example/bottom-log
```

示例没有 timer 或后台 reader；真实插件应在 `render()` 之外更新 domain 状态，
再调用 pane registration 的 `refresh()`。
