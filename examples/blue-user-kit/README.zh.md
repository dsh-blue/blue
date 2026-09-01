# Blue 示例用户 Kit

这是由 header 与 right-inspector 示例共用的可发布形态、renderer-neutral
组件库。它不导入 Cordis 或具体 renderer。

```ts
import { summaryMetric } from '@dsh-blue-example/user-kit'

const node = summaryMetric.render({ label: 'Context', value: '42%', detail: '12k / 28k' })
```

消费插件自行向 `bluePanes` 或 `blueOverlays` 注册贡献；单独安装本 Kit
不会改变界面。
