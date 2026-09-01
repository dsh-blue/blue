# 快速开始

## 目录

```text
build-health/
├── package.json
├── tsconfig.json
├── src/index.ts
└── cordis.patch.yml
```

使用你惯用的 TypeScript build 工具。运行时需要 Node
`^22.19.0 || >=24.0.0`，Cordis peer 为 `^4.0.2`。只添加实际使用的
dsh/Blue peer dependency。

`src/index.ts`：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dsh-blue/blue-api'
import { ui } from '@dsh-blue/blue-ui'

export const name = '@acme/build-health'
export const inject = ['blueStatus']

export function apply(ctx: Context): void {
  ctx.blueStatus.register({
    id: 'acme.build-health',
    priority: 30,
    band: 'right',
    visible: true,
    node: ui.text('healthy', { tone: 'success' }),
  })
}
```

`cordis.patch.yml`：

```yaml
- insert:
    - id: '@acme/build-health'
      name: '@acme/build-health'
```

`package.json` 必须导出编译后的入口与 patch，并把二者列入 `files`：

```json
{
  "name": "@acme/build-health",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "default": "./lib/index.js"
    },
    "./cordis.patch.yml": "./cordis.patch.yml"
  },
  "files": ["lib/**/*", "cordis.patch.yml"]
}
```

构建后在专用 profile 安装文件快照：

```sh
dsh plugin --profile blue-build-health add file:/absolute/path/to/build-health
dsh --profile blue-build-health
```

修改源码后先 rebuild；依赖图或打包内容变化后重新安装。不要用生产
`blue` profile 做验收。
