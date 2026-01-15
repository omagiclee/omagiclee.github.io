+++
date = '2023-07-18T17:45:18+08:00'
draft = false
title = 'LLaMA 2: Open Foundation and Fine-Tuned Chat Models'
categories = ['LLMs']
tags = ['LLMs', 'LLaMAs']
+++

:(fas fa-building fa-fw):<span style="color:gray">Meta AI</span>
:(fas fa-file-pdf fa-fw):[arXiv 2307.09288](https://arxiv.org/abs/2307.09288)
:(fab fa-github fa-fw):[facebookresearch/llama](https://github.com/facebookresearch/llama)
<img src="https://huggingface.co/front/assets/huggingface_logo-noborder.svg" alt="Hugging Face" style="height: 0.9em; vertical-align: -0.15em; margin-right: 2px;">[meta-llama/Llama-2-7b-hf](https://huggingface.co/meta-llama/Llama-2-7b-hf)
:(fas fa-blog fa-fw):[LLaMA 2](https://ai.meta.com/llama/)

## TL;DR

LLaMA 2 is the next generation of LLaMA models, featuring improved performance, longer context length (4K tokens), and fine-tuned chat models trained with Reinforcement Learning from Human Feedback (RLHF). The models are available in 7B, 13B, and 70B parameter sizes.

## Motivation

LLaMA 2 aims to build upon the success of LLaMA by introducing:
- Improved pre-training with more data and longer context
- Fine-tuned chat models optimized for dialogue
- Enhanced safety through RLHF and safety training
- Open access for research and commercial use

## Key Innovations

- **RLHF Training**: First open-source model trained with Reinforcement Learning from Human Feedback
- **Extended Context**: 4,096 tokens (doubled from LLaMA's 2,048)
- **Safety Improvements**: Comprehensive safety training and red-teaming
- **Chat Models**: Specialized models fine-tuned for conversational AI
- **Commercial License**: Available for commercial use with certain restrictions

## Approach

### Model Architecture

LLaMA 2 maintains the same architecture as LLaMA with improvements:

- **Pre-normalization**: RMSNorm for training stability
- **SwiGLU Activation**: Swish-Gated Linear Unit
- **Rotary Position Embeddings (RoPE)**: Rotary embeddings for positional encoding
- **Grouped Query Attention (GQA)**: Introduced in 70B model for efficiency
- **Architecture Variants**:
  - 7B: 32 layers, 32 attention heads, 4096 hidden dimension
  - 13B: 40 layers, 40 attention heads, 5120 hidden dimension
  - 70B: 80 layers, 64 attention heads, 8192 hidden dimension (with GQA)

### Tokenization

- **Tokenizer**: SentencePiece with BPE algorithm
- **Vocabulary Size**: 32,000 tokens
- **Encoding**: Byte-level BPE for multilingual support

### Pre-training

#### Pre-training Data

- **Total Training Data**: Approximately 2 trillion tokens (40% more than LLaMA)
- **Data Sources**:
  - Publicly available online data
  - Enhanced data quality filtering
  - Improved data diversity
- **Context Length**: 4,096 tokens (doubled from LLaMA)

#### Training Details

- **Optimizer**: AdamW with β₁=0.9, β₂=0.95
- **Learning Rate**: Cosine schedule with warmup
- **Batch Size**: 4 million tokens per batch
- **Training Duration**: Varies by model size

### Post-training

#### Supervised Fine-Tuning (SFT)

- **Data**: Over 100,000 human-annotated examples
- **Format**: Multi-turn conversations
- **Quality**: High-quality, helpful, and safe responses

#### Reinforcement Learning from Human Feedback (RLHF)

- **Reward Model**: Trained on human preference data
- **Methods**: 
  - Rejection Sampling
  - Proximal Policy Optimization (PPO)
- **Safety**: Integrated safety considerations into reward model

#### Safety Training

- **Red Teaming**: Extensive adversarial testing
- **Safety Tuning**: Additional fine-tuning for safety
- **Contextual Distillation**: Knowledge distillation for safety

## Experiments

LLaMA 2 models show significant improvements over LLaMA:

- **MMLU**: Improved performance on multi-task understanding
- **GSM8K**: Better mathematical reasoning
- **HumanEval**: Enhanced code generation
- **Safety Benchmarks**: Strong performance on safety evaluations
- **Helpfulness**: Improved helpfulness in conversational tasks

The 70B model is competitive with closed-source models like GPT-3.5 and PaLM-2.

## References

- Touvron, H., et al. (2023). LLaMA 2: Open Foundation and Fine-Tuned Chat Models. arXiv preprint arXiv:2307.09288.

## Question
