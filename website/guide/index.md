# 快速上手

::: info 预览阶段说明
`v0.1.0-rc.4` 已发布在 npm 的 **`rc` dist-tag** 下（`latest` 留给稳定线，安装 spec 需带 `@rc` 后缀）。本页是用户安装路径；贡献者的本地开发安装（源码检出、link 安装、迭代环）在开发手册的[贡献本仓库](/plugins/contributing)页。
:::

## 前置条件

| 依赖 | 版本 |
| --- | --- |
| Node | `^22.19.0 \|\| >=24.0.0` |
| pnpm | 11（`blue` 壳包路径不需要） |
| dsh CLI | 仅「dsh 直装」路径需要：`>=0.1.1-rc.2`（`npm i -g @deepseek-ai/dsh`） |

## 安装（预览版）

**推荐：`blue` 壳包**（一条命令，自带与测试线一致的 dsh 宿主；首次运行自动把 Blue 装进 `blue` profile）：

```sh
npm i -g @dsh-blue/blue-cli@rc
blue
```

**或 dsh 直装**（宿主自理，适合已有 dsh 的用户）：

```sh
npm i -g @deepseek-ai/dsh
dsh plugin --profile blue add @dsh-blue/blue@rc
dsh --profile blue
```

安装完成后，按下方「开跑前配一个 key」与「首次运行」两节启动；模型、Provider、主题与密钥的详细配置见[配置：模型、Provider 与主题](/guide/config)。

- `@rc` 后缀是必须的：预览版只打 `rc` dist-tag，裸 spec 解析 `latest`、什么都找不到。
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
- `/theme light` 感受主题热切换（输入草稿不会丢）。
