# 快速上手

::: info 预览阶段说明
`v0.1.0-rc.10` 是当前发布候选版本，npm 的 **`rc`** 与 **`latest`** 标签均指向此版本。本页是用户安装路径；贡献者的本地开发安装（源码检出、link 安装、迭代环）在开发手册的[贡献本仓库](/plugins/contributing)页。
:::

## 前置条件

| 依赖 | 版本 |
| --- | --- |
| Node | `^22.19.0 \|\| >=24.0.0` |
| pnpm | 11（首次装配、升级和 `plugin` 管理需要；日常启动已校准的 profile 不会重复检查。推荐先执行 `npm i -g pnpm@11`，或 `corepack enable && corepack prepare pnpm@11.7.0 --activate`） |
| dsh CLI | 推荐的 `blue` 启动器已内含精确版本 `0.1.1-rc.2`；只有下方“dsh 直装”路径需要单独安装 |

## 安装（预览版）

**推荐：一体化 `blue` 启动器。** 它把固定的 Harness 闭包封装为公共层和平台层归档，npm 安装时只处理一个无依赖包，不解析 Harness 图，也不运行其中的安装脚本：

```sh
npm i -g @dsh-blue/blue-cli@0.1.0-rc.10
blue
```

如果首次运行提示 pnpm 缺失或版本不是 11：

```sh
npm i -g pnpm@11
# 或：corepack enable && corepack prepare pnpm@11.7.0 --activate
```

壳包的 npm 安装只写入启动器与压缩运行时层。第一个需要 dsh 的命令只会把公共层和当前平台层以有界内存展开到用户缓存，不再联网；首次运行 `blue` 仍会经 `dsh plugin add` 和 pnpm 装配 Blue profile，这个独立操作下载 Blue 插件闭包，并可从 pnpm 缓存续传。国内网络建议同时配置两个 registry：

```sh
pnpm config set registry https://registry.npmmirror.com
npm config set registry https://registry.npmmirror.com   # /update 的新版检查走 npm
```

**或 dsh 直装**（宿主自理，适合已有 dsh 的用户）：

```sh
npm i -g @deepseek-ai/dsh
dsh plugin --profile blue add @dsh-blue/blue@rc
dsh --profile blue
```

安装完成后，按下方「开跑前配一个 key」与「首次运行」两节启动；模型、Provider、主题与密钥的详细配置见[配置：模型、Provider 与主题](/guide/config)。

- `@rc` 是文档约定的安装通道：预览版只按 `rc` dist-tag 发布，`latest` 为稳定线保留。注意 npm 在首个稳定版发布前不允许包没有 `latest`（注册表拒绝删除），所以它目前同样指向最新 rc——那只是占位，不是契约。
- 升级到更新的预览版：壳包用户重跑 `npm i -g @dsh-blue/blue-cli@rc`（重装即升级——壳按自身版本校准 profile 里的 Blue，宿主线随之固定）；dsh 直装用户在 Blue 中输入 `/update`（应用内安全升级：预检、快照、装机冒烟、失败自动回滚），或重跑同一条 `plugin add`。

## 开跑前配一个 key

**配一个 `DEEPSEEK_API_KEY` 就可以开始使用了**——开箱默认连 DeepSeek 官方 API（`deepseek-official` 路由，默认模型 `deepseek-v4-flash`），除 key 外无需任何配置：

```sh
export DEEPSEEK_API_KEY=sk-...        # 或写入 ~/.dsh/.credentials.yaml，一劳永逸
```

换模型、接自建网关、自定义主题等，见[配置：模型、Provider 与主题](/guide/config)。

## 首次运行

```sh
blue                        # 交互模式：欢迎横幅 + 输入编辑器
blue 修复登录页的空指针       # 直接执行任务
# dsh 直装用户：dsh --profile blue（两条等价，壳包只是把宿主与 profile 管了起来）
```

启动后可以先试这几件事：

- 输入 `/` 查看斜杠命令补全，`/help` 打开命令与键位总览；
- 随手问点什么，观察流式回复与工具卡片；
- `/theme` 列出全部六套主题并标出当前（`dark`/`light`/`ocean`/`paper`/`auto`/`custom`），`/theme ocean` 热切换——输入草稿不会丢；`/settings` 面板的 Theme 行循环修改则实时生效并落盘为默认；
- 退出时最后一行是**会话遗言**：会话 id 与一行恢复命令（三击整行即选），下次直接续上。

## 界面预览

<p align="center">
  <video src="/blue-demo.mp4" width="720" autoplay loop muted playsinline controls></video>
</p>
