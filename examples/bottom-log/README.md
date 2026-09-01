# Bottom log example

An opt-in Blue plugin that contributes a small passive activity log to the
public `bottom` pane lane.

```sh
dsh plugin --profile blue-dev add @dsh-blue-example/bottom-log
```

It has no timer or background reader; a real plugin would update domain state
outside `render()` and call the pane registration's `refresh()`.
