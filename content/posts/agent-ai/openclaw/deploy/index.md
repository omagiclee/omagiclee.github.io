+++
date = '2026-02-10T10:00:00+08:00'
draft = false
title = 'OpenClaw 部署实战：本地部署 + 云端 MiniMax M2.5 配置指南（下篇）'
categories = ['AgentAI']
tags = ['AgentAI', 'OpenClaw']
featured = true
+++

> 上篇我们介绍了 OpenClaw 的架构与崛起，本篇带来完整的本地部署实战。

---

## 部署方案选型

### 方案一：云端模型 + 本地 OpenClaw（推荐）

- OpenClaw 常驻 MacBook Pro M1，本地负责接入聊天渠道、调工具、跑脚本
- 大模型放在云端，通过 API 调用；M1 只做调度，不做重推理
- 适用：日常使用、多步 Agent 流程、既要强模型又要控制成本的场景

### 方案二：本地模型 + 本地 OpenClaw

- OpenClaw 与 LLM 都跑在 MacBook Pro M1 上
- 适用：极端重视本地隐私、希望完全离线体验的个人实验/玩具项目
- 限制：在 8GB 内存的 M1 上，可承受的模型参数规模有限，大模型推理速度和系统流畅度都会明显受影响

---

## 快速上手：云端模型 + 本地 OpenClaw

### 第一步：安装 OpenClaw

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

### 第二步：运行引导程序

```bash
openclaw onboard --auth-choice minimax-portal
```

按提示完成：选择 MiniMax M2.5 → 粘贴 API Key → 选择聊天渠道（可选）→ 启动服务

### 第三步：验证服务

```bash
# 检查 Gateway 状态
openclaw gateway status

# 打开浏览器控制台
openclaw dashboard

# 终端交互
openclaw tui
```

---

## 模型配置

### MiniMax M2.5（推荐）

| 方案 | 价格 | 成本 | Key 获取 | 考虑因素 |
|------|------|------|----------|----------|
| Coding Plan | Starter $10/月、Plus $20/月、Max $50/月；每 5h 分别 100/300/1000 prompts | 包月固定，可预期 | 订阅后在 API Keys → Create Coding Plan Key | 仅文本；5h 动态窗口；与普通 API key 不能混用；OpenClaw 官方 OAuth 推荐 |
| 按量付费 | M2.5 输入 $0.3/1M、输出 $1.2/1M | 随 token 用量线性增长 | 开发者平台创建 secret key | 支持所有模态；无窗口限制；适合高频、长期、多模态 |

**推荐**：Coding Plan Starter（先搭起来试玩）或 Plus（频繁测试时）。

[在 OpenClaw 中使用 MiniMax-M2.5](https://platform.minimaxi.com/docs/guides/text-ai-coding-tools#%E5%9C%A8-openclaw-%E4%B8%AD%E4%BD%BF%E7%94%A8-minimax-m2-5)

### 本地模型选型（M1 + 8GB 内存）

推荐 **1.5B～3B** 参数量级。能力有限，仅适合轻量任务。

---

## 聊天渠道配置

在 onboarding 或 `openclaw config` 中选择要接入的聊天应用（如 Telegram、Discord、WhatsApp、Feishu 等）。

按对应渠道获取 token 并完成配对：
- Telegram：用 @BotFather 注册 bot 获取 token
- 未知 DM 需配对：`openclaw pairing approve <channel> <code>`

---

## Skills 配置

### 安装 Skills

```bash
# 搜索 Skill
clawhub search <keyword>

# 安装 Skill
clawhub install <skill-name>

# 列出已安装的 Skills
clawhub list

# 更新 Skill
clawhub update <skill-name>
```

### 常用 Skills

#### apple-reminders（提醒事项）

管理 Apple Reminders 的 Skill。

**依赖**：需要安装 `remindctl` CLI

```bash
# 安装 remindctl
brew install remindctl

# 验证安装
remindctl --version
```

**验证权限**：系统设置 → 隐私与安全性 → 提醒事项 → 确保 Terminal 或 OpenClaw 有权限访问

**使用方式**：
```
帮我添加一个提醒：明天上午 9 点交水电费
列出我今天到期的提醒
把"买牛奶"标记为完成
```

或强制指定 Skill：
```
/skill apple-reminders 列出所有提醒列表
```

#### apple-notes（备忘录）

管理 Apple Notes 的 Skill。

**依赖**：需要安装 `memo` CLI

```bash
# 安装 memo
brew install antoniorodr/tap/memo
memo --version
```

**使用方式**：
```
列出所有备忘录
在"工作"备忘录里添加：今天完成了需求评审
```

#### summarize（摘要）

对 URL、文件、播客等内容生成摘要。

**依赖**：需要安装 `summarize` CLI

```bash
brew install summarize
```

**使用方式**：
```
总结这个网页：https://example.com/article
总结这个 PDF：./documents/report.pdf
```

#### arxiv-daily（每日论文）

自动抓取和整理 arXiv 最新论文。

```bash
clawhub install arxiv-daily
```

**使用方式**：
```
帮我找一下最新的 LLM 相关论文
搜索关于 Agent 的论文
```

### 检查 Skills 状态

```bash
# 查看已安装的 Skills
clawhub list

# 检查 Skill 是否正常工作
openclaw skills check -v
```

### 常见问题

**Skill 装好了但不能用？**
- 检查 macOS 权限：系统设置 → 隐私与安全性 → 对应 App 权限
- 检查依赖 CLI 是否安装：`which <CLI名称>`
- 检查 Skill 状态：`openclaw skills check -v`

**Command Line Tools 过旧？**

```bash
xcode-select -p
sudo rm -rf /Library/Developer/CommandLineTools
xcode-select --install
```

---

## 邮件配置

官方推荐路线：Gmail + gog（Google Workspace CLI）

### 安装 gog

```bash
brew install gogcli
```

### 创建 Google OAuth 凭证

1. 打开 [Google Cloud Console](https://console.cloud.google.com/) → 新建项目
2. APIs & Services → Library → 启用 **Gmail API**
3. Google Auth Platform → OAuth consent screen：
   - User type: **External**
   - 添加你的 Gmail 到 **Test users**
4. Credentials → Create Credentials → OAuth client ID → Application type: **Desktop app**
5. 下载 JSON 凭证文件

### 授权 gog

```bash
# 加载凭证
gog auth credentials /path/to/client_secret_xxx.json

# 授权（先只读测试）
gog auth add 你的@gmail.com --services gmail --gmail-scope readonly

# 正式发信需 full 权限
gog auth add 你的@gmail.com --services gmail --gmail-scope full
```

### 测试发送

```bash
gog gmail send --to 收件人@example.com --subject "测试" --body "Hello from OpenClaw"
```

---

## 安全配置

> 这是最重要的部分，请务必认真阅读。

### 安全风险

MITRE 报告发现超过 **4.2 万个** OpenClaw 实例暴露在公网上，其中 **90%** 可绕过身份验证。

### 安全建议

- **不要**把主力邮箱直接授权给 OpenClaw
- **不要**在主力电脑或公司设备上运行 OpenClaw
- 使用独立的邮箱账号进行授权
- 发邮件建议走 **Lobster 审批流**，先草稿→确认后再发
- 如需隔离，可用 **AgentMail** 技能创建独立 AI 邮箱

### 基础安全配置

在 `openclaw.json` 中配置访问限制：

```json5
{
  channels: {
    whatsapp: {
      allowFrom: ["+15555550123"],  // 只允许特定号码
    },
  },
  gateway: {
    auth: {
      // 启用认证 token
    },
  },
}
```

### Tool Profiles

根据场景选择合适的工具配置：

```json5
{
  tools: {
    // 预设：full | messaging | coding | minimal
    profile: "coding",
    
    // 白名单/黑名单
    allow: ["group:fs", "browser"],
    deny: ["group:runtime"],
  },
}
```

---

## 我的使用场景

这是我实际在用的几个场景：

### 1. 智驾简报（每天早上）

通过 Cron 定时 + Browser 工具自动抓取智驾媒体资讯，每天早上自动推送到飞书。

### 2. arxiv 论文推送（每天下午）

通过 arxiv-daily Skill 自动抓取最新论文，筛选后推送到飞书。

### 3. 信息整理

用自然语言让 OpenClaw 帮我整理网页信息、对比产品差异、生成摘要。

---

## 总结

OpenClaw 是一个强大的本地 AI 助手框架，核心优势：
- 本地运行，数据不出本地
- 多渠道接入（微信、Telegram 等）
- 主动执行任务（定时推送）
- 丰富的 Skills 生态

但也要注意安全风险，不要在主力设备上运行敏感任务。

**GitHub**：304K+ ⭐ | 57K+ Fork | 360+ 贡献者 | MIT 开源协议
