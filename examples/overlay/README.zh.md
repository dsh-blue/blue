# Overlay 示例

这是一个提供 `/example-overlay` 的 opt-in Blue 插件。只有 Blue 为当前用户
操作提供有效、一次性的 user gesture 时，命令才会打开 capturing modal。插件
只贡献 renderer-neutral 内容，modal 的单一闭合边框由 Blue 统一绘制。

```sh
dsh plugin --profile blue-dev add @dsh-blue-example/overlay
```

直接调用或保留后重用都会被拒绝；包卸载会关闭 overlay，并使保留的 host API
facade 失效。
