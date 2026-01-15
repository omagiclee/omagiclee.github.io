+++
date = '2022-03-04T17:41:08+08:00'
draft = false
title = 'InstructGPT'
categories = ['LLMs']
tags = ['LLMs', 'GPTs', 'Instruct Tuning']
+++

:(fas fa-award fa-fw):<span style="color:gray">NeurlPS 2022</span>
:(fas fa-building fa-fw):<span style="color:gray">OpenAI</span>
:(fas fa-file-pdf fa-fw):[arXiv 2203.02155](https://arxiv.org/abs/2203.02155)


## TL;DR

<span style="color:red;">InstructGPT aligns language models with human intent using supervised fine-tuning (SFT) and reinforcement learning from Human Feedback (RLHF) to improve following instructions and minimize harmful outputs.</span>

## Motivations & Innovations

## Approach

### Model

GPT-3 pretrained language models.

### Training Recipe

![](assets/images/2026-01-15-15-02-29.webp)

#### Supervised Fine-tuning (SFT)

#### Reward Modeling (RM)

#### Reinforcement Learning (RL)

### Data Recipe
**Step1: Collect demonstration data, and train a supervised policy.**

**Step 2: Collect comparison data, and train a reward model.**

**Step3: Optimize a policy against the reward model using PPO.**

## Experiments

