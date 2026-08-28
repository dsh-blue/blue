# Status provider example

An opt-in candidate that can replace the complete Blue footer. Installation
does not activate it or modify settings.

```sh
dsh plugin --profile blue-dev add @dsh-blue-example/status-provider
```

Select it explicitly with `blue.statusProvider: example.status.compact`.
Choose `blue.default` to restore the built-in additive footer.
