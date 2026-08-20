---
layout: home

hero:
  name: Blue-dsh
  text: 插件式 TUI
  tagline: v0.1.0-rc.1 · 预览版 —— 流式会话、工具卡片、审批浮层与底部面板，一切皆插件。
  actions:
    - theme: brand
      text: 快速上手
      link: /guide/
    - theme: alt
      text: GitHub
      link: https://github.com/dsh-blue/blue

features:
  - title: 流式会话
    details: 用户与助手消息边流式边渲染为 Markdown；工具调用呈现为卡片，diff 与终端输出有专属卡片，思考过程独立成块。
    link: /features/streaming
    linkText: 了解更多 →
  - title: 输入编辑器
    details: 圆角框编辑器：斜杠命令模糊补全、参数幽灵提示、! bash 模式、@ 文件补全，Ctrl-V 粘贴剪贴板图片。
    link: /features/editor
    linkText: 了解更多 →
  - title: 审批与问卷浮层
    details: 四选项审批面板（数字直选、会话级 always-allow、拒绝带反馈）与分页问卷浮层。
    link: /features/approval
    linkText: 了解更多 →
  - title: 两行状态栏
    details: model · 工作目录 · git 徽章 · context 占用 · 轮换教学提示——条目全部来自注册表贡献，不是写死的。
    link: /features/status-bar
    linkText: 了解更多 →
  - title: 底部面板
    details: agent 运行时的活动指示、排队消息收件箱（Up 召回）、todo 面板（Ctrl-T 折叠）与 /btw 侧问面板。
    link: /features/panes
    linkText: 了解更多 →
  - title: 主题热切换
    details: /theme 在 dark / light / auto（OSC 11 背景探测）/ custom（JSON 调色板）之间热切换，输入草稿不丢。
    link: /guide/theme
    linkText: 了解更多 →
---
