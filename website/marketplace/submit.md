# 收录指南

插件市场开放收录。收录即向 [`dsh-blue/marketplace`](https://github.com/dsh-blue/marketplace) 提交 PR，合并后网站数分钟内自动重建上线（每日定时重建兜底）。

## 收录状态

每个插件处于三种状态之一，市场卡片徽章按此展示：

- **已验证**（`verified`）：通过下方机器契约与人工验收，可在 TUI `/plugin` 面板一键安装；
- **未验证**（`unverified`）：可通过 CLI 安装，但尚未完成完整兼容性验证——**新收录默认以此状态进入**；
- **适配中**（`adapting`）：正与维护者合作适配当前 Harness 线，须在条目中附 `adaptingIssue` 跟踪 issue。

## 提交流程

1. 按[快速开始](/plugins/quickstart)开发插件，package root 通过 `package.json.blue.manifest` 指向 canonical `blue.plugin.json`；
2. 用已发布的 `blue-plugin validate/conformance` 完成[调试与验证](/plugins/testing)；
3. Fork `dsh-blue/marketplace`，在 `registry.json` 增加条目（字段见仓内 README，新收录 `status` 填 `unverified`），并提供 `content/<id>/zh.md` 与 `en.md` 双语详情页；
4. 提交 PR；仓内 validate CI 校验字段白名单、id 唯一性、双语 content 齐全；
5. 维护者 review 通过后合并；完成兼容性验收的条目由维护者把 `status` 改为 `verified`。

## 「已验证」门禁

- manifest `id` 等于 package name，entry 是公开 exports subpath；
- required/optional、capability version 与 exact resource 通过共享 parser/validator；
- 只使用七项 Public Beta capability，不把 Experimental/reference facet 写进 canonical manifest；
- packed install、受支持 Harness line、Fiber unload、宽度扫描与真实 profile 有可复现证据；
- 中英文元信息、版本、license、仓库和安装源与实际 artifact 一致。

[返回插件市场](/marketplace/)
