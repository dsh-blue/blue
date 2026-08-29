# Blue 示例用户 Kit

这是由 header 与 right-inspector 示例共用的可发布形态、renderer-neutral
组件库。它不申请任何 Blue capability，也不导入 Cordis 或具体 renderer。

```ts
import { summaryMetric } from '@dsh-blue-example/user-kit'

const node = summaryMetric.render({ label: 'Context', value: '42%', detail: '12k / 28k' })
```

消费插件仍须自行申请 `panes`、`overlays` 或 provider capability；单独安装
本 Kit 不会向界面贡献任何内容。
