# Status Provider 示例

这是一个可替换完整 Blue footer 的 opt-in 候选。安装不会激活它，也不会修改
settings。

```sh
dsh plugin --profile blue-dev add @dsh-blue-example/status-provider
```

通过 `blue.statusProvider: example.status.compact` 显式选择；选择
`blue.default` 可恢复内置 additive footer。
