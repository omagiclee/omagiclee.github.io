+++
date = '2026-10-01T10:00:00+08:00'
draft = false
isCJKLanguage = true
contentLanguage = 'zh-CN'
title = 'ComfyUI 设计架构：从节点画布到模型执行引擎'
description = '用系统架构图、执行时序图和文生图数据流图，理解 ComfyUI 的前后端分工、工作流协议、依赖调度、缓存、显存管理与自定义节点。'
categories = ['AIGC']
tags = ['ComfyUI', '系统架构', '工作流', '扩散模型', '插件架构']
math = false
+++

在 ComfyUI 的画布上，把模型加载、文本编码、采样和图片保存几个节点连起来，就可以生成一张图片。但这条连线背后还有一套完整的软件系统：浏览器把工作流转换成执行图，Python 服务负责校验和排队，执行器按数据依赖调用节点，模型运行层再完成张量计算与设备内存管理。

**理解 ComfyUI，可以沿着“可视化编排 → 图执行 → 模型计算”这三个层次展开。** 本文先画出系统全貌，再沿着一次生成请求，解释每个模块的职责。

本文以开源、自托管 ComfyUI 的核心执行链路为范围，资料核对日期为 **2026-10-01**。下列图是依据官方文档与源码整理的逻辑视图，省略了用户管理、资产管理等辅助模块；不同安装版本的具体实现可能有所差异。

<!--more-->

## 1. 系统架构图：一张工作流如何变成一次推理

ComfyUI 采用客户端—服务器架构：浏览器负责交互，Python 后端负责数据处理和模型执行。除了官方界面，脚本或其他应用也可以直接提交执行图。参见[官方架构概述](https://docs.comfy.org/custom-nodes/overview)。

{{< mermaid >}}
flowchart TB
    accTitle: ComfyUI 核心架构
    accDescr: 两种客户端通过接口提交执行图，Python 服务校验并排队，执行器调度节点，节点调用模型运行层并读写文件。
    UI["<b>浏览器画布</b><br/><span class='diagram-detail'>节点编排 · 进度与结果</span>"]:::client
    API["<b>脚本 / 业务应用</b><br/><span class='diagram-detail'>自动化调用 · HTTP API</span>"]:::client
    Server["<b>接入与任务管理</b><br/><span class='diagram-detail'>PromptServer · 校验 · 队列 · worker</span>"]:::service
    Executor["<b>图执行与结果复用</b><br/><span class='diagram-detail'>PromptExecutor · 依赖调度 · 缓存</span>"]:::engine
    Nodes["<b>节点实现</b><br/><span class='diagram-detail'>内置节点 / 自定义节点</span>"]:::engine
    Core["<b>模型计算与资源管理</b><br/><span class='diagram-detail'>模型 · 编码器 · 采样器<br/>加载 / 卸载 · PyTorch · GPU / CPU</span>"]:::runtime
    Files[("<b>文件资源</b><br/><span class='diagram-detail'>模型权重 / 输入 / 输出</span>")]:::storage
    UI <-->|HTTP / WebSocket| Server
    API <-->|HTTP API| Server
    Server --> Executor --> Nodes --> Core
    Nodes <--> Files
{{< /mermaid >}}

图中的分层表示职责边界。**队列、执行器和模型管理器通常运行在同一个 Python 服务进程中**，不能根据这些方框推断出微服务或分布式部署。标准启动流程在后台线程中运行 `prompt_worker`，由它从队列取出任务并调用执行器。参见[启动与 worker 源码](https://github.com/Comfy-Org/ComfyUI/blob/master/main.py)。

### 1.1 客户端：把用户操作转换成图

客户端主要处理节点搜索、参数编辑、连线、工作流保存，以及进度和结果展示。官方前端独立维护在 [ComfyUI_frontend 仓库](https://github.com/Comfy-Org/ComfyUI_frontend)；当前工程采用 Vue、TypeScript，并使用 LiteGraph 相关图编辑能力。技术栈可从[前端依赖清单](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/package.json)与仓库文档中核对。

前端通过 `/object_info` 获取节点定义，包括输入类型、输出类型、显示名称和分类。这样，后端新增一个节点类型后，客户端就能根据它的声明建立相应的界面。自定义控件等复杂交互，还可以由 JavaScript 扩展补充。参见[服务端节点信息接口](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py)。

### 1.2 服务端：接入请求与维护任务状态

`server.py` 中的 `PromptServer` 使用 `aiohttp` 提供 HTTP 与 WebSocket 接口。几个与生成链路直接相关的接口是：

| 接口 | 作用 |
| --- | --- |
| `POST /prompt` | 接收执行图，校验后加入队列 |
| `GET /object_info` | 查询节点类型及输入输出定义 |
| `GET /queue` | 查询运行中与等待中的任务 |
| `GET /history/{prompt_id}` | 查询指定任务的历史结果 |
| `GET /view` | 获取输出或预览文件 |
| `WS /ws` | 接收状态、节点执行、进度等实时通知 |

提交成功时返回的 `prompt_id` 是任务标识，**不是生成结果已经就绪的证明**。调用方还需要等待执行事件或查询历史。接口职责见[官方服务端路由文档](https://docs.comfy.org/development/comfyui-server/comms_routes)。

### 1.3 执行器：把图中的节点变成函数调用

`PromptExecutor` 管理一次任务的执行上下文、缓存、错误和结果；`comfy_execution/graph.py` 中的 `ExecutionList` 维护依赖关系，选择可执行的节点。执行器再根据节点类型找到实现，解析输入，并调用节点声明的执行函数。参见[执行器源码](https://github.com/Comfy-Org/ComfyUI/blob/master/execution.py)与[图调度源码](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_execution/graph.py)。

画布上的坐标决定视觉布局，连线决定数据依赖。把节点拖到左边，不会让它更早执行；同样，没有依赖关系的两个节点也没有固定的先后保证。

### 1.4 模型运行层：完成实际计算

节点是可组合的功能入口。例如，模型加载节点调用权重加载逻辑，采样节点调用采样器，VAE 解码节点调用解码模型。`comfy/` 下的模块承担这些底层能力，PyTorch 执行实际张量运算。

模型管理代码负责设备选择、模型驻留、加载与卸载等资源决策。具体策略受硬件、启动参数和版本影响，所以“工作流能否运行”还取决于模型大小、中间张量、分辨率和批量大小。参见[模型与设备管理源码](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/model_management.py)。

## 2. 两种 JSON：界面工作流与后端执行图

ComfyUI 的 JSON 在两个层面承担不同职责：

| 表示 | 核心内容 | 主要用途 |
| --- | --- | --- |
| 界面工作流 JSON | 节点、位置、连线、控件值等编辑状态 | 保存、分享和恢复画布 |
| API 执行图 JSON | 节点 ID、`class_type`、`inputs` | 让后端执行任务 |

调用 `POST /prompt` 时，`prompt` 字段需要放入后端可执行的节点映射。可视化工作流需要先转换成这种表示。官方前端的转换逻辑可在 [`graphToPrompt`](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/utils/executionUtil.ts) 所在文件中查阅。

下面是一个执行图的**局部片段**，只展示 VAE 解码节点的输入连接，不能单独提交运行：

```json
{
  "8": {
    "class_type": "VAEDecode",
    "inputs": {
      "samples": ["3", 0],
      "vae": ["4", 2]
    }
  }
}
```

这里 `"8"` 是节点 ID，`VAEDecode` 是注册的节点类型。`["3", 0]` 表示读取节点 `3` 的第 `0` 个输出；`["4", 2]` 表示读取节点 `4` 的第 `2` 个输出。输出槽位从零开始计数。输入也可以是字符串、数值等参数常量。

这个协议把“调用哪个节点”和“它需要哪些上游数据”明确写进图里。链接解析规则可在[图工具源码](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_execution/graph_utils.py)中核对。

## 3. 执行时序图：点击 Run 之后发生什么

{{< mermaid >}}
---
config:
  sequence:
    width: 140
    actorMargin: 24
    messageFontSize: 14
    noteFontSize: 14
---
sequenceDiagram
    accTitle: 一次 ComfyUI 生成请求的时序
    accDescr: 客户端提交执行图，服务端校验并入队，worker 调用执行器处理节点，WebSocket 反馈进度，客户端查询历史并获取文件。
    participant C as 客户端
    participant S as PromptServer
    participant Q as PromptQueue
    participant E as Worker / Executor
    participant N as 节点与模型
    C->>S: WS /ws + GET /object_info
    C->>C: 画布 → API 执行图
    C->>S: POST /prompt
    S->>S: 校验节点、输入与依赖
    alt 校验失败
        S-->>C: error / node_errors
    else 校验通过
        S->>Q: 任务入队
        S-->>C: prompt_id / number
        E->>Q: 取出任务
        E->>E: 初始化执行图与缓存
        E-->>S: 开始执行 / 缓存命中事件
        S-->>C: WebSocket 事件
        loop 按依赖执行所需节点
            E->>N: 解析输入并调用节点
            N-->>E: 节点输出
            N-->>S: 进度 / 可用的预览
            S-->>C: WebSocket 进度 / 预览
        end
        E->>Q: 完成任务并记录历史
        C->>S: GET /history/{prompt_id}
        S-->>C: 输出信息与任务状态
        C->>S: GET /view 获取文件
        S-->>C: 图片等输出文件
    end
{{< /mermaid >}}

这是成功执行路径的简化时序。实际运行还可能因节点异常、中断或内存不足而提前结束；预览也取决于节点、配置和客户端能力。HTTP 负责提交和查询，WebSocket 负责及时反馈。流程依据[服务端源码](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py)、[worker 源码](https://github.com/Comfy-Org/ComfyUI/blob/master/main.py)与[执行器源码](https://github.com/Comfy-Org/ComfyUI/blob/master/execution.py)整理。

## 4. 图调度与缓存：为什么第二次运行会更快

### 4.1 从输出目标收集依赖，按就绪顺序执行

常见输出目标是 `SaveImage`、`PreviewImage` 等输出节点。调度器从需要执行的目标收集上游依赖，再选择依赖已经满足的节点。普通静态数据流可以用有向无环图理解；较复杂的节点还可以在运行时扩展子图。

当前核心调度采用拓扑方式，并允许在执行中补充依赖。旧资料中“从输出一路递归调用上游”的描述，不能完整代表当前实现。官方[执行模型迁移说明](https://docs.comfy.org/development/comfyui-server/execution_model_inversion_guide)明确记录了这一变化。

### 4.2 复用的是满足缓存条件的节点输出

在缓存启用且结果仍可用的情况下，输入与相关上游依赖未变化的节点，可以复用已有输出。缓存判定还考虑节点自身的变化检测等信息；文件读取、外部状态或随机行为，需要节点提供合适的变化语义。相关实现见[缓存源码](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_execution/caching.py)。

以普通文生图工作流为例：

| 修改内容 | 通常需要重新计算的部分 |
| --- | --- |
| 只修改正向提示词 | 对应文本编码、采样，以及后续解码和输出 |
| 只修改采样 seed | 采样，以及后续解码和输出 |
| 更换 checkpoint | 依赖新模型、文本编码器或 VAE 的分支 |
| 只移动画布节点位置 | 通常不改变后端计算输入 |

这张表是普通节点契约下的推导，实际结果还受缓存配置、缓存淘汰和自定义节点行为影响。缓存节省了重复计算，也需要占用内存；节点结果缓存与模型权重驻留是两套相关但不同的机制。

### 4.3 惰性求值与子图扩展

条件选择节点可以声明惰性输入，先确定需要哪个分支，再要求执行器补齐该分支依赖。只有按惰性协议实现的节点才能获得这种行为，普通连线不会自动产生条件执行。参见[惰性求值文档](https://docs.comfy.org/custom-nodes/backend/lazy_evaluation)。

节点还可以返回一个新子图，把复杂逻辑交给已有节点继续执行，这就是 Node Expansion。它让复合功能能够利用图执行器的依赖管理和缓存。参见[子图扩展文档](https://docs.comfy.org/custom-nodes/backend/expansion)。

## 5. 文生图数据流：架构落到具体节点上

下面用经典 Stable Diffusion 文生图链路说明节点间传递的对象。不同模型家族会使用不同的加载器、编码器或采样组合，这张图对应的是常见入门工作流。

{{< mermaid >}}
---
config:
  layout: elk
---
flowchart TB
    accTitle: Stable Diffusion 文生图数据流
    accDescr: Checkpoint 提供 MODEL、CLIP 和 VAE。提示词经文本编码生成条件，采样器结合条件与潜变量去噪，VAE 解码后保存图片。
    Checkpoint["<b>加载模型</b><br/><span class='diagram-detail'>CheckpointLoaderSimple</span>"]:::client
    Positive["<b>正向提示词编码</b><br/><span class='diagram-detail'>CLIPTextEncode</span>"]:::service
    Negative["<b>负向提示词编码</b><br/><span class='diagram-detail'>CLIPTextEncode</span>"]:::service
    Empty["<b>潜空间画布</b><br/><span class='diagram-detail'>EmptyLatentImage</span>"]:::storage
    Params["<b>采样参数</b><br/><span class='diagram-detail'>seed · steps · cfg · sampler</span>"]:::storage
    Sampler["<b>采样与去噪</b><br/><span class='diagram-detail'>KSampler</span>"]:::engine
    Decode["<b>解码为图像</b><br/><span class='diagram-detail'>VAEDecode</span>"]:::runtime
    Save["<b>保存图片</b><br/><span class='diagram-detail'>SaveImage</span>"]:::runtime
    Checkpoint -->|CLIP| Positive
    Checkpoint -->|CLIP| Negative
    Checkpoint -->|MODEL| Sampler
    Positive -->|CONDITIONING| Sampler
    Negative -->|CONDITIONING| Sampler
    Empty -->|LATENT| Sampler
    Params --> Sampler
    Sampler -->|LATENT| Decode
    Checkpoint -->|VAE| Decode
    Decode -->|IMAGE| Save
{{< /mermaid >}}

`EmptyLatentImage` 创建指定尺寸的潜空间数据；在这个工作流中，采样器依据 seed 等参数生成噪声并进行迭代去噪。文本编码节点生成条件信息，去噪模型参与采样，VAE 将采样后的潜变量解码成像素图像。节点实现见[内置节点源码](https://github.com/Comfy-Org/ComfyUI/blob/master/nodes.py)。

节点端口上的 `MODEL`、`CLIP`、`VAE`、`CONDITIONING`、`LATENT`、`IMAGE` 是数据契约。后端传递的值可能是模型对象、张量或包含张量的容器。例如 `LATENT` 常用包含 `samples` 的字典表示，`IMAGE` 常用批次、高度、宽度、通道顺序的张量表示。参见[节点数据类型](https://docs.comfy.org/custom-nodes/backend/datatypes)与[图像和潜变量文档](https://docs.comfy.org/custom-nodes/backend/images_and_masks)。

这也解释了为什么一条线不能随意连接：图片、潜变量和条件信息有不同的语义与结构，即使底层都涉及张量，也需要显式转换节点才能组合。

## 6. 插件架构：新增能力如何接入系统

自定义节点通过节点注册契约接入执行系统。经典 V1 API 中，插件导出 `NODE_CLASS_MAPPINGS`，把节点类型名称映射到 Python 类；节点类声明 `INPUT_TYPES`、`RETURN_TYPES` 和 `FUNCTION` 等信息。前端扩展则可以通过 `WEB_DIRECTORY` 提供 JavaScript。参见[节点生命周期](https://docs.comfy.org/custom-nodes/backend/lifecycle)与[节点属性文档](https://docs.comfy.org/custom-nodes/backend/server_overview)。

| 扩展内容 | 接入位置 | 例子 |
| --- | --- | --- |
| Python 节点 | 节点注册与后端执行 | 新模型加载器、图像处理、采样方法 |
| JavaScript 扩展 | 前端扩展机制 | 自定义控件、画布交互、结果面板 |
| 自定义 HTTP 路由 | Python 服务的路由表 | 插件需要的额外查询接口 |

这里描述的是仍常见的 V1 契约；新节点也可以采用[官方 V3 API](https://docs.comfy.org/custom-nodes/v3_migration)，不应把 V1 的类属性误认为所有节点实现唯一的写法。

插件能力与执行框架的关系可以概括为：**插件声明输入、输出和计算逻辑，框架负责发现、校验、调度与结果反馈。** 普通 Python 自定义节点加载在后端进程中，其内部仍需正确管理资源与副作用。

对于通过 API 调用的业务应用，还需要检查工作流是否依赖前端交互。有些扩展要求浏览器与后端进行额外通信，不能假设导出 JSON 后就可以完整自动化。这个边界在[官方自定义节点概述](https://docs.comfy.org/custom-nodes/overview)中也有说明。

## 7. 从架构中能得到哪些设计启发

从上述实现可以归纳出三个值得借鉴的设计选择：

1. **用明确的数据契约组合能力。** 节点之间交换模型对象、条件或图像，连线表达真实的数据依赖，方便替换和复用局部能力。
2. **把编辑表示与执行表示分开。** 画布可以保留丰富的交互状态，后端则围绕执行图建立统一入口，让脚本和业务系统也能调用。
3. **把算法功能与执行机制分开。** 新节点贡献计算逻辑，依赖调度、缓存和任务反馈由框架统一处理。

这些设计尤其适合交互式、反复调整局部参数的生成任务。如果进一步搭建多用户服务，还需要围绕鉴权、任务隔离、持久化、失败恢复与多 worker 调度补充部署设计；图执行器提供的是这些系统可以使用的计算基础。

## 参考资料与源码导航

阅读源码时，可以按“请求进入 → worker 取任务 → 执行图调度 → 节点调用 → 模型运行”的顺序查阅：

| 阅读目标 | 官方资料 |
| --- | --- |
| 客户端与服务端分工 | [Custom Nodes Overview](https://docs.comfy.org/custom-nodes/overview) |
| HTTP / WebSocket 协议 | [Server Routes](https://docs.comfy.org/development/comfyui-server/comms_routes) |
| 启动与执行 worker | [main.py](https://github.com/Comfy-Org/ComfyUI/blob/master/main.py) |
| 请求接入与节点信息 | [server.py](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py) |
| 执行器与任务队列 | [execution.py](https://github.com/Comfy-Org/ComfyUI/blob/master/execution.py) |
| 拓扑依赖与动态执行图 | [comfy_execution/graph.py](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_execution/graph.py) |
| 节点输出缓存 | [comfy_execution/caching.py](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_execution/caching.py) |
| 内置节点与模型资源管理 | [nodes.py](https://github.com/Comfy-Org/ComfyUI/blob/master/nodes.py)、[model_management.py](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/model_management.py) |
| 官方前端 | [ComfyUI_frontend](https://github.com/Comfy-Org/ComfyUI_frontend) |
