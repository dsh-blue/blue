# Blue example user kit

A publish-shaped, renderer-neutral component kit shared by the header and
right-inspector examples. It requests no Blue capability and imports neither
Cordis nor a renderer.

```ts
import { summaryMetric } from '@dsh-blue-example/user-kit'

const node = summaryMetric.render({ label: 'Context', value: '42%', detail: '12k / 28k' })
```

Consumers still request their own `panes`, `overlays`, or provider capability;
installing this kit alone cannot contribute UI.
