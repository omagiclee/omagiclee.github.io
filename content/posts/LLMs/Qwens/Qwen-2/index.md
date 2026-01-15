+++
date = '2024-07-15T10:28:43+08:00'
draft = false
title = 'Qwen2 Technical Report'
categories = ['LLMs']
tags = ['LLMs', 'Qwens']
+++

:(fas fa-building fa-fw):<span style="color:gray">Qwen Team, Alibaba Group</span>
:(fas fa-file-pdf fa-fw):[arXiv 2407.10671](https://arxiv.org/abs/2407.10671)
:(fab fa-github fa-fw):[QwenLM/Qwen2](https://github.com/QwenLM/Qwen2)
<img src="https://huggingface.co/front/assets/huggingface_logo-noborder.svg" alt="Hugging Face" style="height: 0.9em; vertical-align: -0.15em; margin-right: 2px;">[Qwen/qwen2](https://huggingface.co/collections/Qwen/qwen2)


## TL;DR

## Motivation

## Key Innovations

## Approach

### Tokenization

Identical to the Qwen, the tokenizer utilizes byte-level byte-pair encoding (BBPE) with a total vocabulary size of 151,646, consisting of 151,643 regular tokens and 3 control tokens.

### Model Architecture

<style>
.grouped-table.architecture {
  table-layout: auto;
  width: auto;
  margin-left: 0;
  margin-right: auto;
}
.grouped-table.architecture th,
.grouped-table.architecture td {
  padding: 3px 5px;
  white-space: nowrap;
}
.grouped-table.architecture td:first-child {
  white-space: normal;
  padding-right: 10px;
}
.grouped-table.architecture th:not(:first-child),
.grouped-table.architecture td:not(:first-child) {
  text-align: center;
  padding-left: 5px;
  padding-right: 5px;
}
</style>

<table class="grouped-table architecture">
  <thead>
    <tr>
      <th>Configuration</th>
      <th>0.5B</th>
      <th>1.5B</th>
      <th>7B</th>
      <th>72B</th>
      <th>57B-A14B</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Hidden Size</strong></td>
      <td>896</td>
      <td>1,536</td>
      <td>3,584</td>
      <td>8,192</td>
      <td>3,584</td>
    </tr>
    <tr>
      <td><strong># Layers</strong></td>
      <td>24</td>
      <td>28</td>
      <td>28</td>
      <td>80</td>
      <td>28</td>
    </tr>
    <tr>
      <td><strong># Query Heads</strong></td>
      <td>14</td>
      <td>12</td>
      <td>28</td>
      <td>64</td>
      <td>28</td>
    </tr>
    <tr>
      <td><strong># KV Heads</strong></td>
      <td>2</td>
      <td>2</td>
      <td>4</td>
      <td>8</td>
      <td>4</td>
    </tr>
    <tr>
      <td><strong>Head Size</strong></td>
      <td>64</td>
      <td>128</td>
      <td>128</td>
      <td>128</td>
      <td>128</td>
    </tr>
    <tr>
      <td><strong>Intermediate Size</strong></td>
      <td>4,864</td>
      <td>8,960</td>
      <td>18,944</td>
      <td>29,568</td>
      <td>2,560</td>
    </tr>
    <tr>
      <td><strong># Routed Experts</strong></td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>64</td>
    </tr>
    <tr>
      <td><strong># Activated Experts</strong></td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>8</td>
    </tr>
    <tr>
      <td><strong># Shared Experts</strong></td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>8</td>
    </tr>
    <tr>
      <td><strong>Embedding Tying</strong></td>
      <td>True</td>
      <td>True</td>
      <td>False</td>
      <td>False</td>
      <td>False</td>
    </tr>
    <tr>
      <td><strong>Vocabulary Size</strong></td>
      <td>151,646</td>
      <td>151,646</td>
      <td>151,646</td>
      <td>151,646</td>
      <td>151,646</td>
    </tr>
    <tr>
      <td><strong># Trained Tokens</strong></td>
      <td>12T</td>
      <td>7T</td>
      <td>7T</td>
      <td>7T</td>
      <td>4.5T</td>
    </tr>
  </tbody>
</table>

#### Dense Model
- **Grouped Query Attention (GQA)**: GQA instead of conventional multi-head attention (MHA). GQA optimizes KV cache usage during inference, significantly enhancing throughput.
- **Dual Chunk Attention (DCA) with YARN**: 
- Moreover, we follow Qwen with the usage of SwiGLU (Dauphin et al., 2017) for activation, Rotary Positional Embeddings (RoPE, Su et al., 2024) for positional embedding, QKV bias (Su, 2023) for attention, RMSNorm (Jiang et al., 2023b) and pre-normalization for training stability.


#### Mixture-of-Experts (MoE) Model

<style>
.grouped-table {
  width: 100%;
  font-size: 0.8em;
  border-collapse: collapse;
  margin: 1.5rem 0;
}
.grouped-table th,
.grouped-table td {
  padding: 8px 12px;
  border: 1px solid #ddd;
  text-align: center;
  vertical-align: middle;
  color: #000;
}
.grouped-table .section-header td {
  background: #f0f0f0;
  color: #000;
  font-weight: bold;
  text-align: center;
  padding: 12px;
  font-size: 1.05em;
}
.grouped-table td:first-child {
  font-weight: 600;
  background: #f8f9fa;
  color: #000;
}
.grouped-table ul {
  margin: 0;
  padding-left: 15px;
  text-align: left;
  font-size: 0.95em;
  color: #000;
}
[theme=dark] .grouped-table th,
[theme=dark] .grouped-table td {
  border-color: #444;
  color: #fff;
}
[theme=dark] .grouped-table .section-header td {
  background: #2a2a2a;
  color: #fff;
}
[theme=dark] .grouped-table td:first-child {
  background: #2a2a2a;
  color: #fff;
}
[theme=dark] .grouped-table ul {
  color: #fff;
}
</style>

<table class="grouped-table">
  <thead>
    <tr>
      <th rowspan="2">Stages</th>
      <th rowspan="2">Pre-training</th>
      <th rowspan="2">SFT</th>
      <th rowspan="2">Reinforcement Learning</th>
    </tr>
  </thead>
  
  <!-- 第一组：超参数 -->
  <tbody>
    <tr class="section-header">
      <td colspan="4">Hyperparameters</td>
    </tr>
    <tr>
      <td><strong>Purpose</strong></td>
      <td style="white-space: nowrap;">Language Foundations & World Knowledge</td>
      <td>Chat-style Alignment & Instruction Following</td>
      <td>Human Preference Alignment</td>
    </tr>
    <tr>
      <td><strong>Training Objective</strong></td>
      <td colspan="2">Next-token prediction</td>
      <td>Reward Maximization (PPO)</td>
    </tr>
    <tr>
      <td><strong>Vocabulary Size</strong></td>
      <td>151,643 regular tokens and 3 control tokens</td>
      <td></td>
      <td>-</td>
    </tr>
    <tr>
      <td><strong>Optimizer</strong></td>
      <td colspan="2">AdamW (β₁=0.9, β₂=0.95, ε=10⁻⁸)</td>
      <td>-</td>
    </tr>
    <tr>
      <td><strong>Learning Rate</strong></td>
      <td>Cosine schedule (peak → 10% peak)</td>
      <td>7×10⁻⁶ → 7×10⁻⁷ (linear decay)</td>
      <td>-</td>
    </tr>
    <tr>
      <td><strong>Precision</strong></td>
      <td colspan="2">BFloat16 mixed precision</td>
      <td>-</td>
    </tr>
    <tr>
      <td><strong>Batch Size</strong></td>
      <td></td>
      <td>128</td>
      <td>-</td>
    </tr>
    <tr>
      <td><strong>Training Epochs</strong></td>
      <td></td>
      <td>2</td>
      <td>-</td>
    </tr>
    <tr>
      <td><strong>Weight Decay</strong></td>
      <td></td>
      <td>0.1</td>
      <td>-</td>
    </tr>
    <tr>
      <td><strong>Gradient Clipping</strong></td>
      <td></td>
      <td>1.0</td>
      <td>-</td>
    </tr>
    <tr>
      <td><strong>Context Length</strong></td>
      <td>2048</td>
      <td>32,768</td>
      <td></td>
    </tr>
  </tbody>
  
  <!-- 第三组：数据 -->
  <tbody>
    <tr class="section-header">
      <td colspan="4">Data</td>
    </tr>
    <tr>
      <td><strong>Training Corpus</strong></td>
      <td>7T tokens</td>
      <td>500,000+ instruction examples<br>(instruction following, coding, mathematics,<br>logical reasoning, role-playing, multilingualism, safety)</td>
      <td>-</td>
    </tr>
  </tbody>
</table>

### Pre-training

#### Pre-training Data

- 7T tokens
- An attempt to further relax the quality threshold resulted in a 12 trillion token dataset.
- All Qwen2 dense models, excluding Qwen2-0.5B, were pre-trained on this large-scale dataset of over 7 trillion tokens.

All Qwen2 dense models, excluding Qwen2-0.5B, were pre-trained on this large-scale dataset of over 7 trillion tokens. Qwen2-0.5B were pre-trained using the 12 trillion token dataset. The MoE model received an additional 4.5 trillion tokens of pre-training, in line with the principle of upcycling. Similar to previous Qwen models, high-quality multi-task instruction data is integrated into the Qwen2 pre-training process to enhance in-context learning and instruction-following abilities.

- **Quality Enhancement**
    - refined with additional heuristic and model-based methods.
    - Qwen models are utilized to synthesize high-quality pre-training data.
- **Data Expansion**
    - larger volume of high-quality code, mathematics, and multilingual data.
    - supports approximately 30 languages.
- **Distribution Improvement**
    - we conduct experiments on scale-down models to optimize the mixing of data from various sources and domains.

### Post-training

## Experiments

## References

