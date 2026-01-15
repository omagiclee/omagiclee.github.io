+++
date = '2022-03-04T17:41:08+08:00'
draft = false
title = 'InstructGPT: Training language models to follow instructions with human feedback'
categories = ['LLMs']
tags = ['LLMs', 'GPTs', 'Instruction Tuning', 'Reinforcement Learning']
+++

:(fas fa-award fa-fw):<span style="color:gray">NeurlPS 2022</span>
:(fas fa-building fa-fw):<span style="color:gray">OpenAI</span>
:(fas fa-file-pdf fa-fw):[arXiv 2203.02155](https://arxiv.org/abs/2203.02155)


## TL;DR

<span style="color:red;">InstructGPT aligns language models with human intent using supervised fine-tuning (SFT) and reinforcement learning from Human Feedback (RLHF) to improve following instructions and minimize harmful outputs.</span>

## Motivations & Innovations
LLMs can generate outputs that are untruthful, toxic or simply not helpful to the user. -> training objective is next-token prediction rather than following instructions helpfully and safely. -> **instruction tuning**:
- explicit intentions: following instructions
- implicit intentions: we want language models to be helpful (they should help the user solve their task), honest (they shouldn’t fabricate information or mislead the user), and harmless (they should not cause physical, psychological, or social harm to people or the environment).

## Approach

![](images/2026-01-15-15-02-29.webp)

### Model Architecture

base model: pretrained GPT-3 language model.



### Data Recipe

#### Labeler Selection
We conducted a screening test to select labelers (40 contractors on Upwork and through Scale AI) based on their alignment with researcher standards in sensitive content detection, quality ranking, sensitive demonstration writing and self-assessed ability to identify sensitive speech fro different group.

#### Labeling Interface

<p align="center">
  <img src="./images/index-20260126173800.webp" width="60%">
</p>

#### Labeling Instruction

<p align="center">
  <img src="./images/index-20260126174339.webp" width="40%">
  <img src="./images/index-20260126174920.webp" width="40%">
</p>

<span style="color:red;">During training and evaluation, our alignment criteria may come into conflict: for example, when a user requests a potentially harmful response. During training we prioritize helpfulness to the user (not  7 doing so requires making some difficult design decisions that we leave to future work; see Section 5.4 for more discussion). However, in our final evaluations we asked labelers prioritize truthfulness and harmlessness (since this is what we really care about).</span>

#### Prompts Data
##### Source of Prompts Data
- **Bootstrapping Prompts Data from Human Annotations** -> sft on the bootstrapping data -> the earlier version of InstructGPT on the Playground interface.
    - **Plain**: ask the labelers to come up with an arbitrary task, while ensuring the tasks had sufficient diversity.
    - **Few-shot**: ask the labelers to come up with an instruction, and multiple query/response pairs for that instruction.
    - **User-based**: We had a number of use-cases stated in waitlist applications to the OpenAI API. We asked labelers to come up with prompts corresponding to these use cases.
- **PrimaryPrompts from OpenAI API** -> sft on the prompts from OpenAI API -> the earlier version of InstructGPT on the Playground interface.
    - deduplicate prompts by checking for prompts that share a long common prefix
    - limit the number of prompts to 200 per user ID
    - create train, validation and test splits based on user ID

    <p align="center">
    <img src="./images/index-20260126163542.webp" alt="Prompts Data Diagram" width="30%">
    </p>


##### The Earlier Version of InstructGPT


##### Prompts from OpenAI API

### Training Recipe
#### Supervised Fine-tuning (SFT)

fine-tune a pretrained GPT-3 model on the labeler demonstrations using supervised learning.

**We trained for 16 epochs and selected the final model based on the RM score on the validation set.Similarly to Wu et al. (2021), we find that our SFT models overfit on validation loss after 1 epoch; however, we find that training for more epochs helps both the RM score and human preference ratings, despite the overfitting.**

#### Reward Modeling (RM)

Starting from the SFT model with the final unembedding layer removed, we trained a model to take in a prompt and response, and output a scalar reward. 

We used 6B RMs for efficiency and we found 175B RM training could be unstable and thus was less suitable to be used as the value function during RL.

#### Reinforcement Learning (RL)

We finetuned the SFT model using PPO on our environment, which presents a random customer prompt and expects a response to the prompt.


**Step3: Optimize a policy against the reward model using PPO.**

## Experiments

