# Plugin marketplace

A Blue `0.2.0-alpha.1` plugin is an ordinary Cordis npm package. It consumes
dsh services directly and optionally injects `bluePanes`, `blueStatus`,
`blueOverlays`, or `blueEditorExtensions`.

Install a plugin:

```sh
dsh plugin --profile blue add <npm-package>
dsh --profile blue
```

A marketplace entry points to an independently installable package and states
its injected services, supported Blue/Harness/Node versions, primary workflow,
unload behavior, and verification evidence. Start with the
[quickstart](/en/plugins/quickstart).
