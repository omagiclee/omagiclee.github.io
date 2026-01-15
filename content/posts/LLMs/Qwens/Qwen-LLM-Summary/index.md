+++
date = '2025-05-14T11:26:22+08:00'
draft = false
title = 'Qwen Series: Technical Summary'
categories = ['LLMs']
tags = ['LLMs', 'Qwens']
+++

## Model Architecture

<table class="comparison-table">
  <thead>
    <tr>
      <th>Model</th>
      <th>Attention Mechanism</th>
      <th>Positional Embedding</th>
      <th>Activation</th>
      <th>Normalization</th>
      <th>Context Length</th>
      <th>Embedding Strategy</th>
      <th>Key Changes</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Qwen</strong></td>
      <td>Multi-head Attention (MHA)<br>Flash Attention</td>
      <td>RoPE (FP32 precision)</td>
      <td>SwiGLU<br>FFN: 8/3 × hidden size</td>
      <td>Pre-Norm & RMSNorm</td>
      <td>2K</td>
      <td>Untied Embedding</td>
      <td>
        <ul>
          <li>QKV bias</li>
          <li>Flash Attention</li>
          <li>Untied Embedding</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td><strong>Qwen2</strong></td>
      <td>GQA (Grouped Query Attention)<br>DCA with YARN</td>
      <td>RoPE<br>YARN extension</td>
      <td>SwiGLU</td>
      <td>Pre-Norm & RMSNorm</td>
      <td>32K-128K<br>(with YARN)</td>
      <td>Untied Embedding</td>
      <td>
        <ul>
          <li>GQA for efficient KV cache</li>
          <li>Dual Chunk Attention (DCA)</li>
          <li>YARN for long context extension</li>
          <li>QKV bias retained</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td><strong>Qwen2.5</strong></td>
      <td>GQA</td>
      <td>RoPE<br>YARN extension</td>
      <td>SwiGLU</td>
      <td>Pre-Norm & RMSNorm</td>
      <td>32K-128K<br>(with YARN)</td>
      <td>Untied Embedding</td>
      <td>Same as Qwen2</td>
    </tr>
    <tr>
      <td><strong>Qwen3</strong></td>
      <td>GQA<br>QK-Norm</td>
      <td>RoPE<br>ABF + YARN</td>
      <td>SwiGLU</td>
      <td>Pre-Norm & RMSNorm</td>
      <td>32K-128K<br>(ABF + YARN)</td>
      <td>Untied Embedding<br>(varies by size)</td>
      <td>
        <ul>
          <li>Remove QKV-bias</li>
          <li>Introduce QK-Norm</li>
          <li>ABF for context extension</li>
          <li>MoE: 128 experts, 8 active</li>
        </ul>
      </td>
    </tr>
  </tbody>
</table>

### MoE Architecture (Qwen3)

Qwen3 introduces MoE (Mixture-of-Experts) variants with significant architectural improvements:

- **Expert Configuration**: 128 total experts with 8 experts activated per token
- **Fine-grained Expert Partitioning**: Enhanced expressiveness through specialized experts
- **Global Batch Load-balancing Loss**: Promotes expert specialization and balanced utilization
- **Key Difference from Qwen2.5-MoE**: Removed shared experts design for better efficiency

### Context Length Extension Techniques

- **Qwen**: Standard RoPE with 2K context
- **Qwen2/Qwen2.5**: YARN (Yet Another RoPE extensioN) enables 32K-128K context
- **Qwen3**: ABF (Adaptive Base Frequency) + YARN for optimized long-context handling up to 128K tokens

## Tokenization

<style>
.comparison-table {
  width: 100%;
  font-size: 0.8em;
  border-collapse: collapse;
  margin: 1.5rem 0;
  table-layout: auto;
}
.comparison-table th,
.comparison-table td {
  padding: 8px 12px;
  border: 1px solid #ddd;
  text-align: center;
  vertical-align: middle;
  color: #000;
}
/* Model 列 - 较窄 */
.comparison-table th:first-child,
.comparison-table td:first-child {
  width: auto;
  min-width: 70px;
  max-width: 100px;
}
/* Attention Mechanism 列 - 中等宽度 */
.comparison-table th:nth-child(2),
.comparison-table td:nth-child(2) {
  width: auto;
  min-width: 140px;
}
/* Positional Embedding 列 - 较窄 */
.comparison-table th:nth-child(3),
.comparison-table td:nth-child(3) {
  width: auto;
  min-width: 110px;
}
/* Activation 列 - 较窄 */
.comparison-table th:nth-child(4),
.comparison-table td:nth-child(4) {
  width: auto;
  min-width: 100px;
}
/* Normalization 列 - 较窄 */
.comparison-table th:nth-child(5),
.comparison-table td:nth-child(5) {
  width: auto;
  min-width: 100px;
}
/* Context Length 列 - 较窄 */
.comparison-table th:nth-child(6),
.comparison-table td:nth-child(6) {
  width: auto;
  min-width: 90px;
}
/* Embedding Strategy 列 - 较窄 */
.comparison-table th:nth-child(7),
.comparison-table td:nth-child(7) {
  width: auto;
  min-width: 120px;
}
/* Key Changes 列 - 最宽，内容最多 */
.comparison-table th:nth-child(8),
.comparison-table td:nth-child(8) {
  width: auto;
  min-width: 220px;
}
.comparison-table th {
  background: #f0f0f0;
  color: #000;
  font-weight: bold;
  text-align: center;
  padding: 12px;
  font-size: 1.05em;
}
.comparison-table td:first-child {
  font-weight: 600;
  background: #f8f9fa;
  color: #000;
  text-align: center;
}
.comparison-table td {
  text-align: left;
}
.comparison-table td:first-child,
.comparison-table th {
  text-align: center;
}
.comparison-table ul {
  margin: 0;
  padding-left: 15px;
  text-align: left;
  font-size: 0.95em;
  color: #000;
}
[theme=dark] .comparison-table th,
[theme=dark] .comparison-table td {
  border-color: #444;
  color: #fff;
}
[theme=dark] .comparison-table th {
  background: #2a2a2a;
  color: #fff;
}
[theme=dark] .comparison-table td:first-child {
  background: #2a2a2a;
  color: #fff;
}
[theme=dark] .comparison-table ul {
  color: #fff;
}
</style>

<table class="comparison-table">
  <thead>
    <tr>
      <th>Model</th>
      <th>Tokenizer</th>
      <th>Base Vocabulary</th>
      <th>Vocabulary Size</th>
      <th>Special Features</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Qwen</strong></td>
      <td>tiktoken (BBPE)</td>
      <td>cl100k_base</td>
      <td>~152k</td>
      <td>
        <ul>
          <li>Multilingual (Primary Chinese) Augmentation</li>
          <li>Single digit Split</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td><strong>Qwen2</strong></td>
      <td>BBPE</td>
      <td>Qwen</td>
      <td>151,646<br>(151,643 regular + 3 control)</td>
      <td>Same as Qwen</td>
    </tr>
    <tr>
      <td><strong>Qwen2.5</strong></td>
      <td>BBPE</td>
      <td>Qwen2</td>
      <td>151,646<br>(151,624 regular + 22 control)</td>
      <td>
        <ul>
          <li>Expanded control tokens from 3 to 22</li>
          <li>2 tool-related tokens</li>
          <li>20 for other model capabilities</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td><strong>Qwen3</strong></td>
      <td>BBPE</td>
      <td>Qwen 2.5</td>
      <td>151,646<br>(151,624 regular + 22 control)</td>
      <td>Same as Qwen2.5</td>
    </tr>
  </tbody>
</table>

## Pre-training Data

<table class="comparison-table">
  <thead>
    <tr>
      <th>Model</th>
      <th>Training Corpus</th>
      <th>Data Sources</th>
      <th>Data Processing</th>
      <th>Language Support</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Qwen</strong></td>
      <td>Up to 3T tokens</td>
      <td>
        <ul>
          <li>Public web documents</li>
          <li>Encyclopedia</li>
          <li>Books</li>
          <li>Codes</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>Deduplication</li>
          <li>Hybrid Quality Scrubbing</li>
          <li>Selective Up-sampling</li>
          <li>Instruction-Augmented Pretraining</li>
          <li>Data Decontamination</li>
        </ul>
      </td>
      <td>Primarily English and Chinese</td>
    </tr>
    <tr>
      <td><strong>Qwen2</strong></td>
      <td>7T tokens</td>
      <td>
        <ul>
          <li>Web-scale data</li>
          <li>High-quality code</li>
          <li>Mathematics data</li>
          <li>Multilingual data</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>Quality Enhancement: heuristic and model-based methods</li>
          <li>Qwen models for synthesis</li>
          <li>Distribution Improvement: optimize data mixing</li>
        </ul>
      </td>
      <td>~30 languages</td>
    </tr>
    <tr>
      <td><strong>Qwen2.5</strong></td>
      <td>18T tokens</td>
      <td>
        <ul>
          <li>Web-scale data</li>
          <li>High-quality domain-specific datasets (math, code)</li>
          <li>Synthetic data (Qwen2-72B-Instruct, Qwen2-Math-72B-Instruct)</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>Better data filtering: Qwen2-Instruct Model</li>
          <li>Better synthetic data: filtered with reward models</li>
          <li>Better data mixture: down-sample overrepresented, up-sample high-value domains</li>
        </ul>
      </td>
      <td>-</td>
    </tr>
    <tr>
      <td><strong>Qwen3</strong></td>
      <td>36T tokens<br>(30T + 5T + 1T)</td>
      <td>
        <ul>
          <li>Web</li>
          <li>PDF-like documents (extracted with Qwen2.5-VL, improved with Qwen2.5)</li>
          <li>Synthetic data (Qwen2.5-Math, Qwen2.5-Coder)</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>Stage 1: 30T tokens, 4K context</li>
          <li>Stage 2: 5T tokens, knowledge-intensive data</li>
          <li>Stage 3: extend to 32K context</li>
        </ul>
      </td>
      <td>119 languages and dialects</td>
    </tr>
  </tbody>
</table>

## Pre-training

<table class="comparison-table">
  <thead>
    <tr>
      <th>Model</th>
      <th>Training Stages</th>
      <th>Training Objective</th>
      <th>Context Length</th>
      <th>Optimizer</th>
      <th>Learning Rate</th>
      <th>Precision</th>
      <th>Key Hyperparameters</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Qwen</strong></td>
      <td>Single stage</td>
      <td>Next-token prediction</td>
      <td>2K</td>
      <td>AdamW<br>(β₁=0.9, β₂=0.95, ε=10⁻⁸)</td>
      <td>Cosine schedule<br>(peak → 10% peak)</td>
      <td>BFloat16 mixed precision</td>
      <td>
        <ul>
          <li>Batch size: varies by model size</li>
          <li>Weight decay: 0.1</li>
          <li>Gradient clipping: 1.0</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td><strong>Qwen2</strong></td>
      <td>Single stage</td>
      <td>Next-token prediction</td>
      <td>2K</td>
      <td>AdamW<br>(β₁=0.9, β₂=0.95, ε=10⁻⁸)</td>
      <td>Cosine schedule<br>(peak → 10% peak)</td>
      <td>BFloat16 mixed precision</td>
      <td>
        <ul>
          <li>Batch size: varies by model size</li>
          <li>Weight decay: 0.1</li>
          <li>Gradient clipping: 1.0</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td><strong>Qwen2.5</strong></td>
      <td>Single stage</td>
      <td>Next-token prediction</td>
      <td>2K</td>
      <td>AdamW<br>(β₁=0.9, β₂=0.95, ε=10⁻⁸)</td>
      <td>Cosine schedule<br>(peak → 10% peak)</td>
      <td>BFloat16 mixed precision</td>
      <td>Same as Qwen2</td>
    </tr>
    <tr>
      <td><strong>Qwen3</strong></td>
      <td>
        <ul>
          <li>Stage 1: 30T tokens, 4K context</li>
          <li>Stage 2: 5T tokens, knowledge-intensive</li>
          <li>Stage 3: extend to 32K context</li>
        </ul>
      </td>
      <td>Next-token prediction</td>
      <td>4K → 32K<br>(multi-stage)</td>
      <td>AdamW<br>(β₁=0.9, β₂=0.95, ε=10⁻⁸)</td>
      <td>Cosine schedule<br>(peak → 10% peak)</td>
      <td>BFloat16 mixed precision</td>
      <td>
        <ul>
          <li>Multi-stage training</li>
          <li>Context length extension</li>
          <li>ABF + YARN techniques</li>
        </ul>
      </td>
    </tr>
  </tbody>
</table>

## Supervised Fine-Tuning (SFT)

<table class="comparison-table">
  <thead>
    <tr>
      <th>Model</th>
      <th>Training Objective</th>
      <th>Data Format</th>
      <th>Optimizer</th>
      <th>Learning Rate</th>
      <th>Batch Size</th>
      <th>Training Steps</th>
      <th>Key Hyperparameters</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Qwen</strong></td>
      <td>Next-token prediction</td>
      <td>Chat-style data</td>
      <td>AdamW<br>(β₁=0.9, β₂=0.95, ε=10⁻⁸)</td>
      <td>Warmup to 2×10⁻⁶<br>(1430 steps)</td>
      <td>128</td>
      <td>4000</td>
      <td>
        <ul>
          <li>Weight decay: 0.1</li>
          <li>Dropout: 0.1</li>
          <li>Gradient clipping: 1.0</li>
          <li>Context length: 2048</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td><strong>Qwen2</strong></td>
      <td>Next-token prediction</td>
      <td>Chat-style data</td>
      <td>AdamW<br>(β₁=0.9, β₂=0.95, ε=10⁻⁸)</td>
      <td>Warmup to 2×10⁻⁶<br>(1430 steps)</td>
      <td>128</td>
      <td>4000</td>
      <td>
        <ul>
          <li>Weight decay: 0.1</li>
          <li>Dropout: 0.1</li>
          <li>Gradient clipping: 1.0</li>
          <li>Context length: 2048</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td><strong>Qwen2.5</strong></td>
      <td>Next-token prediction</td>
      <td>Chat-style data</td>
      <td>AdamW<br>(β₁=0.9, β₂=0.95, ε=10⁻⁸)</td>
      <td>Warmup to 2×10⁻⁶<br>(1430 steps)</td>
      <td>128</td>
      <td>4000</td>
      <td>Same as Qwen2</td>
    </tr>
    <tr>
      <td><strong>Qwen3</strong></td>
      <td>Next-token prediction</td>
      <td>Long CoT data +<br>Instruction-tuning data</td>
      <td>AdamW<br>(β₁=0.9, β₂=0.95, ε=10⁻⁸)</td>
      <td>Warmup schedule</td>
      <td>128</td>
      <td>Varies</td>
      <td>
        <ul>
          <li>Long CoT data focus</li>
          <li>Thinking mode fusion</li>
          <li>Extended context support</li>
        </ul>
      </td>
    </tr>
  </tbody>
</table>

## Reinforcement Learning from Human Feedback (RLHF)

<table class="comparison-table">
  <thead>
    <tr>
      <th>Model</th>
      <th>RL Method</th>
      <th>Reward Model</th>
      <th>Training Data</th>
      <th>Key Features</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Qwen</strong></td>
      <td>PPO</td>
      <td>Human preference-based</td>
      <td>Human feedback data</td>
      <td>
        <ul>
          <li>Standard RLHF pipeline</li>
          <li>Reward model training</li>
          <li>PPO optimization</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td><strong>Qwen2</strong></td>
      <td>PPO</td>
      <td>Human preference-based</td>
      <td>Human feedback data</td>
      <td>
        <ul>
          <li>Enhanced reward modeling</li>
          <li>Improved safety training</li>
          <li>Better alignment</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td><strong>Qwen2.5</strong></td>
      <td>PPO</td>
      <td>Human preference-based</td>
      <td>Human feedback data</td>
      <td>Same as Qwen2</td>
    </tr>
    <tr>
      <td><strong>Qwen3</strong></td>
      <td>Multi-stage RL</td>
      <td>Rule-based +<br>General reward model</td>
      <td>
        <ul>
          <li>Stage 2: Reasoning-based RL</li>
          <li>Stage 4: General RL (20+ tasks)</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>Reasoning-based RL (Stage 2)</li>
          <li>Rule-based rewards</li>
          <li>General RL across 20+ tasks</li>
          <li>Enhanced exploration</li>
        </ul>
      </td>
    </tr>
  </tbody>
</table>

## Model Variants & Sizes

<table class="comparison-table">
  <thead>
    <tr>
      <th>Model</th>
      <th>Dense Models</th>
      <th>MoE Models</th>
      <th>Specialized Variants</th>
      <th>Context Length Support</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Qwen</strong></td>
      <td>Base models<br>Chat models (RLHF)</td>
      <td>-</td>
      <td>
        <ul>
          <li>Code-Qwen: coding-specialized</li>
          <li>Code-Qwen-Chat: coding-specialized chat</li>
          <li>Math-Qwen-Chat: mathematics-focused</li>
        </ul>
      </td>
      <td>2K</td>
    </tr>
    <tr>
      <td><strong>Qwen2</strong></td>
      <td>Base models<br>Chat models (RLHF)</td>
      <td>MoE variants</td>
      <td>-</td>
      <td>32K-128K<br>(with YARN)</td>
    </tr>
    <tr>
      <td><strong>Qwen2.5</strong></td>
      <td>Base models<br>Chat models (RLHF)</td>
      <td>MoE variants<br>(with shared experts)</td>
      <td>-</td>
      <td>32K-128K<br>(with YARN)</td>
    </tr>
    <tr>
      <td><strong>Qwen3</strong></td>
      <td>0.6B to 32B parameters<br>Base and post-trained models</td>
      <td>
        <ul>
          <li>Qwen3-30B-A3B (30B total, 3B active)</li>
          <li>Qwen3-235B-A22B (235B total, 22B active)</li>
        </ul>
      </td>
      <td>-</td>
      <td>32K-128K<br>(ABF + YARN)</td>
    </tr>
  </tbody>
</table>

## Key Innovations by Version

<table class="comparison-table">
  <thead>
    <tr>
      <th>Category</th>
      <th>Qwen</th>
      <th>Qwen2</th>
      <th>Qwen2.5</th>
      <th>Qwen3</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Architecture</strong></td>
      <td>
        <ul>
          <li>Untied Embedding</li>
          <li>RoPE (FP32 precision)</li>
          <li>QKV Bias</li>
          <li>Flash Attention</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>GQA (Grouped Query Attention)</li>
          <li>Dual Chunk Attention (DCA)</li>
          <li>YARN extension</li>
          <li>MoE Architecture</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>Same as Qwen2</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>QK-Norm (replaces QKV bias)</li>
          <li>Advanced MoE: 128 experts, 8 active, no shared experts</li>
          <li>ABF + YARN</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td><strong>Training</strong></td>
      <td>
        <ul>
          <li>Standard pre-training</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>Enhanced data quality</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>Better data filtering</li>
          <li>Better synthetic data</li>
          <li>Optimized data mixture</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>Multi-stage pre-training (3 stages)</li>
          <li>Multi-stage RLHF (4 stages)</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td><strong>Tokenization</strong></td>
      <td>
        <ul>
          <li>tiktoken (BBPE)</li>
          <li>~152k vocabulary</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>BBPE</li>
          <li>151,646 tokens (3 control)</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>Expanded control tokens (3→22)</li>
          <li>Tool-related tokens</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>Same as Qwen2.5</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td><strong>Context Length</strong></td>
      <td>2K</td>
      <td>32K-128K (YARN)</td>
      <td>32K-128K (YARN)</td>
      <td>32K-128K (ABF + YARN)</td>
    </tr>
    <tr>
      <td><strong>Special Features</strong></td>
      <td>
        <ul>
          <li>Code-Qwen variants</li>
          <li>Math-Qwen variants</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>Model-based data synthesis</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>Reward model filtering</li>
        </ul>
      </td>
      <td>
        <ul>
          <li>Hybrid Thinking Modes</li>
          <li>Enhanced Agent Capabilities</li>
          <li>MCP support</li>
        </ul>
      </td>
    </tr>
  </tbody>
</table>