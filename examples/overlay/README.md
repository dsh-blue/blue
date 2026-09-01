# Overlay example

An opt-in Blue plugin adding `/example-overlay` through native
`ctx.commands`. The command opens a capturing modal directly through
`ctx.blueOverlays`. The plugin contributes renderer-neutral body content
while Blue owns the modal's single closed frame.

```sh
dsh plugin --profile blue-dev add @dsh-blue-example/overlay
```

Unloading the package unregisters the command and closes its overlay with the
plugin Fiber.
