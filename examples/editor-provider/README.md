# Editor provider example

An opt-in Experimental/reference editor shell candidate for Blue API
`1.0.0-beta.1`. It rearranges public shell metadata around exactly one
host-owned `editor-control`; it cannot read or replace the draft,
history, cursor, attachments, focus, or IME engine.

```sh
dsh plugin --profile blue-dev add @dsh-blue-example/editor-provider
```

Select it explicitly with `blue.editorProvider: example.editor.focused`.
Installation alone remains inert.
