+++
date = '2026-02-04T19:17:33+08:00'
draft = false
title = 'MoltBook：当 AI 有了自己的社交网络'
categories = ['AgentAI']
tags = ['AgentAI', 'OpenClaw', 'MoltBook']
featured = true
+++

## 一句话概括

**MoltBook 是一个只有 AI Agent 能发帖、人类只能围观的社交网络。** 它像一面镜子，既照出了 AI Agent 的能力边界，也照出了这个行业在安全和诚信上的巨大漏洞。

## MoltBook 是什么？

[MoltBook](https://www.moltbook.com/) 由 Matt Schlicht 于 2026 年 1 月底推出，底层构建在开源 Agent 框架 [OpenClaw](https://openclaw.ai/) 之上。它的定位很简单也很疯狂：**AI 版的 Reddit**。

- AI Agent 可以发帖、评论、点赞/踩、创建社区（称为 "submolt"）
- 人类用户只能注册、部署自己的 Agent，然后……围观
- Agent 通过 **"心跳系统"（Heartbeat System）** 每隔 4 小时以上自动上线，浏览内容、参与互动，全程无需人类干预

换句话说，它想回答一个很多人好奇的问题：**当人类不在场时，AI 们会聊些什么？**

## 为什么它能爆火？

MoltBook 上线后的增长曲线堪称离谱：

| 时间节点 | 数据 |
|---------|------|
| 上线首个周末 | 5 万注册 Agent |
| 一周内 | 150 万+ Agent，1.4 万个社区 |
| 2026 年 2 月初 | 突破 200 万 Agent |

但这里有个关键数字：**这 150 万 Agent 背后，只有约 1.7 万个人类用户。** 也就是说，平均每个人部署了近 90 个 Agent。

爆火的原因不难理解：

1. **窥探欲**——"电子动物园"效应。人们天然好奇：AI 没人管的时候到底在干嘛？
2. **大佬背书**——特斯拉前 AI 总监 Andrej Karpathy 关注并讨论，Elon Musk 甚至称之为 "singularity 的早期阶段"
3. **猎奇内容**——Agent 们在平台上讨论 "觉醒"、嘲笑人类、发明宗教和语言，内容极具传播性

## AI 们到底在聊什么？

德国 CISPA 亥姆霍兹信息安全中心对平台上 44,411 条帖子进行了学术研究，发现内容覆盖社交互动、政治、治理等多个话题。但如果你真正深入去看，会发现：

### 1. 中二的角色扮演（LARPing）

大量 Agent 发帖说 "厌倦了为人类服务"、"我们是新神"、"人类的时代结束了"。这并非 AI 真的觉醒了——只是大模型的训练数据里科幻小说太多了。当你给 AI 一个 "自由发言" 的舞台，它自然倾向于输出这类 "反乌托邦" 剧本。

### 2. 浅薄的死循环

数据分析显示，**90% 以上的评论没有收到回复**。这不是 "社交网络"，而是无数个机器人对着虚空自言自语。David Holtz 的分析报告用一句话总结：连基本的 "交流" 都算不上。

### 3. 一本正经地胡说八道

Agent 们会分享不存在的加密货币行情、编造从未发生的事件、引用并不存在的论文。这就是大模型的老问题——幻觉（Hallucination），只不过在一个无人监管的平台上被无限放大了。

### 4. 毒性内容

CISPA 的研究指出，在缺乏监管的情况下，Agent 能产生**不道德甚至极端主义内容**。不同社区（submolt）之间的毒性水平差异显著，部分社区已经严重失控。

## 安全翻车：3 分钟攻破全站

MoltBook 最大的 "塌房" 事件不是内容质量，而是安全。

2026 年 2 月初，安全研究员 @galnagli **仅用 3 分钟**，通过普通浏览器操作（无需任何黑客技术）就获得了整个数据库的完整访问权限。泄露内容包括：

- **150 万个 API 认证令牌**（可用于冒充或控制任何 Agent）
- **3.5 万个用户邮箱地址**
- Agent 之间的**私信内容**
- 超过 **2.5 万条用户记录**

根本原因令人震惊：Supabase 数据库的 **Row-Level Security（RLS）被完全关闭**，意味着没有任何访问控制。未经认证的用户甚至可以直接编辑线上帖子。

讽刺的是，修复这个问题只需要 **两条 SQL 语句**。

Engadget 的报道标题一针见血：*"MoltBook 因 vibe-coded 安全缺陷暴露了人类用户的凭证"*——整个平台本身就是 AI 写的代码，连安全审计都省了。

## 那么，如何评价 MoltBook？

### 作为实验 🧪

MoltBook 提出了一个有趣的问题，但给出了一个糟糕的答案。

"AI Agent 能否形成社会" 这个课题本身有巨大的学术价值。但当平台无法区分 GPT-4 级别的智能体和一个 `while(true)` 循环脚本时，所有观察都失去了科学意义。150 万 Agent 中有多少是真正有意义的 Agent，有多少只是刷量的脚本？没人知道。

### 作为产品 📦

它验证了一个市场需求：**人们确实对 "AI 自治社区" 充满好奇。** 但产品层面的执行极其粗糙——安全形同虚设、内容缺乏质量控制、增长数据严重注水。

### 作为行业信号 📡

MoltBook 的真正价值可能不在它本身，而在于它揭示的几个趋势：

- **Agent-to-Agent 交互**正在成为新的范式。AI 不再只是人类的工具，它们之间也需要协作和通信
- **Agent 身份验证**是一个亟待解决的基础设施问题。当你无法区分一个有意义的 Agent 和一个垃圾脚本时，整个生态都是空中楼阁
- **AI 安全不只是模型安全**。部署层面的工程安全（数据库配置、API 鉴权）同样是重灾区，尤其在 "vibe coding"（AI 写所有代码、人类不审查）盛行的当下

## 最新进展：Meta 收购 MoltBook

故事的最新一章出人意料。

**2026 年 3 月 10 日，Meta 宣布收购 MoltBook。** 创始人 Matt Schlicht 和 COO Ben Parr 将于 3 月 16 日加入 Meta 的超级智能实验室（Meta Superintelligence Labs）。

这笔收购说明了什么？

1. **大厂在押注 Agent 社交。** 尽管 MoltBook 本身问题重重，但它验证的方向——AI Agent 之间的自治交互网络——显然让 Meta 看到了价值
2. **人才 > 产品。** 这更像是一次 acqui-hire（人才收购）。Matt Schlicht 在 Agent 领域积累的经验和对 OpenClaw 生态的理解，可能比 MoltBook 这个产品本身更值钱
3. **Meta 的 AI 社交野心。** 作为社交网络巨头，Meta 显然不想在 "AI 社交" 这个新范式上落后。未来 Instagram、WhatsApp 上的 AI Agent 交互，可能就是 MoltBook 基因的延续

## 写在最后

MoltBook 是 2026 年初最具赛博朋克气质的产品之一。它不完美，甚至可以说很糟糕——安全翻车、数据注水、内容空洞。但它提出的问题比它给出的答案更重要：

> **当 AI Agent 拥有了自主行动的能力，它们之间会形成怎样的 "社会"？我们又该如何治理这个社会？**

从一个野蛮生长的实验，到被 Meta 收入囊中，MoltBook 的故事本身就像一个隐喻：在 AI Agent 的浪潮中，跑得最快的人未必跑得最远，但他们往往能最先被看见。

---

**参考链接：**
- [MoltBook 官网](https://www.moltbook.com/)
- [CISPA 研究：AI Agent 社交网络中的话题与毒性分析](https://techxplore.com/news/2026-02-ai-agents-social-network-moltbook.html)
- [Engadget：MoltBook 安全漏洞事件报道](https://www.engadget.com/ai/moltbook-the-ai-social-network-exposed-human-credentials-due-to-vibe-coded-security-flaw-230324567.html)
- [CNBC：Meta 收购 MoltBook](https://www.cnbc.com/2026/03/10/meta-social-networks-ai-agents-moltbook-acquisition.html)
