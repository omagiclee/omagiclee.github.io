+++
date = '2022-03-21T17:45:08+08:00'
draft = false
title = 'Self-Consistency Improves Chain of Thought Reasoning in Language Models'
categories = ['LLMs']
tags = ['LLMs', 'Chain-of-Thought']
+++

:(fas fa-award fa-fw):<span style="color:gray">ICLR 2023</span>
:(fas fa-building fa-fw):<span style="color:gray">Google Research, Brain Team</span>
:(fas fa-file-pdf fa-fw):[arXiv 2203.11171](https://arxiv.org/abs/2203.11171)


## TL;DR

<span style="color:red;">Self-Consistency boosts the performance of chain-of-thought prompting with a striking margin in a "self-ensemble" manner.</span>

## Motivations & Innovations

- Although LLMs have demonstrated remarkable success, their reasoning capabilities are still limited, which cannot be overcome solely by increasing model scale. -> chain-of-thought prompting
- LLMs are not perfect resoners -> incorrect reasoning paths -> self-consistency to boost the performance


## Approach

Self-Consistency over Diverse Reasoning Paths

![](./images/index-20260130143947.webp)

- Few-shot Chain-of-Thought (CoT) Prompting
- Sample a diverse set of candidate reasoning paths instead of only taking the greedy one
    - temperature sampling
    - top-k sampling
    - nucleus sampling / top-p sampling
- Marginalize out the sampled reasoning paths by taking a magority vote

## Experiments

- self-consistency boosts the performance of chain-of-thought prompting with a striking margin

**Robustness of Self-Consistency over Diverse Sampling Strategies**: Self-Consistency is robust to sampling strategies and scaling.

![](./images/index-20260130152719.webp)