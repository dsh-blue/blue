# Example catalog

The repository contains one shared UI kit and five runnable ordinary Cordis
plugins:

| Package | Direct dependency | Demonstrates |
| --- | --- | --- |
| `blue-user-kit` | `blue-ui` library | reusable `defineBlueComponent` |
| `header` | `bluePanes` | header lane |
| `right-inspector` | `bluePanes` | right lane and narrow bottom fallback |
| `bottom-log` | `bluePanes` | passive bottom lane |
| `overlay` | `commands`, `blueOverlays` | native command opening a capturing overlay |
| `ui-gallery` | `bluePanes` | public node builders |

`@dsh-blue-example/blue-ecosystem` activates all five runtime examples
through five ordinary Cordis rows:

```sh
dsh plugin --profile blue-examples add @dsh-blue/blue@alpha
dsh plugin --profile blue-examples add @dsh-blue-example/blue-ecosystem
dsh --profile blue-examples
```

The examples prove package entries, direct `inject`, renderer-neutral output,
Fiber unload, publish-shaped pack/install, and narrow-width rendering. They
are not part of Blue's default bundle.
