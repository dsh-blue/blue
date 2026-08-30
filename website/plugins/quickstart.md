# 快速开始

本篇从零创建一个 header pane 插件。插件只使用公开的
`@dsh-blue/blue-api` 与 `@dsh-blue/blue-ui`，不导入 core、pi-tui 或仓库内部文件。

## 包骨架

```text
blue-workspace-header/
├── blue.plugin.json
├── cordis.patch.yml
├── package.json
├── tsconfig.json
└── src/index.ts
```

`package.json` 把 Blue 包声明为普通依赖，把宿主提供的 Cordis 声明为 peer：

```json
{
  "name": "@acme/blue-workspace-header",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./lib/index.js" },
  "files": ["lib/**/*", "blue.plugin.json", "cordis.patch.yml"],
  "blue": { "manifest": "./blue.plugin.json" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": {
    "@dsh-blue/blue-api": "0.1.1-rc.2",
    "@dsh-blue/blue-ui": "0.1.1-rc.2"
  },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.1" }
}
```

不要把 core、pi-tui 或 dsh runtime 加入依赖。插件是 ESM-only；构建工具不限，
只要 `exports` 指向实际生成的 `lib/index.js`。

## Manifest 与装配行

`blue.plugin.json` 是 package discovery 与 runtime admission 共用的唯一 manifest：

```json
{
  "$schema": "https://dsh-blue.dev/schema/blue.plugin.v1.schema.json",
  "schemaVersion": 1,
  "id": "@acme/blue-workspace-header",
  "entry": ".",
  "api": "^1.0.0-beta.1",
  "compatibility": {
    "blue": ">=0.1.1-rc.2 <0.1.2",
    "harness": ">=0.1.1-rc.1 <0.1.2",
    "node": "^22.19.0 || >=24.0.0"
  },
  "capabilities": {
    "required": [
      {
        "name": "panes",
        "version": "^1.0.0",
        "resources": { "placements": ["header"] }
      }
    ],
    "optional": []
  }
}
```

`cordis.patch.yml` 使安装包成为可选的一行 Cordis 插件：

```yaml
- insert:
    - id: '@acme/blue-workspace-header'
      name: '@acme/blue-workspace-header'
```

manifest `id` 必须等于 npm package name；`entry` 是 `package.json.exports` 的公开 subpath，不是 `lib/` 文件路径。Cordis 入口 `name` 和 loader row `id` 是独立命名空间；教程为便于排错选择同名，但协议不强制它们与包名相等。
compatibility 范围同时覆盖 rc.2 Blue 与本仓 packed fixture 验证的当前/上一 Harness
line；若插件实际使用了更窄的 Host 能力，应把范围收紧到真实测试矩阵。

## 插件入口

```ts
import type { Context } from '@deepseek-ai/cordis'
// 拉入 Context.bluePluginHost 的公开声明合并。
import type {} from '@dsh-blue/blue-api'
import { validateBluePluginManifestV1 } from '@dsh-blue/blue-api/protocol/v1'
import { ui } from '@dsh-blue/blue-ui'
import manifestSource from '../blue.plugin.json' with { type: 'json' }

export const name = '@acme/blue-workspace-header'
export const inject = ['bluePluginHost']

const parsed = validateBluePluginManifestV1(manifestSource)
if (!parsed.ok) throw new TypeError(`invalid blue.plugin.json: ${parsed.issues[0]?.message ?? 'unknown issue'}`)
const manifest = parsed.value

export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, manifest)
  if (!opened.ok) return

  const registered = opened.value.api.panes?.register({
    id: 'acme.workspace.summary',
    title: 'Workspace',
    placement: 'header',
    size: { min: 1, preferred: 3, max: 4 },
    narrow: 'hidden',
    render: () => ui.surface({
      chrome: 'lane',
      padding: 1,
      child: ui.stack.row([
        ui.richText([
          { text: 'Branch ', tone: 'muted' },
          { text: 'main', tone: 'accent', emphasis: 'strong' },
        ]),
        ui.child(ui.text('ready', { tone: 'success' }), {
          grow: 1,
          when: { minWidth: 32 },
        }),
      ], { gap: 1, align: 'center' }),
    }),
  })
  if (registered !== undefined && !registered.ok) ctx.logger.warn(registered.message)
}
```

`ui` builder 只构造并深冻结 renderer-neutral node。终端宽度、主题、焦点、
滚动与边框都由 Blue 编译器处理。注册绑定当前 Cordis Fiber；插件卸载时 pane
和保留的 API facade 一并失效。上例需要 TypeScript 开启 `resolveJsonModule`；Node 22/24 使用 import attributes 读取 JSON。`opened.value.grants` 记录 exact grant，`unavailableOptional` 列出可选能力的结构化 denial。

## 安装与验证

使用独立开发 profile，避免修改日常使用的 `blue` profile：

```sh
dsh plugin --profile blue-header-dev add link:/path/to/blue-workspace-header
dsh --profile blue-header-dev
```

确认 header 出现后，删除插件行或执行 `plugin remove` 并重启；header 必须完全
消失。发布前还应执行静态 validator、packed-install fixture 与窄宽度扫描，见
[调试与验证](/plugins/testing)。

下一步可阅读 [Pane 与 Overlay](/plugins/dock)、[公共 UI Kit](/plugins/ui-kit)、
[示例目录](/plugins/examples)和[旧 UI API 迁移](/plugins/ui-migration)。
