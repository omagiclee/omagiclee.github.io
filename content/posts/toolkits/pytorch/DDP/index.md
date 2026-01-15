+++
date = '2025-08-23T13:36:45+08:00'
draft = false
title = 'Distributed Data Parallel (DDP)'
organization = []
categories = []
tags = []
+++

## torch.distributed Package Overview
### Parallelism APIs
- Distributed Data Parallel (DDP)
- Fully Sharded Data Parallel (FSDP2)
- Tensor Parallel (TP)
- Pipeline Parallel (PP)

### Sharding primitives

### Communications APIs
- collective communication APIs
    - all_reduce
    - all_gather
- P2P communication APIs
    - send
    - isend

### Launcher
**torchrun** is a widely-used launcher script, which spawns processes on the local and remote machines for running distributed PyTorch programs.

## Distributed Data Parallel (DDP)
DDP uses collective communications from the torch.distributed package to synchronize gradients and buffers across all GPUs

### DataParallel vs DistributedDataParallel

| DataParallel | DistributedDataParallel |
|:-----------:|:----------------------:|
| More overhead; model is replicated and destroyed at each forward pass | Model is replicated only once |
| Only supports single-node parallelism | Supports scaling to multiple machines |
| Slower; uses multithreading on a single process and runs into Global Interpreter Lock (GIL) contention | Faster (no GIL contention) because it uses multiprocessing |

bucketed Ring-AllReduce 算法聚合所有副本的梯度；将梯度计算与通信重叠，不用等到所有梯度都计算完毕就开始同步

DistributedSampler ensures each device gets a non-overlapping input batch.
The model is replicated on all the devices.

each replica calculates gradients and simultaneously synchronizes with the others using the ring all-reduce algorithm.

### DDP

1. Compute the gradient of the loss function using a minibatch on each GPU.
2. Compute the mean of the gradients by inter-GPU communication.
3. Update the model parameters.

To compute the mean of the gradients across GPUs, we use a collective communication operation called **"AllReduce"**.

One of the fastest collective communication libraries for GPU clusters is **NVIDIA Collective Communications Library (NCCL)**, which employs the **Ring-AllReduce** algorithm.

### Ring-AllReduce
**AllReduce** is an operation that reduces the target arrays in all processes to a single array and returns the resultant array to all processes.

the **Ring-AllReduce** algorithm

{{< mermaid >}}
graph LR
    subgraph "Ring-AllReduce Algorithm (4 GPUs)"
        direction TB
        
        subgraph "Phase 1: Scatter-Reduce"
            direction LR
            GPU0_1[GPU 0<br/>A=1]
            GPU1_1[GPU 1<br/>B=2]
            GPU2_1[GPU 2<br/>C=3]
            GPU3_1[GPU 3<br/>D=4]
            
            GPU0_1 -->|"A→B"| GPU1_1
            GPU1_1 -->|"B→C"| GPU2_1
            GPU2_1 -->|"C→D"| GPU3_1
            GPU3_1 -->|"D→A"| GPU0_1
        end
        
        subgraph "Phase 2: AllGather"
            direction LR
            GPU0_2[GPU 0<br/>A+B+C+D]
            GPU1_2[GPU 1<br/>A+B+C+D]
            GPU2_2[GPU 2<br/>A+B+C+D]
            GPU3_2[GPU 3<br/>A+B+C+D]
            
            GPU0_2 -->|"Sum→B"| GPU1_2
            GPU1_2 -->|"Sum→C"| GPU2_2
            GPU2_2 -->|"Sum→D"| GPU3_2
            GPU3_2 -->|"Sum→A"| GPU0_2
        end
    end
    
    subgraph "Algorithm Steps"
        direction TB
        Step1["1. Scatter-Reduce:<br/>Each GPU sends its data<br/>to the next GPU in the ring"]
        Step2["2. AllGather:<br/>Each GPU receives<br/>the complete sum"]
        Step3["3. Result:<br/>All GPUs have<br/>the same final result"]
        
        Step1 --> Step2
        Step2 --> Step3
    end
    
    %% Styling
    classDef gpuClass fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef stepClass fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    
    class GPU0_1,GPU1_1,GPU2_1,GPU3_1,GPU0_2,GPU1_2,GPU2_2,GPU3_2 gpuClass
    class Step1,Step2,Step3 stepClass
{{< /mermaid >}}

**Ring-AllReduce 算法特点：**
- **通信复杂度**: O(N) 而不是 O(N²)
- **带宽利用**: 每个GPU同时发送和接收数据
- **可扩展性**: 支持任意数量的GPU节点
- **容错性**: 单点故障不会影响整个环









## References
- https://docs.pytorch.org/tutorials/beginner/ddp_series_intro.html
- https://tech.preferred.jp/en/blog/technologies-behind-distributed-deep-learning-allreduce/














## 名词解释
**PCIe** (Peripheral Component Interconnect Express，外设组件高速互连总线） 指的是 CPU、GPU、存储设备、网卡等硬件之间的数据传输通道标准。

它的核心作用就是 提供 GPU ↔ CPU、GPU ↔ GPU、GPU ↔ 其他外设 的通信带宽。

**NVLink** 是 NVIDIA 开发的 GPU 互联技术，用于 GPU 之间的直接通信。

**NVSwitch** 是 NVIDIA 开发的交换芯片，用于 GPU 之间的通信。

**IB (InfiniBand)** 是一种高带宽、低延迟的跨服务器间的网络互联架构，由 InfiniBand Trade Association (IBTA) 制定标准，广泛用于高性能计算（HPC）、人工智能训练等场景。
- 高带宽
    - SDR (Single Data Rate): 10Gbps
    - DDR (Double Data Rate): 20Gbps
    - QDR (Quad Data Rate): 40Gbps
    - FDR (Fourteen Data Rate): 56Gbps
    - EDR (Enhanced Data Rate): 100Gbps
    - **HDR (High Data Rate, 主流): 200Gbps**
       - Lane: 单通道速率
       - Link(4X): 通常由4条 Lane 组成
    - **NDR (Next Data Rate, 主流): 400Gbps**
    - XDR (eXtreme Data Rate): 800Gbps
- 低延迟：µs 级，甚至＜1 µs，远低于万兆以太网（1000Mbps）
- RDMA (Remote Direct Memory Access)：零拷贝通信
- 可扩展性：采用交换机架构，支持大规模集群的扩展。
- 无损网络：不会因为拥堵而丢弃数据包


{{< mermaid >}}
graph LR;
    subgraph "Node 0 (8x A100)"
        direction TB
        GPU0_0[GPU 0<br/>A100]
        GPU0_1[GPU 1<br/>A100]
        GPU0_2[GPU 2<br/>A100]
        GPU0_ELLIPSIS[...]
        
        subgraph "NVSwitch 0"
            NVS0[NVSwitch<br/>A100]
        end
        
        CPU0[CPU 0]
        IB0[IB HCA 0<br/>200Gbps]
    end
    
    subgraph "Node 1 (8x A100)"
        direction TB
        GPU1_0[GPU 0<br/>A100]
        GPU1_1[GPU 1<br/>A100]
        GPU1_2[GPU 2<br/>A100]
        GPU1_ELLIPSIS[...]
        
        subgraph "NVSwitch 1"
            NVS1[NVSwitch<br/>A100]
        end
        
        CPU1[CPU 1]
        IB1[IB HCA 1<br/>200Gbps]
    end
    
    %% More nodes
    ELLIPSIS[...]
    
    %% IB Switch
    IBSW[IB Switch<br/>HDR 200Gbps]
    
    %% NVSwitch connections - All-to-All topology
    GPU0_0 -.->|NVLink 3.0<br/>600GB/s| NVS0
    GPU0_1 -.->|NVLink 3.0<br/>600GB/s| NVS0
    GPU0_2 -.->|NVLink 3.0<br/>600GB/s| NVS0
    GPU0_ELLIPSIS -.->|NVLink 3.0<br/>600GB/s| NVS0
    
    GPU1_0 -.->|NVLink 3.0<br/>600GB/s| NVS1
    GPU1_1 -.->|NVLink 3.0<br/>600GB/s| NVS1
    GPU1_2 -.->|NVLink 3.0<br/>600GB/s| NVS1
    GPU1_ELLIPSIS -.->|NVLink 3.0<br/>600GB/s| NVS1
    
    %% All GPUs connect to CPU (for control/management)
    GPU0_0 -->|PCIe 4.0<br/>Control| CPU0
    GPU0_1 -->|PCIe 4.0<br/>Control| CPU0
    GPU0_2 -->|PCIe 4.0<br/>Control| CPU0
    
    GPU1_0 -->|PCIe 4.0<br/>Control| CPU1
    GPU1_1 -->|PCIe 4.0<br/>Control| CPU1
    GPU1_2 -->|PCIe 4.0<br/>Control| CPU1
    
    %% GPUDirect RDMA connections (GPU directly to IB HCA)
    GPU0_0 -.->|GPUDirect RDMA<br/>PCIe 4.0| IB0
    GPU0_1 -.->|GPUDirect RDMA<br/>PCIe 4.0| IB0
    GPU0_2 -.->|GPUDirect RDMA<br/>PCIe 4.0| IB0
    
    GPU1_0 -.->|GPUDirect RDMA<br/>PCIe 4.0| IB1
    GPU1_1 -.->|GPUDirect RDMA<br/>PCIe 4.0| IB1
    GPU1_2 -.->|GPUDirect RDMA<br/>PCIe 4.0| IB1
    
    %% CPU to IB HCA connections (control path)
    CPU0 -->|PCIe 4.0<br/>Control| IB0
    CPU1 -->|PCIe 4.0<br/>Control| IB1
    
    %% IB Switch connections
    IB0 -->|IB HDR<br/>200Gbps| IBSW
    IB1 -->|IB HDR<br/>200Gbps| IBSW
    ELLIPSIS -->|IB HDR<br/>200Gbps| IBSW
    
    %% Style definitions
    classDef gpuClass fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef cpuClass fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef ibClass fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef nvswitchClass fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef ellipsisClass fill:#f5f5f5,stroke:#9e9e9e,stroke-width:1px
    
    class GPU0_0,GPU0_1,GPU0_2,GPU1_0,GPU1_1,GPU1_2 gpuClass
    class CPU0,CPU1 cpuClass
    class IB0,IB1,IBSW ibClass
    class NVS0,NVS1 nvswitchClass
    class ELLIPSIS,GPU0_ELLIPSIS,GPU1_ELLIPSIS ellipsisClass
{{< /mermaid >}}

备注：
- HCA (Host Channel Adapter)：安装在 CPU 上，负责管理 IB 网络连接。
- IB Switch：用于连接多个 IB 节点，提供网络交换功能。
无损网络：InfiniBand 是一种无损网络，这意味着它不会因为拥堵而丢弃数据包。这对于需要保证数据完整性和一致性的高性能计算任务非常关键。

**RDMA (Remote Direct Memory Access)** 是网络协议，用于跨机器通信。

### GPUDirect RDMA 技术

**GPUDirect RDMA** 允许 GPU 显存与网络设备（如 IB 网卡）之间进行直接数据传输，无需经过 CPU 内存拷贝。

**优势：**
- **零拷贝**：数据直接从 GPU 显存传输到网络
- **低延迟**：减少 CPU 参与，降低通信延迟
- **高带宽**：充分利用 PCIe 带宽
- **CPU 卸载**：减少 CPU 开销，提高整体性能

**工作原理：**
- IB 网卡可以直接访问 GPU 显存
- 通过 PCIe 进行直接 DMA 传输
- CPU 只负责控制和管理，不参与数据传输

### NVSwitch 全互联架构

**NVSwitch** 是 NVIDIA 的专用交换芯片，实现 GPU 间的全互联通信。

**优势：**
- **全互联拓扑**：任意两个 GPU 之间都有等带宽连接
- **高带宽**：每个 GPU 到 NVSwitch 的带宽可达 600GB/s
- **低延迟**：专用交换芯片，延迟极低
- **可扩展性**：支持多 GPU 集群

**工作原理：**
- 所有 GPU 通过 NVLink 连接到 NVSwitch
- NVSwitch 作为中央交换机，实现任意 GPU 间的通信
- 相比点对点连接，全互联拓扑提供更好的通信性能

**DGX A100 实际配置：**
- 8个 A100 GPU
- 1个 NVSwitch 芯片
- 每个 GPU 有 12-18 条 NVLink 连接到 NVSwitch
- 总带宽：600-900 GB/s 每 GPU
远程直接内存访问 (RDMA)：这是 InfiniBand 的核心技术。RDMA 允许一个服务器的应用程序直接访问另一个服务器的内存，而无需操作系统或CPU的干预。这极大地减少了数据传输的开销，并显著降低了延迟。

Port

IB 设备上的接口，每个 Port 可以支持 1X、2X、4X、8X、12X 链路宽度。

常见是 4X (主流) 和 12X (用于大规模交换机内部互联)。
例子：NVIDIA/Mellanox ConnectX 系列 (CX-5, CX-6, CX-7, CX-8)。‘
’
## Architecture





1. 显存占用：如果使用 Adam 优化器，显存占用≈3倍参数大小
2. DDP 通信：梯度，梯度大小和参数大小一致（混精度除外）
3. IB + RDMA

作用：跨机器高速通信，通常配合 RDMA (Remote Direct Memory Access)。

HDR IB：200 Gbps ≈ 25 GB/s

NDR IB：400 Gbps ≈ 50 GB/s

远低于 NVLink 带宽，但远高于万兆以太网。

DDP 的 跨节点 AllReduce 优先走 IB（比如使用 NCCL + IB/RDMA 后端）。
* 带宽（常见配置）：200Gbps (≈25 GB/s)、400Gbps (≈50 GB/s)。
* 常见于“非满互联”的服务器拓扑，比如 4 卡只有局部 NVLink 连接。
* 梯度必须出机器 → 从 GPU 内存经 PCIe → CPU 内存 / NIC → IB / Ethernet。NVLink 只能在单机范围内加速，跨机还是要经过 PCIe。
* NVLink 3.0（A100）单链路带宽 50 GB/s，A100 有 12–18 条 NVLink，单卡总带宽最高 600–900 GB/s。NVSwitch 作为交换芯片，能实现 全互联拓扑（任意两卡直接等带宽通信）。

PCIe 在跨节点通信中的作用

GPU 内存的数据要先经由 PCIe DMA 传给 NIC (IB 网卡)。

有 NVLink 的 GPU 不能直接“跳过 PCIe”写 IB，只能 GPU 内通信用 NVLink，出机器还是得走 PCIe→NIC。

所以 PCIe 是 IB 的前置通道，这里 PCIe 可能成为瓶颈。

RDMA + GPUDirect 可以让 IB NIC 直接访问 GPU 显存，减少 CPU 拷贝。

NVLink vs. NVSwitch 有啥区别？

定位

NVLink：GPU↔GPU 的点对点高速直连链路（也可连到 NVSwitch）。相当于“线缆/通道”本身。

NVSwitch：专用交换芯片，把多块 GPU 的 NVLink 统一“交换/转发”，形成**全互联（all-to-all）**的单机高带宽网络。相当于“交换机/背板”。

“万兆以太网”带宽换算成 GB

“万兆以太网”= 10 Gigabit Ethernet (10 GbE)

理论线速（十进制）：

10
 Gb/s
÷
8
=
1.25
 GB/s
10 Gb/s÷8=1.25 GB/s

换成 GiB/s（2 进制）：

10
 Gb/s
÷
(
8
×
1.073741824
)
≈
1.16
 GiB/s
10 Gb/s÷(8×1.073741824)≈1.16 GiB/s

实际应用层吞吐（考虑协议/编码开销）：常见在 ~9.4 Gb/s 左右
≈ 1.175 GB/s（或 ~1.10 GiB/s）

小结：10 GbE 理论 1.25 GB/s，实际到应用层通常 ~1.1–1.2 GB/s。

路径必经之处：即便用了 GPUDirect RDMA，NIC 也仍然经由 PCIe 直接 DMA 访问 GPU 显存（绕过 CPU 内存，但不绕过 PCIe），所以 GPU→NIC 这段带宽上限仍受 PCIe 限制。

分层 AllReduce


1. 5090
2. 标配系统，支持 nsight 和 ncompute

<!-- ## Mermaid 版本检测

<script>
document.addEventListener('DOMContentLoaded', function() {
    // 智能检测并升级 Mermaid 版本
    console.log('=== 开始智能检测 Mermaid 版本 ===');
    
    // 等待页面完全加载后再检测
    setTimeout(function() {
        // 检查当前 Mermaid 版本
        if (typeof mermaid !== 'undefined' && mermaid && mermaid.version) {
            const currentVersion = mermaid.version;
            console.log('当前 Mermaid 版本:', currentVersion);
            
            // 如果版本已经是 10.6.1 或更高，不需要升级
            if (currentVersion === '10.6.1' || currentVersion === '11.10.1') {
                console.log('Mermaid 版本已经是最新，无需升级');
            } else {
                console.log('检测到旧版本，开始升级到 10.6.1');
                upgradeMermaid();
            }
        } else {
            console.log('Mermaid 未加载，等待加载完成...');
            // 等待 Mermaid 加载完成后再检测
            setTimeout(checkAndUpgradeMermaid, 3000);
        }
    }, 1000);
    
    function checkAndUpgradeMermaid() {
        if (typeof mermaid !== 'undefined' && mermaid && mermaid.version) {
            const currentVersion = mermaid.version;
            console.log('延迟检测到的 Mermaid 版本:', currentVersion);
            
            if (currentVersion !== '10.6.1' && currentVersion !== '11.10.1') {
                console.log('开始升级到 10.6.1');
                upgradeMermaid();
            }
        } else {
            console.log('Mermaid 仍然未加载，尝试强制加载...');
            forceLoadMermaid();
        }
    }
    
    function forceLoadMermaid() {
        console.log('=== 强制加载 Mermaid 10.6.1 ===');
        
        // 创建新的 Mermaid 脚本标签
        const mermaidScript = document.createElement('script');
        mermaidScript.src = 'https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js';
        mermaidScript.onload = function() {
            console.log('CDN 版本的 Mermaid 10.6.1 加载成功');
            
            // 等待新版本完全加载
            setTimeout(() => {
                if (typeof mermaid !== 'undefined') {
                    // 初始化 Mermaid
                    mermaid.initialize({
                        startOnLoad: true,
                        theme: 'default'
                    });
                    
                    // 重新渲染所有 Mermaid 图表
                    mermaid.init(undefined, '.mermaid');
                    console.log('Mermaid 图表重新渲染完成');
                }
            }, 100);
        };
        
        mermaidScript.onerror = function() {
            console.error('CDN 版本的 Mermaid 加载失败');
        };
        
        // 添加到页面头部
        document.head.appendChild(mermaidScript);
    }
    
    function upgradeMermaid() {
        console.log('=== 开始升级 Mermaid 到 10.6.1 ===');
        
        // 保存当前的 Mermaid 配置
        const currentConfig = mermaid ? mermaid.getConfig() : {};
        
        // 移除现有的 Mermaid 脚本
        const existingMermaidScripts = document.querySelectorAll('script[src*="mermaid"]');
        existingMermaidScripts.forEach(script => {
            console.log('移除现有 Mermaid 脚本:', script.src);
            script.remove();
        });
        
        // 创建新的 Mermaid 脚本标签
        const mermaidScript = document.createElement('script');
        mermaidScript.src = 'https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js';
        mermaidScript.onload = function() {
            console.log('CDN 版本的 Mermaid 10.6.1 加载成功');
            
            // 等待新版本完全加载
            setTimeout(() => {
                if (typeof mermaid !== 'undefined') {
                    // 恢复配置
                    mermaid.initialize({
                        startOnLoad: true,
                        theme: 'default',
                        ...currentConfig
                    });
                    
                    // 重新渲染所有 Mermaid 图表
                    mermaid.init(undefined, '.mermaid');
                    console.log('Mermaid 图表重新渲染完成');
                }
            }, 100);
        };
        
        mermaidScript.onerror = function() {
            console.error('CDN 版本的 Mermaid 加载失败');
        };
        
        // 添加到页面头部
        document.head.appendChild(mermaidScript);
    }
    
    // 延迟检测版本
    setTimeout(function() {
        console.log('=== Mermaid 版本检测开始 ===');
        console.log('mermaid 对象类型:', typeof mermaid);
        console.log('window.mermaid 类型:', typeof window.mermaid);
        
        // 检查页面上的所有脚本
        const allScripts = document.querySelectorAll('script[src]');
        console.log('页面上的所有脚本:', allScripts.length);
        allScripts.forEach((script, index) => {
            console.log(`脚本 ${index + 1}:`, script.src);
        });
        
        // 检查 Mermaid 相关脚本
        const mermaidScripts = document.querySelectorAll('script[src*="mermaid"]');
        console.log('Mermaid 相关脚本数量:', mermaidScripts.length);
        mermaidScripts.forEach((script, index) => {
            console.log(`Mermaid 脚本 ${index + 1}:`, script.src);
        });
        
        let versionInfo = '';
        
        if (typeof mermaid !== 'undefined' && mermaid && mermaid.version) {
            console.log('mermaid 对象存在，版本:', mermaid.version);
            
            let version = mermaid.version;
            let versionSource = 'mermaid.version';
            
            // 检查页面上的脚本标签
            const mermaidScriptsList = Array.from(mermaidScripts)
                .map(script => script.src)
                .join('<br>');
            
            versionInfo = `
                <div style="background: #d4edda; padding: 15px; border-radius: 5px; margin: 10px 0; border: 1px solid #c3e6cb;">
                    <h4>✅ Mermaid 版本信息</h4>
                    <p><strong>版本：</strong> ${version} (来源: ${versionSource})</p>
                    <p><strong>状态：</strong> 正常运行</p>
                    <p><strong>配置：</strong> 强制加载 CDN 版本 10.6.1</p>
                    <p><strong>期望版本：</strong> 10.6.1</p>
                    <p><strong>页面中的 Mermaid 脚本：</strong></p>
                    <div style="background: #f8f9fa; padding: 10px; border-radius: 3px; font-family: monospace; font-size: 12px;">
                        ${mermaidScriptsList || '无'}
                    </div>
                    <p><strong>总脚本数量：</strong> ${allScripts.length}</p>
                </div>
            `;
        } else {
            console.log('mermaid 对象不存在');
            
            // 检查是否有 Mermaid 脚本但对象未定义
            let mermaidScriptInfo = '';
            if (mermaidScripts.length > 0) {
                mermaidScriptInfo = `
                    <p><strong>发现 Mermaid 脚本但对象未定义：</strong></p>
                    <div style="background: #fff3cd; padding: 10px; border-radius: 3px; font-family: monospace; font-size: 12px;">
                        ${Array.from(mermaidScripts).map(script => script.src).join('<br>')}
                    </div>
                `;
            }
            
            versionInfo = `
                <div style="background: #f8d7da; padding: 15px; border-radius: 5px; margin: 10px 0; border: 1px solid #f5c6cb;">
                    <h4>❌ Mermaid 未加载</h4>
                    <p><strong>配置：</strong> 强制加载 CDN 版本 10.6.1</p>
                    <p><strong>期望版本：</strong> 10.6.1</p>
                    <p><strong>可能的原因：</strong></p>
                    <ul>
                        <li>CDN 配置未生效</li>
                        <li>网络连接问题</li>
                        <li>版本号错误</li>
                        <li>主题配置问题</li>
                        <li>脚本加载失败</li>
                    </ul>
                    ${mermaidScriptInfo}
                    <p><strong>总脚本数量：</strong> ${allScripts.length}</p>
                    <p><strong>Mermaid 脚本数量：</strong> ${mermaidScripts.length}</p>
                </div>
            `;
        }
        
        // 在页面中显示版本信息
        const versionDiv = document.createElement('div');
        versionDiv.innerHTML = versionInfo;
        document.body.appendChild(versionDiv);
        
        console.log('=== Mermaid 版本检测结束 ===');
    }, 5000); // 延迟 5 秒确保 Mermaid 完全加载和渲染完成
});
</script> -->