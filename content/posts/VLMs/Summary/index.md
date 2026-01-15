+++
date = '2025-11-26T16:51:18+08:00'
draft = false
title = 'Summary: VLMs'
categories = ['VLMs']
tags = ['VLMs']
+++


## VLM Tasks
- **Image Captioning**: generate a description for a given image
- **General Visual Question Answering**: answer questions based on the visual content of a given image.
- **Text-oriented Visual Question Answering**: Text-VQA is a specialized sub-task of VQA where answering questions critically depends on reading and comprehending text in a given image.
    - Multilingual Text Recognition and Understanding
- **Refer Expression Comprehension**
- **Visual Grounding**
- Mathematical Reasoning
- Video Understanding
- Visual Agent
    - Function Calling
    - UI Operations/Games/Robotics/Navigation

## VLMs Summary
<style>
table.vlm-comparison {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9em;
  margin: 20px 0;
  border-top: 1px solid #ccc !important;
}
table.vlm-comparison th,
table.vlm-comparison td {
  padding: 6px 8px;
  vertical-align: middle;
  border: none !important;
  line-height: 1.3;
  white-space: nowrap;
}
table.vlm-comparison thead th {
  border: none !important;
  border-bottom: 1px solid #ccc !important;
  font-weight: bold;
  text-align: center;
  padding: 8px;
}
table.vlm-comparison thead th:first-child {
  width: 12%;
  border-right: 1px solid #ccc !important;
}
table.vlm-comparison thead th:nth-child(2) {
  width: 8%;
}
table.vlm-comparison thead th:nth-child(3),
table.vlm-comparison thead th:nth-child(4),
table.vlm-comparison thead th:nth-child(5) {
  width: 12%;
}
table.vlm-comparison thead tr:nth-child(2) th:nth-child(1) {
  border-right: none !important;
}
table.vlm-comparison thead th:nth-child(6) {
  width: 18%;
}
table.vlm-comparison thead th:nth-child(7) {
  width: 18%;
}
table.vlm-comparison tbody td {
  border: none !important;
  border-top: none !important;
  border-bottom: none !important;
  border-left: none !important;
  border-right: none !important;
  text-align: left;
  white-space: nowrap;
}
table.vlm-comparison tbody td:first-child {
  border-right: 1px solid #ccc !important;
  font-weight: 500;
}
table.vlm-comparison tbody tr:last-child td {
  border-bottom: 1px solid #ccc !important;
}
</style>

<table class="vlm-comparison">
  <thead>
    <tr>
      <th rowspan="2">Model</th>
      <th rowspan="2">Year</th>
      <th colspan="3">Model Architecture</th>
      <th rowspan="2">Training Recipe</th>
      <th rowspan="2">Data Recipe</th>
    </tr>
    <tr>
      <th>Vision Encoder</th>
      <th>Adapter</th>
      <th>LLM</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>BLIP</strong></td>
      <td>2022.01</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
    </tr>
    <tr>
      <td><strong>BLIP-2</strong></td>
      <td>2023.01</td>
      <td>-</td>
      <td>Q-Former</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
    </tr>
    <tr>
      <td><strong>LLaVA</strong></td>
      <td>2023.04</td>
      <td>CLIP ViT-L/14</td>
      <td>Linear</td>
      <td>Vicuna</td>
      <td>Pre-training + Fine-tuning</td>
      <td>Image-text pairs</td>
    </tr>
    <tr>
      <td><strong>Qwen-VL</strong></td>
      <td>2023.08</td>
      <td>ViT-bigG</td>
      <td>Cross-attention</td>
      <td>Qwen</td>
      <td>Pre-training + SFT</td>
      <td>Image-text pairs</td>
    </tr>
    <tr>
      <td><strong>Qwen2-VL</strong></td>
      <td>2024.09</td>
      <td>ViT</td>
      <td>MLP</td>
      <td>Qwen2</td>
      <td>Pre-training + Post-training</td>
      <td>1.2T tokens</td>
    </tr>
    <tr>
      <td><strong>Qwen2.5-VL</strong></td>
      <td>2025.02</td>
      <td>ViT</td>
      <td>MLP</td>
      <td>Qwen2.5</td>
      <td>Pre-training + Post-training</td>
      <td>4T tokens</td>
    </tr>
    <tr>
      <td><strong>Qwen3-VL</strong></td>
      <td>2025.02</td>
      <td>SigLIP-2</td>
      <td>MLP</td>
      <td>Qwen3</td>
      <td>Pre-training + Post-training</td>
      <td>-</td>
    </tr>
    <tr>
      <td><strong>HunyuanOCR</strong></td>
      <td>2025.11</td>
      <td>SigLIP-v2</td>
      <td>Conv2d + MLP</td>
      <td>Hunyuan</td>
      <td>Multi-stage + RL</td>
      <td>200M image-text pairs</td>
    </tr>
  </tbody>
</table>


