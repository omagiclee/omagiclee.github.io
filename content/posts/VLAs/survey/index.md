+++
date = '2025-09-28T16:24:48+08:00'
draft = false
title = 'Survey'
organization = []
categories = []
tags = []
+++


## VLA 模型演进架构

<div class="mermaid">
graph TB
    subgraph VLM["VLM as Driving Explainer"]
        V1[🖼️ Vision<br/>Input] --> VLM1[🤖 VLMs<br/>Processing]
        VLM1 --> E1[💬 Explain<br/>Q&A<br/>Description]
        style V1 fill:#e3f2fd
        style VLM1 fill:#fff3e0
        style E1 fill:#fff8e1
    end

    subgraph Modular["Modular VLA for AD"]
        V2[🖼️ Multimodal<br/>Vision] --> VLM2[🤖 VLMs<br/>Processing]
        VLM2 --> IR[🔄 Intermediate<br/>Representation]
        IR --> AH[⚙️ Action Head]
        AH --> TC1[🎯 Trajectory<br/>Control]
        style V2 fill:#e3f2fd
        style VLM2 fill:#fff3e0
        style IR fill:#f3e5f5
        style AH fill:#e8f5e8
        style TC1 fill:#fce4ec
    end

    subgraph EndToEnd["End-to-end VLA for AD"]
        V3[🖼️ Multimodal<br/>Vision] --> VLM3[🤖 VLMs<br/>Processing]
        VLM3 --> A1[🚗 Action<br/>Output]
        style V3 fill:#e3f2fd
        style VLM3 fill:#fff3e0
        style A1 fill:#e0f2f1
    end

    subgraph Augmented["Augmented VLA for AD"]
        V4[🖼️ Multimodal<br/>Vision] --> RT[🧠 Reasoning VLMs<br/>& Tool-use Agents]
        RT --> A2[🚗 Action<br/>Output]
        style V4 fill:#e3f2fd
        style RT fill:#f3e5f5
        style A2 fill:#e0f2f1
    end

    %% 演进箭头
    VLM -.-> Modular
    Modular -.-> EndToEnd
    EndToEnd -.-> Augmented

    %% 样式定义
    classDef titleStyle fill:#f9f9f9,stroke:#333,stroke-width:2px,color:#333
    class VLM,Modular,EndToEnd,Augmented titleStyle
</div>

<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
<script>
mermaid.initialize({startOnLoad:true});
</script>

**图表说明：**
1. **VLM as Driving Explainer**: 冻结的LLM描述驾驶场景但不产生控制
2. **Modular VLA**: 语言转换为中间表示，动作头转换为轨迹或低级控制
3. **End-to-end VLA**: 单一多模态管道直接将传感器输入映射到动作
4. **Augmented VLA**: 工具使用或CoT VLMs添加长期推理，同时保持端到端控制路径

- LLM as Planner
- VLM as Driving Explainer
- Modular VLA for AD
- End-to-End VLA for AD
- Augmented VLA for AD

## Vision-Language-Action Models

<div style="margin-bottom: 15px; padding: 15px; background-color: #f8f9fa; border-radius: 8px; border: 1px solid #dee2e6;">
<h4 style="margin-top: 0; margin-bottom: 15px; color: #495057; text-align: center;">📖 图例说明</h4>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; font-size: 14px;">
<div style="display: flex; align-items: center;">
<span style="background-color: #e3f2fd; color: #1565c0; padding: 4px 8px; border-radius: 4px; font-weight: bold; margin-right: 8px; min-width: 60px; text-align: center;">LLC</span>
<span>Low-Level Control</span>
</div>
<div style="display: flex; align-items: center;">
<span style="background-color: #fce4ec; color: #c2185b; padding: 4px 8px; border-radius: 4px; font-weight: bold; margin-right: 8px; min-width: 60px; text-align: center;">V2V</span>
<span>Vehicle-to-Vehicle</span>
</div>
<div style="display: flex; align-items: center;">
<span style="background-color: #e0f2f1; color: #00695c; padding: 4px 8px; border-radius: 4px; font-weight: bold; margin-right: 8px; min-width: 60px; text-align: center;">Pre-training</span>
<span>Pre-training</span>
</div>
<div style="display: flex; align-items: center;">
<span style="background-color: #efebe9; color: #5d4037; padding: 4px 8px; border-radius: 4px; font-weight: bold; margin-right: 8px; min-width: 60px; text-align: center;">PDCE</span>
<span>Specific Loss Function</span>
</div>
</div>
</div>

<table id="vlaTable" style="text-align: center; margin: 0 auto; border-collapse: collapse; border: 1px solid #333; font-size: 14px; width: 100%; max-width: 1200px;">
<style>
table th {
  background-color: #f0f0f0;
  border: 1px solid #333;
  padding: 10px 8px;
  font-weight: bold;
  color: #333;
  white-space: nowrap;
}
table td {
  border: 1px solid #333;
  padding: 8px 6px;
  background-color: white;
  vertical-align: middle;
  white-space: nowrap;
}
table td:last-child {
  white-space: normal;
}
</style>
<thead>
<tr>
<th rowspan="2" style="text-align: center;">Model</th>
<th rowspan="2" style="text-align: center;">Time</th>
<th colspan="2" style="text-align: center;">Data Source</th>
<th colspan="3" style="text-align: center;">Model</th>
<th rowspan="2" style="text-align: center;">Output</th>
<th rowspan="2" style="text-align: center;">Focus</th>
</tr>
<tr>
<th style="text-align: center;">Input</th>
<th style="text-align: center;">Dataset</th>
<th style="text-align: center;">Vision</th>
<th style="text-align: center;">LLM</th>
<th style="text-align: center;">Decoder</th>
</tr>
</thead>
<tbody>
<tr>
<td style="text-align: center;">DriveGPT-4</td>
<td style="text-align: center;">2023</td>
<td style="text-align: center;">Single</td>
<td style="text-align: center;">BDD-X</td>
<td style="text-align: center;">CLIP</td>
<td style="text-align: center;">LLaMA-2</td>
<td style="text-align: center;">-</td>
<td style="text-align: center;">LLC</td>
<td style="text-align: center;">Interpretable LLM, Mixed Fine-tuning</td>
</tr>
<tr>
<td style="text-align: center;">ADriver-I</td>
<td style="text-align: center;">2023</td>
<td style="text-align: center;">Single</td>
<td style="text-align: center;">nuScenes + Private</td>
<td style="text-align: center;">CLIP ViT</td>
<td style="text-align: center;">Vicuna-1.5</td>
<td style="text-align: center;">-</td>
<td style="text-align: center;">LLC</td>
<td style="text-align: center;">Diffusion World Model, Vision-action Tokens</td>
</tr>
<tr>
<td style="text-align: center;">RAG-Driver</td>
<td style="text-align: center;">2024</td>
<td style="text-align: center;">Multi</td>
<td style="text-align: center;">BDD-X</td>
<td style="text-align: center;">CLIP ViT</td>
<td style="text-align: center;">Vicuna-1.5</td>
<td style="text-align: center;">-</td>
<td style="text-align: center;">LLC</td>
<td style="text-align: center;">RAG Control, Textual Rationales</td>
</tr>
<tr>
<td style="text-align: center;">EMMA</td>
<td style="text-align: center;">2024</td>
<td style="text-align: center;">Multi + State</td>
<td style="text-align: center;">Waymo fleet</td>
<td style="text-align: center;">Gemini-VLM</td>
<td style="text-align: center;">Gemini</td>
<td style="text-align: center;">-</td>
<td style="text-align: center;">Multi.</td>
<td style="text-align: center;">MLLM Backbone, Multi-task Outputs</td>
</tr>
<tr>
<td style="text-align: center;">CoVLA-Agent</td>
<td style="text-align: center;">2024</td>
<td style="text-align: center;">Single + State</td>
<td style="text-align: center;">CoVLA Data</td>
<td style="text-align: center;">CLIP ViT</td>
<td style="text-align: center;">Vicuna-1.5</td>
<td style="text-align: center;">-</td>
<td style="text-align: center;">Traj.</td>
<td style="text-align: center;">Text + Traj Outputs, Auto-labelled Data</td>
</tr>
<tr>
<td style="text-align: center;">OpenDriveVLA</td>
<td style="text-align: center;">2025</td>
<td style="text-align: center;">Multi</td>
<td style="text-align: center;">nuScenes</td>
<td style="text-align: center;">Custom Module</td>
<td style="text-align: center;">Qwen-2.5</td>
<td style="text-align: center;">-</td>
<td style="text-align: center;">LLC+Traj.</td>
<td style="text-align: center;">2-D/3-D Align, SOTA Planner</td>
</tr>
<tr>
<td style="text-align: center;">ORION</td>
<td style="text-align: center;">2025</td>
<td style="text-align: center;">Multi + History</td>
<td style="text-align: center;">nuScenes + CARLA</td>
<td style="text-align: center;">QT-Former</td>
<td style="text-align: center;">Vicuna-1.5</td>
<td style="text-align: center;">-</td>
<td style="text-align: center;">Traj.</td>
<td style="text-align: center;">CoT Reasoning, Continuous Actions</td>
</tr>
<tr>
<td style="text-align: center;">DriveMoE</td>
<td style="text-align: center;">2025</td>
<td style="text-align: center;">Multi</td>
<td style="text-align: center;">Bench2Drive</td>
<td style="text-align: center;">Paligemma-3B</td>
<td style="text-align: center;">-</td>
<td style="text-align: center;">-</td>
<td style="text-align: center;">LLC</td>
<td style="text-align: center;">Mixture-of-Experts, Dynamic Routing</td>
</tr>
<tr>
<td style="text-align: center;">VaViM</td>
<td style="text-align: center;">2025</td>
<td style="text-align: center;">Video Frames</td>
<td style="text-align: center;">BDD100K + CARLA</td>
<td style="text-align: center;">LlamaGen</td>
<td style="text-align: center;">GPT-2</td>
<td style="text-align: center;">-</td>
<td style="text-align: center;">Traj.</td>
<td style="text-align: center;">Video-token Pre-training, Vision to Action</td>
</tr>
<tr>
<td style="text-align: center;">DiffVLA</td>
<td style="text-align: center;">2025</td>
<td style="text-align: center;">Multi + State</td>
<td style="text-align: center;">Navsim-v2</td>
<td style="text-align: center;">CLIP ViT</td>
<td style="text-align: center;">Vicuna-1.5</td>
<td style="text-align: center;">-</td>
<td style="text-align: center;">Traj.</td>
<td style="text-align: center;">Mixed Diffusion, VLM Sampling</td>
</tr>
<tr>
<td style="text-align: center;">LangCoop</td>
<td style="text-align: center;">2025</td>
<td style="text-align: center;">Single + V2V</td>
<td style="text-align: center;">CARLA</td>
<td style="text-align: center;">GPT-4o</td>
<td style="text-align: center;">GPT-4o</td>
<td style="text-align: center;">-</td>
<td style="text-align: center;">LLC</td>
<td style="text-align: center;">Language-based V2V, High Bandwidth Cut</td>
</tr>
<tr>
<td style="text-align: center;">SimLingo</td>
<td style="text-align: center;">2025</td>
<td style="text-align: center;">Multi</td>
<td style="text-align: center;">CARLA + Bench2Drive</td>
<td style="text-align: center;">InternVL2</td>
<td style="text-align: center;">Qwen-2</td>
<td style="text-align: center;">-</td>
<td style="text-align: center;">LLC+Traj.</td>
<td style="text-align: center;">Enhanced VLM, Action-dreaming</td>
</tr>
<tr>
<td style="text-align: center;">SafeAuto</td>
<td style="text-align: center;">2025</td>
<td style="text-align: center;">Multi + State</td>
<td style="text-align: center;">BDD-X + DriveLM</td>
<td style="text-align: center;">CLIP ViT</td>
<td style="text-align: center;">Vicuna-1.5</td>
<td style="text-align: center;">-</td>
<td style="text-align: center;">LLC</td>
<td style="text-align: center;">Traffic-Rule-Based, PDCE Loss</td>
</tr>
<tr>
<td style="text-align: center;">Impromptu-VLA</td>
<td style="text-align: center;">2025</td>
<td style="text-align: center;">Single</td>
<td style="text-align: center;">Impromptu Data</td>
<td style="text-align: center;">Qwen-2.5VL</td>
<td style="text-align: center;">Qwen-2.5VL</td>
<td style="text-align: center;">-</td>
<td style="text-align: center;">Traj.</td>
<td style="text-align: center;">Corner-case QA, NeuroNCAP SOTA</td>
</tr>
<tr>
<td style="text-align: center;">AutoVLA</td>
<td style="text-align: center;">2025</td>
<td style="text-align: center;">Multi + State</td>
<td style="text-align: center;">nuScenes + CARLA</td>
<td style="text-align: center;">Qwen-2.5VL</td>
<td style="text-align: center;">Qwen-2.5VL</td>
<td style="text-align: center;">-</td>
<td style="text-align: center;">LLC+Traj.</td>
<td style="text-align: center;">Adaptive Reasoning, Multi Benchmark</td>
</tr>
</tbody>
</table>

## Vision-Language-Action Datasets


## Evaluation

## Open Challenges



## References
- A Survey on Vision-Language-Action Models for Autonomous Driving, [arXiv](https://arxiv.org/pdf/2506.24044), 2025-06
- 
- 

## Question
