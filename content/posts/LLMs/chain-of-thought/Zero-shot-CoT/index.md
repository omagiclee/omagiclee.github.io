+++
date = '2022-05-24T17:41:26+08:00'
draft = false
title = 'Zero-shot-CoT: Large Language Models are Zero-Shot Reasoners'
categories = ['LLMs']
tags = ['LLMs', 'Chain-of-Thought']
+++

:(fas fa-award fa-fw):<span style="color:gray">NeurIPS 2022</span>
:(fas fa-building fa-fw):<span style="color:gray">Google Research, Brain Team</span>
:(fas fa-file-pdf fa-fw):[arXiv 2205.11916](https://arxiv.org/abs/2205.11916)


## TL;DR

<span style="color:red;">Zero-shot-CoT, a zero-shot task-agnostic prompt (**Let's think step by step.**) without any step-by-step few-shot examples, elicits multi-hop reasoning ability.</span>

## Motivations & Innovations

- The success of large language models is often attributed to (in-context) few-shot learning called "prompting".
- With CoT prompting, the reasoning performance satisfies the scaling laws better and jumps up with the size of the language model.

![](./images/index-20260120160643.webp)

## Approach: Two-stage Prompting

![](./images/index-20260120164753.webp)

### 1st Prompt: Reasoning Extraction

### 2nd Prompt: Answer Extraction

## Experiments

**Zero-shot-CoT vs Zero-shot**: 

![](./images/index-20260128174335.webp)

**Comparison with other baselines**:

![](./images/index-20260128174431.webp)

**Does model size matter for zero-shot reasoning?**: Yes

![](./images/index-20260128174518.webp)

**How does prompt selection affect Few-shot-CoT**: 

![](./images/index-20260120160829.webp)