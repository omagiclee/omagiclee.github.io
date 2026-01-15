+++
date = '2024-04-18T17:45:20+08:00'
draft = false
title = 'LLaMA 3: The Most Capable Openly Available LLM to Date'
categories = ['LLMs']
tags = ['LLMs', 'LLaMAs']
+++

:(fas fa-building fa-fw):<span style="color:gray">Meta AI</span>
:(fas fa-file-pdf fa-fw):[arXiv 2404.14219](https://arxiv.org/abs/2404.14219)
:(fab fa-github fa-fw):[meta-llama/llama3](https://github.com/meta-llama/llama3)
<img src="https://huggingface.co/front/assets/huggingface_logo-noborder.svg" alt="Hugging Face" style="height: 0.9em; vertical-align: -0.15em; margin-right: 2px;">[meta-llama/Meta-Llama-3-8B](https://huggingface.co/meta-llama/Meta-Llama-3-8B)
:(fas fa-blog fa-fw):[LLaMA 3](https://ai.meta.com/blog/meta-llama-3/)

## TL;DR

LLaMA 3 represents a significant advancement in open-source language models, featuring improved reasoning capabilities, extended context length (8K tokens), and a new tokenizer with 128K vocabulary. The initial release includes 8B and 70B parameter models, with larger models planned.

## Motivation

LLaMA 3 aims to push the boundaries of open-source language models by:
- Improving reasoning and instruction-following capabilities
- Enhancing multilingual performance
- Extending context length for better long-context understanding
- Providing a more efficient tokenizer for better compression

## Key Innovations

- **Improved Tokenizer**: New tokenizer with 128K vocabulary (4× larger than LLaMA 2)
- **Extended Context**: 8,192 tokens (doubled from LLaMA 2)
- **Better Reasoning**: Enhanced reasoning capabilities through improved training
- **Multilingual Support**: Improved performance across multiple languages
- **Instruction Tuning**: Better instruction-following and task completion

## Approach

### Model Architecture

LLaMA 3 maintains the efficient Transformer architecture with enhancements:

- **Pre-normalization**: RMSNorm for stability
- **SwiGLU Activation**: Swish-Gated Linear Unit
- **Rotary Position Embeddings (RoPE)**: Rotary embeddings
- **Grouped Query Attention (GQA)**: Used in 70B model for efficiency
- **Architecture Variants**:
  - 8B: Optimized architecture with improved efficiency
  - 70B: 80 layers with GQA for efficient inference

### Tokenization

- **Tokenizer**: New tokenizer with improved efficiency
- **Vocabulary Size**: 128,000 tokens (4× increase from LLaMA 2)
- **Benefits**: 
  - Better compression ratio
  - Improved handling of code and technical content
  - Better multilingual support

### Pre-training

#### Pre-training Data

- **Total Training Data**: Over 15 trillion tokens (significantly more than LLaMA 2)
- **Data Quality**: 
  - Enhanced data filtering and quality control
  - Improved data diversity
  - Better code and technical content
- **Context Length**: 8,192 tokens during training

#### Training Details

- **Optimizer**: AdamW with optimized hyperparameters
- **Learning Rate**: Improved learning rate schedule
- **Training Efficiency**: Optimized training pipeline for better efficiency
- **Data Mixing**: Improved data mixing strategies

### Post-training

#### Supervised Fine-Tuning (SFT)

- **Instruction Tuning**: Large-scale instruction tuning dataset
- **Quality**: High-quality instruction-response pairs
- **Diversity**: Diverse tasks and domains

#### Reinforcement Learning from Human Feedback (RLHF)

- **Improved RLHF**: Enhanced RLHF pipeline
- **Reward Modeling**: Better reward model training
- **Safety**: Continued focus on safety and helpfulness

## Experiments

LLaMA 3 models demonstrate state-of-the-art performance:

- **MMLU**: Strong performance on multi-task understanding
- **GSM8K**: Excellent mathematical reasoning
- **HumanEval**: Competitive code generation
- **AGI Eval**: Strong performance on AGI benchmarks
- **Multilingual**: Improved performance across multiple languages

The 70B model is competitive with GPT-4 and other leading closed-source models on many benchmarks.

## References

- Meta AI. (2024). LLaMA 3 Model Card. arXiv preprint arXiv:2404.14219.

## Question
