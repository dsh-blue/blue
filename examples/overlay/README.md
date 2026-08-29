# Overlay example

An opt-in Blue plugin adding `/example-overlay`. The command opens a capturing
modal only when Blue supplies an active, one-shot user gesture. The plugin
contributes renderer-neutral body content while Blue owns the modal's single
closed frame.

```sh
dsh plugin --profile blue-dev add @dsh-blue-example/overlay
```

Direct or retained calls are rejected, and unloading the package closes the
overlay and invalidates its retained host API facade.
