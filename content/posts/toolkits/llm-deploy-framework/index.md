+++
date = '2025-11-28T13:31:43+08:00'
draft = false
title = 'LLM Deploy Framework'
organization = []
categories = []
tags = []
+++

<style>
table.center-table {
  width: 100%;
}

table.center-table th,
table.center-table td {
/* 水平居中 */
  text-align: center; 
  
  /* 垂直居中 */
  vertical-align: middle;
}
</style>

<table class="center-table">
  <thead>
    <tr>
      <th>Title 1</th>
      <th>Title 2</th>
      <th>Title 3</th>
      <th>Title 4</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <!-- 合并第一列的单元格, 行数共10 -->
      <td rowspan="4">服务端</td>
      <td>vLLM</td>
      <td>开源社区</td>
      <td>运行时优化、高并发、高吞吐</td>
    </tr>
    <tr>
      <td>TGI (Text Generation Inference)</td>
      <td>Hugging Face</td>
      <td>TGI (Text Generation Inference) 是由 Hugging Face 团队开发和维护的高性能文本生成推理服务（Rust 驱动），它集成了 FlashAttention 和动态批处理等技术，为 LLM 提供了高吞吐量、低延迟的生产级部署解决方案。</td>
    </tr>
    <tr>
      <td>LMDeploy</td>
      <td>OpenMMLab</td>
      <td>LMDeploy 是一个由 OpenMMLab/上海人工智能实验室 开发的一站式高性能 LLM 部署工具包，它基于 TurboMind C++ 推理引擎，通过支持 极致的低比特量化（如 4-bit） 和优化调度机制，旨在实现服务器端高吞吐量与显存效率的最佳平衡。</td>
    </tr>
    <tr>
      <td>TensorRT-LLM</td>
      <td>NVIDIA</td>
      <td>编译时优化、<strong>低延迟</strong>、TensorRT-LLM 是 NVIDIA 官方推出的 LLM 编译和优化框架，它将模型转换为高度优化的 TensorRT 引擎，专为在 NVIDIA GPU 上提供最高的吞吐量和最低的推理延迟。</td>
    </tr>
    <tr>
      <td rowspan="5">端侧</td>
      <td>llama.cpp</td>
      <td>开源社区</td>
      <td>
        <ul>
          <li><strong>低延迟、低资源消耗、广泛兼容</strong></li>
          <li>Plain C/C++ implementation without any dependencies</li>
          <li>Apple silicon is a first-class citizen - optimized via ARM NEON, Accelerate and Metal frameworks</li>
          <li>AVX, AVX2, AVX512 and AMX support for x86 architectures</li>
          <li>RVV, ZVFH, ZFH and ZICBOP support for RISC-V architectures</li>
          <li>1.5-bit, 2-bit, 3-bit, 4-bit, 5-bit, 6-bit, and 8-bit integer quantization for faster inference and reduced memory use</li>
          <li>Custom CUDA kernels for running LLMs on NVIDIA GPUs (support for AMD GPUs via HIP and Moore Threads GPUs via MUSA)</li>
          <li>CPU+GPU hybrid inference to partially accelerate models larger than the total VRAM capacity</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td>Ollama</td>
      <td>Ollama, Inc.</td>
      <td>Ollama 是一个极简、模块化的 LLM 服务平台，它<strong>封装了高效的底层推理引擎（如 llama.cpp）</strong>，通过提供命令行接口和 OpenAI 兼容的 RESTful API，将本地大型语言模型的部署、管理与应用集成流程高度简化和标准化。</td>
    </tr>
    <tr>
      <td>MLC LLM</td>
      <td>MLC 学术研究和开源社区</td>
      <td>MLC LLM 是一个基于 Apache TVM 编译器技术的跨平台大模型部署框架，通过将 LLM 编译成针对 <strong>WebGPU</strong>、Metal 等端侧设备原生优化的底层代码，实现了模型在边缘侧和浏览器环境中的极致性能与普适性。</td>
    </tr>
  </tbody>
</table>


## Qwen-Image-Edit
您好！这是一个非常实际且高性能需求的场景。您关注的重点是增加吞吐量，部署在 L40S 和 A100 这种高性能卡上，并且针对的是像 Qwen-Image-Edit 这样的图像编辑模型（它属于多模态或 VLM 范畴）。

Qwen-Image-Edit 这类模型通常涉及两个主要部分：

VLM 编码/理解部分：对输入的图像和文本指令进行理解。

图像生成/编辑部分：根据理解结果，利用扩散模型（Diffusion Model）等技术进行图像的生成或编辑。

因此，推理框架需要同时优化 **Transformer 结构（VLM/LLM）**和 U-Net/Diffusion 结构（图像生成）。

基于您的需求和最新的技术发展，我为您推荐以下推理框架和策略：

🥇 核心推荐：Triton + vLLM/TensorRT + Diffusers
这是目前业界公认处理复杂多模态模型和追求高吞吐量的最优组合。

1. Triton Inference Server (作为服务平台)
作用： 统一的服务入口，实现动态批处理（Dynamic Batching）、多模型/多阶段管道管理、负载均衡。

吞吐量优势： 动态批处理是提升吞吐量的关键。它能将短时间内到达的多个请求合并成一个批次进行推理，充分利用 L40S/A100 的并行计算能力。

VLM/Diffusion 结合： 您可以将 Qwen-Image-Edit 的 VLM 部分和 Image-Edit (Diffusion) 部分作为两个或多个模型部署在 Triton 上，并通过 Triton 的 Model Ensemble 功能实现串联推理，高效地管理整个工作流。

2. VLM/LLM 文本部分加速器（针对指令理解）
vLLM：

推荐原因： 极致的吞吐量优化，尤其擅长处理 LLM/VLM 的自回归生成部分。它能通过 PagedAttention 有效管理 KV Cache，显著降低 A100/L40S 上的延迟和提升吞吐量。

适用： Qwen 模型家族基于 Transformer 架构，非常适合使用 vLLM 来加速其文本指令的理解和响应部分。

NVIDIA TensorRT-LLM (推荐如果追求极致延迟)：

推荐原因： NVIDIA 官方推出的针对 LLM/VLM 的高性能推理库。针对 L40S/A100 架构进行了深度优化，支持各种模型并行策略。

适用： 需要将 Qwen-Image-Edit 的 VLM 部分转换为 TensorRT 引擎以获得更低的延迟和更高的效率。

3. 图像生成/编辑部分加速器（针对扩散模型）
Hugging Face Diffusers 库 (搭配 torch.compile / ONNX)：

推荐原因： 官方库支持 Stable Diffusion、潜在扩散模型（Latent Diffusion Models）等，这正是 Qwen-Image-Edit 这类模型底层的图像生成机制。

优化： 结合 PyTorch 2.0 的 torch.compile (使用 Triton/AOT/PT2.0 后端) 可以实现内核融合和优化，显著提升 U-Net 的推理速度。或者，将其导出为 ONNX 格式，通过 ONNX Runtime 加载进行优化推理。

NVIDIA TensorRT：

推荐原因： 将扩散模型的 U-Net 部分转换为 TensorRT 引擎，获得最佳的推理性能。
