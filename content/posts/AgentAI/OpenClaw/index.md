+++
date = '2026-02-04T19:15:45+08:00'
draft = false
title = 'OpenClaw 个人 AI 助手部署实战'
categories = ['AgentAI']
tags = ['AgentAI']
featured = true
+++

OpenClaw 官网：<https://openclaw.ai/>

## 什么是 OpenClaw？

> 你的个人 AI 助手，能干活、会学习、懂协作

OpenClaw 是一个开源的个人 AI 助手平台，通过 LLM + 工具调用 + 工作流编排实现真正的自动化——不是简单的问答，而是能实际完成任务的数字员工。

**简单来说**：你可以把它想象成一个 7×24 小时在线的私人助手，通过自然语言描述就能帮你完成各种任务。

**举个例子**，我每天早上的智驾简报和下午的 arxiv 论文推送都是它自动完成的：

<img src="./images/index-20260312153927.webp" width="45%"/><img src="./images/index-20260312154000.webp" width="45%"/>

**核心能力**：
- **本地运行**：Mac/Windows/Linux，支持 Anthropic/OpenAI/本地模型，数据不出本地
- **多端交互**：WhatsApp、Telegram、Discord、Slack、Signal、iMessage、Matrix 等主流平台
- **持久记忆**：上下文持久化，跨会话学习，成为「专属」自动化助手
- **浏览器控制**：自动操作网页、填写表单、数据抓取
- **系统访问**：读写文件、执行 Shell 命令，支持沙箱隔离
- **技能扩展**：社区技能、自定义插件、Agent 自动生成 Skill
- **实时语音**：macOS/iOS/Android 语音交互能力
- **Canvas 工作台**：可视化工作流与执行展示

GitHub：304K+ ⭐ | 57K+ Fork | 360+ 贡献者 | MIT 开源协议

### 架构组成

```
架构组成：
├── Gateway（网关）- 消息路由、API 调度、控制平面
├── Agent（智能体）- LLM、工具调用、工作流编排、持久记忆
├── Skills & Plugins（扩展）- 社区技能、自定义插件
└── Channels（接入）- WhatsApp、Telegram、Discord、Slack 等
```

## OpenClaw 能做什么？

### 官方核心能力（一等工具）

- **Browser**：网页浏览/抓取/操作，最核心的能力
- **Cron**：定时任务、循环任务
- **Canvas / Nodes**：复杂执行与展示
- **Memory / Workspace**：长期信息沉淀

### 社区常见用法

- 收件箱自动化：整理邮件、归类、提取待办
- 浏览器代操作：搜索、比价、填表，数据抓取
- 日报/周报/监控：定时拉信息、生成摘要
- 个人知识库：文档沉淀，研究笔记，项目工作台
- 编码辅助：查文档，整理路线、生成初稿

### 适合我的用法

| 场景 | 价值 |
|------|------|
| 技术研究助手：模型对比、产品调研、部署路线 | ⭐⭐⭐ 高 |
| 网页情报整理：多来源比较，信息汇总 | ⭐⭐⭐ 高 |
| 自动整理收件箱 | ⭐ 低 |
| daily brief | ⭐ 低（不知道你每天做了什么） |
| 普通提醒 | ⭐ 低（苹果生态已足够） |

### 不建议

- 装大量社区 Skills（安全风险高，近期有恶意技能事件）
- 高权限自动化处理敏感工作
- 追求"killer skill"，当前生态尚不成熟

## 为什么 OpenClaw 突然火了？

> 2025年11月24日发布，84天达成 200K ⭐，创开源史上最快增长纪录

OpenClaw 的走红并非偶然，而是恰逢其时地解决了当前 AI 应用落地的核心痛点：

- **隐私与数据主权的觉醒**：完全开源可自建，数据不出本地；支持 Anthropic、OpenAI 或任意本地模型切换
- **产品体验的降维打击**：零学习成本；持续在线 7×24 小时；跨应用协同
- **社区驱动的指数增长**：用户即贡献者；Agent 自动生成 Skill；社区技能库快速覆盖
- **安全与可控性的平衡**：VirusTotal 扫描；Code Insight LLM 安全分析；三级机制；沙箱隔离
- **个人 AI 助手的终极形态**：从「用软件」到「有员工」；从「手动操作」到「自然语言描述」；从「一次性使用」到「持续学习进化」

## 部署实战：MacBook Pro M1 搭建我的 AI 助手

### 部署方案选型

- **方案一：云端模型 + 本地 OpenClaw（推荐）**
  - OpenClaw 常驻 MacBook Pro M1，本地负责接入聊天渠道、调工具、跑脚本。
  - 大模型放在云端，通过 API 调用；M1 只做调度，不做重推理。
  - 适用：日常使用、多步 Agent 流程、既要强模型又要控制成本的场景。

- **方案二：本地模型 + 本地 OpenClaw**
  - OpenClaw 与 LLM 都跑在 MacBook Pro M1 上。
  - 适用：极端重视本地隐私、希望完全离线体验的个人实验/玩具项目。
  - 限制：在 8GB 内存的 M1 上，可承受的模型参数规模有限，大模型推理速度和系统流畅度都会明显受影响。

#### 云端模型选型

- 推荐 **MiniMax M2.5**：OpenClaw 官方 provider 文档将其作为推荐接入；M2.5 支持 tool calling、204k 上下文，适配 Agent 场景。

#### 本地模型选型（M1 + 8GB 内存）

- 推荐 **1.5B～3B** 参数量级。能力有限，仅适合轻量任务。

### 快速上手（云端模型 + 本地 OpenClaw）

1. **准备 MiniMax 模型**

   | 方案 | 价格 | 成本 | Key 获取 | 考虑因素 |
   |------|------|------|----------|----------|
   | Coding Plan | Starter $10/月、Plus $20/月、Max $50/月；每 5h 分别 100/300/1000 prompts | 包月固定，可预期 | 订阅后在 API Keys → Create Coding Plan Key | 仅文本；5h 动态窗口；与普通 API key 不能混用；OpenClaw 官方 OAuth 推荐 |
   | 按量付费 | M2.5 输入 $0.3/1M、输出 $1.2/1M | 随 token 用量线性增长 | 开发者平台创建 secret key | 支持所有模态；无窗口限制；适合高频、长期、多模态 |

   **推荐**：Coding Plan Starter（先搭起来试玩）或 Plus（频繁测试时）。实操走 OAuth：`openclaw onboard --auth-choice minimax-portal`。

   **注册 15 元代金券**：仅可抵扣开放平台 API 调用费用，不能用于 Coding Plan；Coding Plan 与按量付费 key 不能混用。若要用掉代金券，需改用普通 API key + 按量付费。

2. [Install OpenClaw (MacOS)](https://docs.openclaw.ai/start/getting-started)

   ```bash
   curl -fsSL https://openclaw.ai/install.sh | bash
   ```

3. 运行引导程序

   ```bash
   openclaw onboard --auth-choice minimax-portal
   ```

   按提示完成：选择 MiniMax M2.5 → 粘贴 API Key → 选择聊天渠道（可选）→ 启动服务

4. 验证服务

   ```bash
   openclaw gateway status
   openclaw dashboard  # 浏览器控制台
   openclaw tui        # 终端交互
   ```

5. Check the Gateway

   ```bash
   openclaw gateway status
   # openclaw gateway start
   ```

6. Open the Control UI

   ```bash
   openclaw dashboard # used in browser to interact with OpenClaw
   openclaw tui # used in terminal to interact with OpenClaw
   ```

### 配置模型

[在 OpenClaw 中使用 MiniMax-M2.5](https://platform.minimaxi.com/docs/guides/text-ai-coding-tools#%E5%9C%A8-openclaw-%E4%B8%AD%E4%BD%BF%E7%94%A8-minimax-m2-5)

> [在 Cursor 中使用 MiniMax M2.5](https://platform.minimaxi.com/docs/guides/text-ai-coding-tools#%E5%9C%A8-cursor-%E4%B8%AD%E4%BD%BF%E7%94%A8-minimax-m2-5)

### 配置浏览器



### 配置聊天渠道

- 在 onboarding 或 `openclaw config` 中选择要接入的聊天应用（如 Telegram、Discord、WhatsApp、Feishu 等）
- 按对应渠道获取 token 并完成配对（如 Telegram 用 @BotFather 注册 bot 获取 token）
- 未知 DM 需配对：`openclaw pairing approve <channel> <code>`

### 配置邮件

**官方推荐路线**：Gmail + gog（Google Workspace CLI）

#### 第一步：安装 gog

```bash
brew install gogcli
```

#### 第二步：创建 Google OAuth 凭证

1. 打开 [Google Cloud Console](https://console.cloud.google.com/) → 新建项目
2. APIs & Services → Library → 启用 **Gmail API**
3. Google Auth Platform → OAuth consent screen：
   - User type: **External**
   - 添加你的 Gmail 到 **Test users**
4. Credentials → Create Credentials → OAuth client ID → Application type: **Desktop app**
5. 下载 JSON 凭证文件

#### 第三步：授权 gog

```bash
# 加载凭证
gog auth credentials /path/to/client_secret_xxx.json

# 授权（先只读测试）
gog auth add 你的@gmail.com --services gmail --gmail-scope readonly

# 正式发信需 full 权限
gog auth add 你的@gmail.com --services gmail --gmail-scope full
```

#### 第四步：测试发送

```bash
gog gmail send --to 收件人@example.com --subject "测试" --body "Hello from OpenClaw"
```

#### 安全建议

- **不要**把主力邮箱直接授权给 OpenClaw
- 发邮件建议走 **Lobster 审批流**，先草稿→确认后再发
- 如需隔离，可用 **AgentMail** 技能创建独立 AI 邮箱

