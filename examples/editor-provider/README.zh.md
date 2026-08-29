# Editor Provider 示例

这是一个面向 Blue API `1.0.0-beta.1` 的 Experimental/reference opt-in
editor shell 候选。它只在唯一的宿主 `editor-control` 周围重排公开 shell
元数据，不能读取或替换 draft、history、cursor、attachment、focus 或 IME engine。

```sh
dsh plugin --profile blue-dev add @dsh-blue-example/editor-provider
```

通过 `blue.editorProvider: example.editor.focused` 显式选择；仅安装保持 inert。
