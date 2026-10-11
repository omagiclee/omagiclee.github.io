+++
date = '2026-03-25T17:35:16+08:00'
draft = false
title = '深入理解 Cursor：从 Token 经济学到 Agent 工作流'
categories = ['Vibe Coding']
tags = ['Cursor', 'AI Coding', 'LLM', 'Agent', 'MCP', 'Tool Calling']
featured = true
+++

> 一句话总结：Cursor 不只是一个"会写代码的编辑器"，理解它背后的 Token 经济学、Context 管理、Tool Calling 机制和 Agent 工作流，才能真正把它用好——并且省钱。

---

## 先建立一个核心认知：幻觉与验证思维

在使用 Cursor（或任何 LLM 编码工具）之前，有一个认知必须先到位：

**大语言模型会产生幻觉（hallucination）。**

这不是 bug，而是当前技术架构的固有特性。LLM 的本质是基于概率的 next-token prediction，它"说话"的时候并不真正"理解"或"验证"自己输出的内容。这意味着：

- 它可能生成看起来完全正确、但实际上跑不通的代码
- 它可能引用不存在的 API 或编造函数签名
- 它可能对你的问题给出自信但错误的解释

所以，用好 Cursor 的第一条原则不是"学会提问"，而是：

**永远保持验证思维（verification mindset）。**

具体来说：

- 不要盲目接受生成的代码，先读懂再 accept
- 对关键逻辑，手动验证或写测试覆盖
- 对不确定的 API 调用，去查官方文档
- 结果导向，而不是过程导向——你要的不是"AI 写了多少行代码"，而是"代码是否正确解决了问题"

这个思维方式会贯穿后面所有内容。

---

## Token 计价：理解你在为什么付费

Cursor 背后调用的是大语言模型（如 Claude、GPT 等），而这些模型的计费方式是按 **Token** 计价的。理解 Token 的流向，是理解 Cursor 成本和行为的基础。

### Input Token：你发给模型的一切

每次你在 Cursor 中发起一次请求，模型收到的 input 由两部分组成：

**1. Prompt**

Prompt 又分为两层：

- **System Prompt**：Cursor 自动注入的系统级指令，告诉模型它的角色、行为规范、可用工具等。用户通常看不到这部分，但它消耗 token 且影响模型行为。你可以通过 Cursor 的 Rules 功能定制部分 system prompt。
- **User Prompt**：你在聊天框里写的内容。这是你唯一直接控制的 prompt 部分。

**2. Context**

Context 是 Cursor 自动或手动附加的上下文信息，包括：

- 当前打开的文件内容
- 通过 `@` 引用的文件、文件夹、符号
- 项目结构信息
- 终端输出
- Lint 错误信息
- 之前对话的历史记录

**Context 是 input token 的大头。** 一个中等规模的文件就可能有几千 token，如果附加了多个文件或整个文件夹，token 消耗会迅速上升。

### Output Token：模型返回给你的一切

模型的输出也分为两部分：

**1. Thinking（思考过程）**

支持 extended thinking 的模型（如 Claude）会先进行内部推理。这些 thinking token 会被计费，但通常比 output token 便宜。Thinking 越长，推理越深入，但成本也越高。

**2. Response（最终回复）**

这是你在聊天窗口里看到的实际回复内容，包括代码、解释、工具调用等。

### 计费的直觉

一个简化的计费公式：

```
总成本 ≈ input_tokens × input_price + output_tokens × output_price
```

其中 output token 的单价通常是 input token 的 3-5 倍。这意味着：

- 让模型少说废话（精确提问）能省钱
- 控制 context 大小（少塞无关文件）能省更多钱
- 让模型多 think 少 output，在某些场景下反而更划算

---

## Context 管理：最容易被忽视的核心技能

很多人把 Cursor 用成了"万能聊天框"，在一个 session 里问完代码问又设计、讨论完架构又调 bug。这是对 token 最大的浪费，也是效果最差的用法。

### 为什么 Context 这么重要

LLM 有一个有限的 context window（上下文窗口）。当前主流模型的上下文从 128K 到 200K token 不等。听起来很大，但实际使用中：

- 一个 500 行的代码文件大约消耗 2000-4000 token
- 一段 20 轮的对话历史可能累积 10000+ token
- Cursor 自动注入的 system prompt 和工具定义也在消耗 context

当 context 接近上限时，模型的注意力会被稀释，早期信息可能被"遗忘"或被降低权重。

### 实践建议

**1. 不相关的任务，开新 Chat**

如果你从"修一个 CSS bug"转到"设计一个新的 API 接口"，这两件事的上下文完全不同。在同一个 session 里继续聊，旧的 context 不仅浪费 token，还可能干扰模型对新任务的理解。

**2. 精确 @ 引用，避免整个文件夹**

`@src/utils/auth.ts` 比 `@src/` 高效得多。只给模型它需要的信息。

**3. 长任务分步进行**

不要在一条消息里说"帮我重构整个模块"。拆成具体的、可验证的小步骤，每一步确认结果后再继续。

**4. 必要时手动总结**

在长对话中，如果你感觉模型开始"忘记"之前的讨论，可以在新消息中手动总结关键上下文，而不是依赖它自己回溯历史。

---

## Tool Calling：Cursor 真正的超能力

Cursor 之所以比普通的 ChatGPT 强大得多，核心原因之一是 **Tool Calling**。

### 什么是 Tool Calling

Tool Calling 是 LLM 的一种能力：模型在对话过程中，可以请求调用外部工具（函数），获取结果后继续推理。在 Cursor 中，可用的工具包括：

| 工具类型 | 作用 |
|---------|------|
| **Read** | 读取文件内容 |
| **Write** | 创建新文件 |
| **StrReplace** | 精确编辑文件内容 |
| **Shell** | 执行终端命令 |
| **Grep / Glob** | 搜索代码和文件 |
| **ReadLints** | 获取 Linter 错误 |
| **WebSearch / WebFetch** | 搜索和获取网页信息 |

这些工具让模型不再是一个"只会说话的聊天机器人"，而是一个可以**读代码、改代码、跑命令、查资料**的编码助手。

### Tool Calling 的工作流程

1. 你发送一条请求（例如"帮我修一下这个 bug"）
2. 模型分析你的请求，决定需要调用哪些工具
3. 模型生成 tool call（比如先 Read 文件，再 Grep 搜索相关代码）
4. Cursor 执行工具调用，把结果返回给模型
5. 模型基于工具返回的结果继续推理
6. 重复 2-5，直到任务完成

### Tool Calling 与计费

这是一个容易被忽视的成本来源：

- **Tool Definition（工具定义）**：Cursor 会在 system prompt 中注入所有可用工具的定义（参数、说明等），这些定义本身就消耗 input token
- **Tool Output（工具输出）**：每次工具调用的返回结果（比如读取的文件内容、命令输出）都会作为 input token 进入下一轮对话

也就是说，一个涉及多轮工具调用的复杂任务，实际消耗的 token 远比你在聊天框里看到的文字要多。

---

## Model Context Protocol (MCP)：让 Cursor 连接一切

MCP（Model Context Protocol）是 Anthropic 提出的一个开放协议，目的是标准化 LLM 与外部工具和数据源的交互方式。Cursor 原生支持 MCP。

### MCP 解决了什么问题

在没有 MCP 之前，每个 AI 工具想要接入外部服务（数据库、API、文档系统等），都需要各自写一套集成逻辑。MCP 提供了一个统一的协议层：

```
LLM <-> MCP Client (Cursor) <-> MCP Server (外部工具/数据源)
```

### MCP 的核心概念

- **MCP Server**：提供工具和资源的服务端。比如一个数据库 MCP Server 可以暴露"查询"和"写入"两个工具
- **MCP Client**：消费 MCP Server 能力的客户端。Cursor 就是一个 MCP Client
- **Tools**：MCP Server 暴露给 LLM 的可调用函数
- **Resources**：MCP Server 提供的可读取数据

### 实际意义

通过 MCP，你可以让 Cursor：

- 直接查询你的数据库
- 调用内部 API
- 读取 Confluence/Notion 文档
- 操作 Jira/Linear 任务
- 连接任何你能写 MCP Server 的服务

这大大扩展了 Cursor 的能力边界，从"代码编辑器"变成了一个可以与你整个开发工具链交互的 AI Agent 入口。

### Plugin：MCP 之上的打包与分发层

理解了 MCP 之后，再来看 Cursor 的 **Plugin（插件）** 就很清晰了——Plugin 不是 MCP 的替代品，而是一个**更高层的打包与分发机制**，MCP Server 只是 Plugin 可以包含的组件之一。

一个 Cursor Plugin 可以捆绑以下任意组合的组件：

| 组件 | 作用 |
|------|------|
| **MCP Servers** | 连接外部工具和数据源（数据库、API、第三方服务） |
| **Rules** | 持久化的 AI 行为指令和编码规范（`.mdc` 文件） |
| **Skills** | 面向特定领域的专业能力（复杂任务的 prompt + 代码） |
| **Subagents** | 专门化的子 Agent，可以并行执行任务 |
| **Hooks** | 事件触发的自动化脚本，用于观察和控制 Agent 行为 |
| **Commands** | Agent 可执行的命令文件 |

换句话说，**Plugin 是"能力包"，MCP 是"连接协议"**。举个例子：

- **Stripe Plugin** = Stripe MCP Server（让 AI 能调用 Stripe API）+ Rules（Stripe 集成的最佳实践）+ Skills（支付流程的专业知识）
- **Figma Plugin** = Figma MCP Server（让 AI 能读取设计稿）+ Skills（将设计稿转换为代码的能力）
- **AWS Plugin** = AWS MCP Server（让 AI 能操作 AWS 服务）+ Rules（基础设施配置规范）

它们之间的层级关系：

```
Plugin（分发单元）
├── MCP Server（连接外部工具）
├── Rules（行为规范）
├── Skills（专业能力）
├── Subagents（并行执行）
├── Hooks（事件自动化）
└── Commands（可执行命令）
```

Plugin 通过 **Cursor Marketplace** 发现和安装。目前 Marketplace 已经有 Amplitude、AWS、Figma、Linear、Stripe、Cloudflare、Vercel、Databricks 等合作伙伴的官方插件，覆盖了从设计、编码、部署到数据分析的完整开发生命周期。

当然，你也可以单独使用 MCP Server 而不通过 Plugin——直接在 Cursor Settings 中配置 MCP Server 即可。Plugin 只是提供了一种更方便的分发和管理方式，尤其适合团队统一工具链的场景。

---

## Agent 模式：从"问答"到"自主执行"

Cursor 的 Agent 模式是目前最核心的使用方式，也是理解 Cursor 价值的关键。

### Agent 与普通 Chat 的区别

| 维度 | 普通 Chat | Agent |
|------|----------|-------|
| **交互模式** | 一问一答 | 自主规划、多步执行 |
| **工具使用** | 用户手动触发 | 模型自主决定调用时机和顺序 |
| **任务范围** | 单个问题 | 复杂、多步骤任务 |
| **上下文获取** | 依赖用户提供 | 主动搜索和读取所需信息 |

### Agent 的工作方式

当你在 Agent 模式下给出一个任务时，Cursor 会：

1. **理解任务**：分析你的需求，拆解成子步骤
2. **主动探索**：搜索相关代码、读取文件，构建对项目的理解
3. **制定计划**：决定修改哪些文件、按什么顺序
4. **执行修改**：调用编辑工具修改代码
5. **自我验证**：检查 lint 错误、运行命令验证结果
6. **迭代修复**：如果发现问题，自动尝试修复

### Agent 的局限性

Agent 不是万能的，理解它的边界很重要：

- **它不能替代你思考架构**：Agent 擅长执行，但高层设计决策需要你来做
- **复杂任务仍需拆分**：一次性给太大的任务，Agent 容易迷失方向
- **幻觉在 Agent 模式下更危险**：因为 Agent 会自主执行，一个错误的判断可能导致一连串错误的修改
- **Token 消耗更高**：Agent 的多轮工具调用意味着更多 token 开销

---

## 核心原则：结果导向，而不是过程导向

最后回到最重要的一点。

很多人在使用 Cursor 时容易陷入一个误区：把注意力放在"AI 生成了多少代码"上，而不是"问题有没有被解决"。

**结果导向意味着：**

- 不在乎 AI 写了多少行代码，只在乎功能是否正确实现
- 不在乎 AI 回答了多少轮，只在乎最终结果是否可用
- 不盲目 accept 所有修改，而是逐一验证每个变更的正确性

**验证（validate/verify）才是闭环：**

1. **代码正确性**：生成的代码能不能跑？逻辑对不对？
2. **边界情况**：异常输入、空值、并发场景有没有覆盖？
3. **一致性**：新代码和现有代码风格、架构是否一致？
4. **可维护性**：生成的代码将来好不好改？

Cursor 是一个极其强大的工具，但它的价值最终取决于使用者的判断力。最好的用法是：

**让 AI 做它擅长的（快速生成、搜索、执行重复性工作），让人做人擅长的（架构决策、质量判断、验证确认）。**

---

## 总结

| 概念 | 核心要点 |
|------|---------|
| **幻觉与验证** | LLM 会犯错，永远保持验证思维 |
| **Token 计价** | Input = Prompt + Context，Output = Thinking + Response，控制 context 是省钱关键 |
| **Context 管理** | 不相关任务开新 chat，精确引用，分步执行 |
| **Tool Calling** | Cursor 通过工具调用实现代码读写、命令执行、信息搜索 |
| **MCP** | 标准化协议，让 Cursor 连接外部工具和数据源 |
| **Plugin** | MCP 之上的打包分发层，捆绑 MCP + Rules + Skills + Subagents + Hooks 为一个"能力包" |
| **Agent** | 从问答升级为自主规划执行，但需要人类把控方向 |
| **结果导向** | 不看过程看结果，验证是使用 AI 编码的最后一道防线 |

---

## References

- [Cursor 官方文档](https://docs.cursor.com)
- [Cursor Plugins 文档](https://cursor.com/docs/plugins.md)
- [Cursor Marketplace](https://cursor.com/marketplace)
- [Extend Cursor with Plugins（官方博客）](https://cursor.com/blog/marketplace)
- [Anthropic Model Context Protocol](https://modelcontextprotocol.io)
- [Anthropic Claude Token Pricing](https://www.anthropic.com/pricing)
- [OpenAI Token 计价说明](https://openai.com/api/pricing)