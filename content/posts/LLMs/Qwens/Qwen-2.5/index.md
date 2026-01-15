+++
date = '2024-12-19T10:28:47+08:00'
draft = false
title = 'Qwen2.5 Technical Report'
categories = ['LLMs']
tags = ['LLMs', 'Qwens']
+++

:(fas fa-building fa-fw):<span style="color:gray">Qwen Team, Alibaba Group</span>
:(fas fa-file-pdf fa-fw):[arXiv 2412.15115](https://arxiv.org/abs/2412.15115)
:(fab fa-github fa-fw):[]()
<img src="https://huggingface.co/front/assets/huggingface_logo-noborder.svg" alt="Hugging Face" style="height: 0.9em; vertical-align: -0.15em; margin-right: 2px;">[]()
:(fas fa-globe fa-fw):[]()
:(fas fa-blog fa-fw):[]()

## TL;DR

## Motivation

## Key Innovations

## Approach

### Tokenization

Based on the Qwen BBPE tokenzier (151,646 tokens: 151,624 regular and 22 control), we expand the control tokens from 3 to 22, including two tool-related tokens and 20 for other model capabilities.

### Model Architecture

#### Dense Model
- GQA for efficient KV cache utilization
- SwiGLU for activation
- RoPE for positional embedding
- QKV bias for attention
- RMSNorm and pre-normalization for training stability

#### Mixture-of-Experts (MoE) Model

### Pre-training
#### Pre-training Data
- **Better data filtering**: with Qwen2-Instruct Model
- **Better math and code data**: incorporate high-quality domain-specific datasets (math, code) during pretraining.
- **Better synthetic data**:
    - leverage both Qwen2-72B-Instruct and Qwen2-Math-72B-Instruct to generate high-quality synthetic data, particularly in mathematics, code, and knowledge domain.
    - further enhance the quality of synthesized data through rigorous filtering using our propretary general reward model and the specialized Qwen2-Math-RM-72B model.
- **Better data mixture**:
    - Domains like e-commerce, social media, and entertainment are significantly overrepresented in web-scale data, often containing repetitive, template-based, or machine-generated content.
    - Domains such as technology, science, and academic research, while containing higher-quality information, are traditionally underrepresented.
    - down-sample overrepresented domains and up-sample high-value domains.

## Experiments

## References

