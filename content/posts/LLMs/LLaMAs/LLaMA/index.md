+++
date = '2023-02-27T17:45:01+08:00'
draft = false
title = 'LLaMA: Open and Efficient Foundation Language Models'
categories = ['LLMs']
tags = ['LLMs', 'LLaMAs']
+++

:(fas fa-building fa-fw):<span style="color:gray">Meta AI</span>
:(fas fa-file-pdf fa-fw):[arXiv 2302.13971](https://arxiv.org/abs/2302.13971)
:(fab fa-github fa-fw):[facebookresearch/llama](https://github.com/facebookresearch/llama)
<img src="https://huggingface.co/front/assets/huggingface_logo-noborder.svg" alt="Hugging Face" style="height: 0.9em; vertical-align: -0.15em; margin-right: 2px;">[meta-llama/Llama-2-7b-hf](https://huggingface.co/meta-llama/Llama-2-7b-hf)

## TL;DR

LLaMA (Large Language Model Meta AI) is a collection of foundation language models ranging from 7B to 65B parameters. The models demonstrate that state-of-the-art performance can be achieved using publicly available datasets exclusively, without resorting to proprietary and inaccessible datasets.

## Motivation

The goal of LLaMA is to show that it is possible to train state-of-the-art models using publicly available datasets exclusively, without resorting to proprietary and inaccessible datasets. By training on more tokens, smaller models can achieve better performance than larger models trained on fewer tokens.

## Key Innovations

- **Efficient Training**: Smaller models trained on more tokens outperform larger models trained on fewer tokens
- **Open Foundation**: Trained exclusively on publicly available datasets
- **Scalable Architecture**: Transformer-based architecture with optimizations for efficiency
- **Multiple Sizes**: Four model sizes (7B, 13B, 33B, 65B) for different use cases

## Approach

### Model Architecture

LLaMA is based on the Transformer architecture with the following modifications:

- **Pre-normalization**: Using RMSNorm for improved training stability
- **SwiGLU Activation**: Swish-Gated Linear Unit activation function
- **Rotary Position Embeddings (RoPE)**: Replacing absolute positional embeddings with rotary embeddings
- **Architecture Variants**:
  - 7B: 32 layers, 32 attention heads, 4096 hidden dimension
  - 13B: 40 layers, 40 attention heads, 5120 hidden dimension
  - 33B: 60 layers, 52 attention heads, 6656 hidden dimension
  - 65B: 80 layers, 64 attention heads, 8192 hidden dimension

### Tokenization

- **Tokenizer**: SentencePiece with BPE algorithm
- **Vocabulary Size**: 32,000 tokens
- **Encoding**: Byte-level BPE for better handling of multilingual text

### Pre-training

#### Pre-training Data

The training data consists of a mixture of several large-scale datasets:

- **CommonCrawl**: Web crawl data (67% of training data)
- **C4**: Cleaned CommonCrawl (15% of training data)
- **Wikipedia**: English Wikipedia (4.5% of training data)
- **Gutenberg and Books3**: Books dataset (4.5% of training data)
- **ArXiv**: Scientific papers (2.5% of training data)
- **Stack Exchange**: Q&A data (2% of training data)

**Total Training Data**: Approximately 1.4 trillion tokens

#### Training Details

- **Context Length**: 2,048 tokens
- **Optimizer**: AdamW with β₁=0.9, β₂=0.95
- **Learning Rate**: Cosine schedule with warmup
- **Batch Size**: 4 million tokens per batch
- **Training Duration**: Varies by model size (7B: ~82K steps, 65B: ~15K steps)

## Experiments

LLaMA models achieve competitive performance across various benchmarks:

- **MMLU**: Strong performance on multi-task language understanding
- **GSM8K**: Competitive results on mathematical reasoning
- **HumanEval**: Good performance on code generation
- **TriviaQA**: Strong performance on question answering

The 13B parameter model outperforms GPT-3 (175B) on most benchmarks, while the 65B model is competitive with PaLM (540B).

## References

- Touvron, H., et al. (2023). LLaMA: Open and Efficient Foundation Language Models. arXiv preprint arXiv:2302.13971.

## Question
