+++
date = '2026-10-23T00:40:00+08:00'
draft = false
title = 'REA 深度解析 从软件逆向到 Agent 工作流'
description = '基于 REA 官方代码、6.7.0 发布记录、公开重建案例和独立测评，解释 AI 逆向工具的架构、证据机制、能力边界与实践方法，并比较 GhidraMCP 和 IDA MCP。'
summary = 'REA 把反编译、应用分析和证据管理接入编程 Agent。通过 DX-Ball、Notion、计算器案例与独立测评，看清它能解决什么，以及如何验证重建结果。'
categories = ['AgentAI']
tags = ['REA', 'Reverse Engineering', 'MCP', 'AI Coding', 'AgentAI']
contentLanguage = 'zh-CN'
math = false
+++

一个桌面软件没有公开源码，但你想弄清楚它怎样导出文件、处理剪贴板，或者计算某个数值。过去，这通常意味着打开反编译器，查字符串、追调用、读汇编，再写一段程序验证判断。**REA 把这套调查过程接进了编程 Agent：让模型调用专业工具取得证据，再继续追问、解释和实现。**

它最值得关注的地方，是把“理解已有软件”变成了编程助手可以持续执行的工作流。至于能否恢复一个完整产品，要看目标规模、工具覆盖和验证结果。

> **资料截至 2026 年 10 月 23 日。** 本文讨论 [morluto/rea](https://github.com/morluto/rea) 的 Reverse Engineer Anything，以 **6.7.0** 为版本基线。案例与测评来自文中标明的原始作者；本文没有把这些公开结果当作自己的实测。

<!--more-->

## 先看 REA 的定位

| 问题 | 答案 |
| :--- | :--- |
| 它是什么 | 一个软件分析工具集，通过 MCP server 和 CLI 向 Agent 或终端提供能力 |
| 推理由谁完成 | 连接它的编程 Agent 及其模型 |
| 反编译由谁完成 | Ghidra、Hopper、IDA 等后端；部分文件格式由 REA 自己解析 |
| 输出是什么 | 伪代码、汇编、模块关系、观察结果，以及来源和未覆盖范围 |
| 谁负责重建功能 | Agent 使用正常的代码编辑、构建和测试工具完成 |
| 官方入口 | [GitHub](https://github.com/morluto/rea)、[rea.tools](https://rea.tools/)、[npm 的 rea-agents](https://www.npmjs.com/package/rea-agents) |

这套分工可以从 [6.7.0 的架构图](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/architecture.mermaid)和 [README](https://github.com/morluto/rea/blob/rea-agents-6.7.0/README.md)直接核对。MCP 提供工具发现与调用的接口；具体如何推理、选择下一步，仍由 AI 应用负责。[MCP 架构说明](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture)

{{< mermaid >}}
flowchart TB
    accTitle: REA 与编程 Agent 的职责
    accDescr: 用户提出具体问题，Agent 通过 REA 调用分析后端，获得证据后继续调查，并用编程工具实现和测试。
    U["用户提出一个具体问题"]:::client
    A["编程 Agent<br/>制定调查步骤与解释结果"]:::client
    R["REA<br/>MCP / CLI · 分析流程 · 证据管理"]:::service
    P["分析后端<br/>Ghidra / Hopper / IDA / JADX"]:::engine
    S["静态解析与运行观察<br/>应用包 · JavaScript · 浏览器"]:::engine
    E["返回证据<br/>代码位置 · 调用关系 · 覆盖范围"]:::storage
    T["Agent 使用编程工具<br/>解释 · 实现 · 对照测试"]:::service
    U --> A
    A --> R
    R --> P
    R --> S
    P --> E
    S --> E
    E --> T
{{< /mermaid >}}

图中是一次调查的职责划分，并不表示每个方框都是独立服务。证据不足时，Agent 会继续发起查询。对于一个已有源码的小项目，直接搜索文件就可能完成任务；REA 的用武之地，是需要处理编译产物、跨层关系，或者反复保存和核查分析证据的时候。

## 为什么这个项目受到关注

2026 年 10 月 23 日凌晨读取官方 GitHub 仓库元数据时，REA 约有 **36.4 万 stars**；仓库创建于 2026 年 4 月 14 日。这是关注度快照，不能换算成活跃用户数或任务成功率。[官方仓库](https://github.com/morluto/rea)

从产品形态看，我认为它吸引人的原因有三点：

1. **入口接近用户的问题。** 用户关心“这个功能怎么实现”，REA 让 Agent 负责把问题拆成查函数、追引用、读资源等操作。
2. **调查和实现能接在一起。** 找到规则后，同一个编程助手可以写一个小实现，再用原程序检查它。
3. **结果有机会被复查。** 文件位置、地址、参数和未解决项能够留下来，便于人判断模型的解释有没有依据。

这也改变了阅读演示的方式：应该同时看**找到了什么、怎样找到、验证到了哪一步**。一个流畅的聊天记录，往往只展示了其中一部分。

## REA 的工程价值在证据组织

反编译输出经常带有不完整的类型、临时变量名和无法直接还原的调用。模型可以帮助解释这些材料，但解释需要绑定到具体对象。

REA 的 Evidence 记录保存目标身份、来源位置、观察、推断和未解决项；MCP 结果中有 `evidence_id`、`normalized_result`，以及可能存在的 `raw_result`。这些字段让后续查询与比较有明确的依据。[CLI 与 Evidence](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/cli.md) · [MCP 返回契约](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/mcp-contracts.md#tool-results)

| 证据需要回答的问题 | 为什么影响结论 |
| :--- | :--- |
| 分析的是哪个文件与版本 | 更新后的二进制可能已经改变行为 |
| 结论对应哪段代码或哪次观察 | 让人能够回到原始材料检查 |
| 哪些内容由工具观察到 | 区分直接事实与模型解释 |
| 哪些路径没有覆盖 | 避免把“没查到”理解成“不存在” |
| 重建后通过了哪些测试 | 判断实现是否保持了原来的行为 |

例如，某个后端无法提供调用者列表，返回空数组不能证明这个函数没有调用者。REA 的契约专门区分“观察到的空集合”和“该维度不可用”；静态文件相同，也不足以推出运行行为相同。[覆盖范围与比较语义](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/mcp-contracts.md#tool-results)

另一项实际问题是**结果体积**。大型应用的完整分析可能远超模型上下文。REA 支持从已完成的分析中提取摘要、分页和指定模块，6.7.0 发布记录还包含对保留的 JavaScript 事实进行精确查询的改进。合理的工作方式是先看概览，再追一个功能涉及的少量节点。[应用工作流](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/javascript-application-workflows.md) · [6.7.0 发布记录](https://github.com/morluto/rea/releases/tag/rea-agents-6.7.0)

## 能力范围取决于目标和后端

下面按常见任务归纳 6.7.0 文档中的能力。它们的输出深度不同，“支持某类文件”需要进一步落实到具体操作。

| 目标 | 可以取得的材料 | 主要条件与边界 |
| :--- | :--- | :--- |
| 原生二进制 | 函数、伪代码、汇编、字符串、引用 | 依赖分析后端，宿主系统与指令集支持各不相同 |
| JavaScript / Electron | 模块、导入、source map、IPC 关系 | 可做静态分析；动态关系可能保留为未知 |
| 网站 | 页面、已加载脚本、网络观察 | 需要浏览器；材料来自当前可观察的客户端和交互 |
| .NET 程序集 | 元数据、CIL 指令、声明的原生依赖 | 静态分析，不能仅凭 `.exe` 扩展名判断适用路径 |
| Android APK | Manifest、类、方法反编译与引用 | 需要 headless JADX 和完整 JDK；设备操作另需 adb |
| 固件 | 区域识别、提取结果、原生分析入口 | 文档中的 Binwalk / Unblob 路径依赖 Linux |
| 录制数据 | 网络请求、抓包字段、崩溃状态等 | 依赖格式与对应工具，结论受记录内容限制 |

来源：[6.7.0 能力表](https://github.com/morluto/rea/blob/rea-agents-6.7.0/README.md#what-you-can-analyze)、[原生分析](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/native-investigation.md)、[Android 分析](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/android-analysis.md)。

**发布版本也属于能力边界。** `main` 分支的文档会继续增加功能，不能据此认定当前 npm 包已经具备相同能力。6.7.0 于 10 月 18 日发布，并包含只打了 tag、没有发布到 npm 的 6.6.0 改动。持久 MCP 注册还可能固定在安装时的版本，应检查实际连接的 server。[发布记录](https://github.com/morluto/rea/releases/tag/rea-agents-6.7.0) · [版本与注册说明](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md#released-package-and-main)

## 三个案例展示了不同的完成程度

### DX-Ball 的一个函数可以严格验证

官方 DX-Ball 案例追踪了砖块横坐标如何转换成声音的左右声像。首次伪代码遗漏了输入与主要计算，调查随后检查了汇编、调用者和二进制里的常量，得到一个可以用 C 表达的小函数。

重建项目报告：这个函数通过 **3,205 个原始 x86 对照案例**，在指定编译器回放中匹配了 **全部 63 字节**。这些数字属于单个函数；案例页 10 月 7 日的项目检查点仍将可玩的完整游戏列为继续开发的工作。[DX-Ball 原始案例](https://rea.tools/showcase/dx-ball/)

{{< mermaid >}}
flowchart TB
    accTitle: 从不完整伪代码到经过验证的函数
    accDescr: 先发现伪代码缺失，再通过汇编和调用者补齐输入语义，读取常量，编写 C 实现，最终对照原始执行结果和编译字节。
    A["伪代码存在缺口"]:::client
    B["读汇编与调用者<br/>确认输入和计算"]:::engine
    C["读二进制常量<br/>补齐公式"]:::storage
    D["编写 C 实现"]:::service
    E["验证这个函数<br/>3,205 个案例 · 63 字节匹配"]:::storage
    A --> B --> C --> D --> E
{{< /mermaid >}}

这个案例给出的启示是：**质量来自补证据和做对照的过程。** 直接接受第一段看似合理的伪代码，会错过最重要的计算。

### Notion 的价值在跨进程追踪

Notion Desktop 7.6.1 的案例围绕剪贴板展开。REA 提供压缩代码中的位置，Agent 继续解析包装函数，沿 `notion:clipboard:write` 通道找到主进程接收端及发送者检查。[Notion 原始案例](https://rea.tools/showcase/notion/)

{{< mermaid >}}
flowchart TB
    accTitle: Notion 剪贴板调用链
    accDescr: 页面调用经 preload 中的 IPC 包装发送到主进程，主进程检查发送者后调用 Electron 剪贴板接口。
    P["页面中的 clipboard API"]:::client
    L["Preload 包装<br/>ipcRenderer.invoke"]:::service
    M["主进程接收<br/>ipcMain.handle"]:::engine
    V["检查发送者"]:::engine
    C["Electron clipboard.write<br/>写入文本与 HTML"]:::storage
    P --> L
    L -->|notion:clipboard:write| M
    M --> V --> C
{{< /mermaid >}}

它回答了一个具体架构问题：页面上的方法最后怎样到达系统剪贴板。案例另有来自缓存网页资源的模块测试；这些测试与桌面 UI 的端到端运行记录属于不同证据。[案例的来源与测试说明](https://rea.tools/showcase/notion/)

### 计算器案例说明了人工参与的位置

Windows Calculator 的百分号案例用二进制指令解释 `200 + 10%` 为什么得到 `220`，并用微软公开源码交叉核对。但证据说明也明确记录：**函数候选由分析者辅助定位**，官网提示词是说明性示例；微软测试代码被阅读过，没有在该调查中执行。

它适合展示“如何核查一条计算规则”，不能作为一次全自主发现并验证整个功能的记录。[计算器证据说明](https://github.com/morluto/rea/blob/main/website/evidence/calculator-and-dino.md#windows-calculator)

| 案例 | 已展示的结果 | 阅读时应保留的范围 |
| :--- | :--- | :--- |
| DX-Ball | 小函数重建与原始行为、编译字节对照 | 单函数验证不能外推成完整游戏完成 |
| Notion | 剪贴板的跨进程调用链 | 模块探测与实际桌面操作需要分别验证 |
| Calculator | 二进制规则与公开源码交叉核对 | 定位过程有人参与，演示提示词不是自治运行日志 |

## 独立测评怎样修正预期

### 小任务上的收益需要实测

[GitTested](https://gittested.com/reviews/morluto-rea/) 在 **2026 年 10 月 9 日**测试 REA **6.2.0**，使用 Claude Code 2.1.295、Sonnet 5.5、medium effort；原生样本为四个去除符号的小型二进制，最大 264 KB。

| 原生任务指标 | 普通 shell 工具 | 使用 REA |
| :--- | ---: | ---: |
| 事实核对得分 | 74 / 75 | 73 / 75 |
| 重建函数通过全部测试输入 | 5 / 5 | 5 / 5 |
| 单会话 token 中位数 | 94,663 | 233,951 |
| 单会话时间中位数 | 54.5 秒 | 63 秒 |

作者认为分差不足以区分优劣；REA 的 token 中位数约为 2.5 倍，但额外消耗大多是缓存读取，计算费用约为 1.5 倍。**这说明小任务可能用普通工具就能完成，不能据此给复杂应用或 6.7.0 下同样的结论。** [原始方法与结果](https://gittested.com/reviews/morluto-rea/)

### 定位准确与覆盖完整要分别检查

[System Design Academy 的作者测试](https://www.systemdesign.academy/explained/rea-reverse-engineer-anything)使用 **6.4.0** 分析 Electron API Demos：30 个返回的代码位置全部核对正确，但没有记录 8 处向窗口回发消息的发送点；代码创建了 8 个窗口，结果只计到 1 个。

这是一个应用、一个版本上的检查。它揭示的是两项不同指标：

- **定位准确性**：工具指出的地方是否真的存在对应代码。
- **覆盖完整性**：任务相关的路径是否都被找到了。

做兼容实现、故障定位或安全审查时，后者会直接影响结论。“列出的项都正确”仍然可能留下关键盲区。[原始测试记录](https://www.systemdesign.academy/explained/rea-reverse-engineer-anything)

### 用研究中的评价方法检查演示

DecompileBench 从 130 个真实程序提取 23,400 个函数，把重新编译、运行行为和可读性分开评估。它通过替换函数并检查程序运行来验证语义，提醒我们还要观察全局状态、内存与异常等行为。这项研究评估的是反编译器，不能当作 REA 的成绩。[DecompileBench 论文](https://arxiv.org/html/2505.11340v1)

<details>
<summary>延伸阅读 为什么有源码的样例还不够</summary>

SRE-Bench 的 2026 年 10 月 1 日 v2 使用专家构建的私有程序，并加入不同的抗分析机制，试图控制训练数据记忆与样本规模带来的偏差。它还区分多次尝试中出现正确候选，与系统能够可靠选出正确答案。这些设计有助于理解评测难点，但论文中的模型配置和分数不宜直接外推到自己的 Agent 工作流。[SRE-Bench v2](https://arxiv.org/abs/2608.11469v2)

对工具做对比时，至少固定目标版本、模型、提示词、时间预算和评分依据；否则很难判断差异来自工具、模型还是测试条件。

</details>

## 选择工具和开始调查

### 先按工作流选入口

| 你的现状 | 可以先考虑的路线 |
| :--- | :--- |
| 已有源码，问题能定位到少量文件 | Agent 配合代码搜索与测试 |
| 已经在 Ghidra 中维护分析项目 | [GhidraMCP](https://github.com/LaurieWired/GhidraMCP)，向 Agent 暴露 Ghidra 的分析、列表和重命名等操作 |
| 已有 IDA 环境 | [Hex-Rays 官方 IDA MCP](https://github.com/HexRaysSA/ida-mcp)，检查其 IDA、idalib 与 Python 版本要求 |
| 调查跨越应用包、JS、原生模块等层次 | REA 的统一入口、应用关系与 Evidence 工作流 |
| 想检查某个简单 Electron 功能 | 先阅读解包后的文件，复杂关系再引入专门分析 |

这是基于接口与任务形态的选择建议，不是性能排名。另一个时效细节是：`mrexodia/ida-pro-mcp` 当前 README 已推荐 Hex-Rays 官方 server；阅读旧安装教程时需要核对这个变化。[社区项目说明](https://github.com/mrexodia/ida-pro-mcp)

### 从一个小目标开始

REA 的 Node.js 要求是 **22.x ≥ 22.19、24.x ≥ 24.11，或 26+**。静态 JavaScript 分析不需要先装原生反编译器。下面使用固定版本，便于记录实验环境；将占位路径换成自己有权检查的应用目录或 ASAR。[安装文档](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md) · [CLI 文档](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/cli.md)

```bash
# 先直接执行静态分析，把完整结果留在文件中
npx rea-agents@6.7.0 analyze-javascript-application "/absolute/path/to/app" --json > app-evidence.json

# 需要连接 Agent 时，先查看 setup 将修改哪些配置
npx rea-agents@6.7.0 setup --dry-run --json

# 再运行交互式 setup，选择客户端并按提示完成
npx rea-agents@6.7.0 setup
```

Setup 会注册 MCP server 并安装配套工作流指令，完成后重启所选客户端。**只安装 skill 得到的是工作指令；实际分析仍需要可用的 server 或 CLI 及对应后端。** 原生分析可用 `doctor --provider ghidra --json` 检查指定后端，避免把不相关后端的缺失误当成整个工具不可用。[Setup 与范围化诊断](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md#check-readiness-for-your-task)

我会把第一条任务写成下面这样，让它有明确的结束条件：

```text
目标：解释这个应用导出 CSV 时怎样处理逗号、引号与换行。

先定位导出入口和格式化函数，给出文件位置或地址及调用关系。
区分直接观察、推断和仍未覆盖的情况。
取得证据后，实现一个最小格式化函数。
用空值、逗号、双引号、换行和非 ASCII 字符做对照测试，
分别列出匹配结果和不一致之处。
```

这是一条调查提示词示例。它把目标限定在可验证的行为上，完成后再决定是否扩大范围。

<details>
<summary>完整分析结果太大时 先提取摘要</summary>

官方 CLI 支持从保存的 Evidence 中提取视图。例如安装了 `jq` 时：

```bash
jq -c '{source: {kind: "inline", evidence: .}, view: {kind: "summary"}}' \
  app-evidence.json > app-view.json
npx rea-agents@6.7.0 inspect-analysis-view app-view.json
```

随后再按模块或分页读取，避免把整份分析反复送进模型。CLI 与 MCP 的状态复用方式不同：独立 CLI 命令使用保存的记录；MCP 保留的 Evidence 引用属于对应连接。[CLI 结果复用](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/cli.md)

</details>

## 怎样判断一项重建值得相信

“能做出相似界面”和“保持原来的行为”之间还有大量工程工作。以影像软件为例，我更倾向于先选一个可以隔离验证的小功能：图像方向处理、导出参数、像素格式转换，或某段有明确输入输出的计算。

下面是我建议的验收方法，属于实验设计，尚不是 REA 在这些任务上的实测结果：

| 检查层次 | 影像工具中的例子 | 应保留的材料 |
| :--- | :--- | :--- |
| 入口与调用 | 导出按钮最后走到哪个编码器 | 版本、代码位置、调用链 |
| 参数与约定 | 色彩空间、位深、alpha、方向信息 | 显式参数与未确定项 |
| 数值行为 | 梯度图、纯色块、边缘值的输出 | 输入样本、逐像素差异、误差容限 |
| 外部行为 | 文件元数据、异常输入、重复执行 | 输出文件与失败记录 |
| 可维护性 | 换版本、换平台后还能否验证 | 可重复运行的构建与测试流程 |

如果把视野扩大到完整编辑器，还要处理文件兼容、插件、GPU 路径、历史行为和交互稳定性。**一个局部功能的成功，是继续投入的依据；产品级完成需要产品级的验收。**

网上常与 REA 一起讨论的 ArtCraft，也应按自己的项目状态阅读。其官方 Crafting Apps 页面将产品描述为从头编写的 Rust 应用，并对 PhotoCraft 标注 early alpha、对多个应用标注 in development。这些说明不能用来证明 REA 已恢复 Adobe 源码或完成等价替代。[ArtCraft 官方应用目录](https://getartcraft.com/apps)

最后，有两个直接影响使用方式的边界：REA 在本地运行分析，但工具结果会交给 Agent，其模型服务的数据处理规则仍然适用；REA 自身的 MIT 许可证也不授予被分析软件或商业后端的权利。[REA 数据说明与许可证范围](https://github.com/morluto/rea/blob/rea-agents-6.7.0/README.md#faq)

我会把 REA 放在“理解旧系统、追踪跨层实现、为兼容重建收集证据”的工具箱里。使用它时最有价值的习惯，是始终留住这条链：**具体问题 → 原始证据 → 行为解释 → 最小实现 → 对照测试**。这条链完整时，Agent 的结论才有条件成为下一步工程决策的依据。

<details>
<summary>资料索引 官方文档 原始案例 独立测评与研究</summary>

**官方实现与协议**

- [REA 官方仓库](https://github.com/morluto/rea)与 [6.7.0 发布记录](https://github.com/morluto/rea/releases/tag/rea-agents-6.7.0)。
- [6.7.0 架构图](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/architecture.mermaid)、[MCP 契约](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/mcp-contracts.md)、[CLI 与 Evidence](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/cli.md)。
- [JavaScript 应用工作流](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/javascript-application-workflows.md)、[原生分析](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/native-investigation.md)、[Android 分析](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/android-analysis.md)。
- [安装与版本边界](https://github.com/morluto/rea/blob/rea-agents-6.7.0/docs/installation.md)、[MCP 官方架构](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture)。

**案例与测试作者的记录**

- [DX-Ball 函数重建](https://rea.tools/showcase/dx-ball/)、[Notion 剪贴板追踪](https://rea.tools/showcase/notion/)、[计算器与恐龙游戏的证据说明](https://github.com/morluto/rea/blob/main/website/evidence/calculator-and-dino.md)。
- [GitTested 对 REA 6.2.0 的对照测评](https://gittested.com/reviews/morluto-rea/)。
- [System Design Academy 对 REA 6.4.0 的覆盖检查](https://www.systemdesign.academy/explained/rea-reverse-engineer-anything)。

**同类工具与研究背景**

- [GhidraMCP](https://github.com/LaurieWired/GhidraMCP)、[ida-pro-mcp](https://github.com/mrexodia/ida-pro-mcp)、[Hex-Rays IDA MCP](https://github.com/HexRaysSA/ida-mcp)。
- [DecompileBench](https://arxiv.org/html/2505.11340v1)、[SRE-Bench v2](https://arxiv.org/abs/2608.11469v2)。
- [ArtCraft 官方 Crafting Apps 目录](https://getartcraft.com/apps)。

</details>
