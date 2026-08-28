# Header pane example

An opt-in Blue plugin that places a compact workspace summary in the public
`header` pane lane. It consumes `@dsh-blue-example/user-kit` and degrades to
hidden when the viewport is narrow.

```sh
dsh plugin --profile blue-dev add @dsh-blue-example/header
```

The package ships its own one-row `cordis.patch.yml`, so adding it activates
the plugin. Uninstalling it removes the pane with its Cordis Fiber.
