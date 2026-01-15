+++
date = '2018-06-11T16:34:11+08:00'
draft = false
title = 'GPT-1: Improving Language Understanding by Generative Pre-Training'
categories = ['LLMs']
tags = ['LLMs', 'GPTs']
+++

:(fas fa-building fa-fw):<span style="color:gray">OpenAI</span>
:(fas fa-file-pdf fa-fw):[pdf](https://cdn.openai.com/research-covers/language-unsupervised/language_understanding_paper.pdf)
:(fas fa-blog fa-fw):[blog](https://openai.com/index/language-unsupervised/)


## TL;DR

<span style="color:red;">GPT-1 pioneered the "Unsupervised Pre-training + Supervised Fine-tuning" paradigm, utilizing a Decoder-only Transformer architecture with universal task-specific input transformations to learn universal representations from unlabeled text that seamlessly generalize to diverse downstream tasks.</span>

## Motivations & Innovations

- Natural language processing tasks are typically approached with supervised learning, heavily rely on large-scale labeled task-specific data. -> **unsupervised pre-training on large unlabeled corpus**
- Leveraging unlabeled data is challenging due to the lack of consensus on the optimal optimization objectives for learning transferable text representations. -> **language modeling objective**
- The absence of a unified framework for effective transfer strategies has hindered the progress of robust semi-supervised learning in NLP. -> **task-specific input transformations**
- The similar method with LSTM models suffers from a restricted capacity to capture long-range dependencies in linguistic structures. -> **Transformer architecture**

## Approach
### Model

![](assets/images/2026-01-08-16-48-23.webp)

- a 12-layer decoder-only transformer.
- bytepair encoding (BPE) vocabulary with 40,000 merges.
- learned position embeddings.

### Training Recipe
#### Stage 1: Unsupervised Pre-training

Given an **unsupervised corpus** of tokens $U = \lbrace u_1, \ldots, u_n \rbrace$, we use a standard **language modeling objective** with a multi-layer **Transformer** decoder (**decode-only**) to maximize the following likelihood:

$$
L_1(U) = \sum_i \log P(u_i | u_{i-k}, \ldots, u_{i-1}; \Theta)$$

where:
- $k$ is the size of the context window
- $P$ is the conditional probability modeled using a neural network with parameters $\Theta$

#### Stage 2: Supervised Fine-tuning
**Task-specific Input Transformations:** To avoid making extensive changes to the architecture across tasks, we convert structured inputs into an ordered sequence that out pre-trained model can process.


After pre-training, we adapt the model to supervised downstream tasks. For a labeled dataset $\mathcal{C}$, each instance contains an input sequence $x^1, \ldots, x^m$ and a label $y$. The model processes the input sequence through the pre-trained Transformer to obtain the final hidden state $h_l^m$, then predicts the label through a linear output layer:

$$
P(y | x^1, \ldots, x^m) = \text{softmax}(h_l^m W_y)
$$

where $W_y$ is the task-specific linear layer parameter.

**Optimization Objective:**

The fine-tuning stage maximizes the following objective:

$$
L_2(\mathcal{C}) = \sum_{(x,y)} \log P(y | x^1, \ldots, x^m)
$$

To improve generalization and accelerate convergence, we typically include the language modeling objective as an auxiliary objective:

$$
L_3(\mathcal{C}) = L_2(\mathcal{C}) + \lambda L_1(\mathcal{C})
$$

where $\lambda$ is the weighting hyperparameter.

## Experiments
- Our approach achieves new SOTA results in 9 out of the 12 datasets we evaluate on.

### Ablation Study
**Impact of number of layers transferred:** Each layer in the pre-trained model contains useful functionality for solving target tasks.

![](assets/images/2026-01-13-14-25-17.webp)

**Zero-shot Behaviors:** 
- **Why language model pre-training of transformers is effective?**
    - The performance of these heuristics is stable and steadily increases over training -> to improve the language modeling capability, the underlying generative model learns a wide variety of task relevant functionality.
    - The LSTM exhibits higher variance in its zero-shot performance. -> The inductive bias of the Transformer architecture assists in transfer.

**Impact of Auxiliary Language Model Objective during Fine-tuning:** The auxiliary language model objective during fine-tuning enhance performance of sft tasks. And the benifits of auxiliary LM objective is positively correlated with the dataset scale.

**Impact of Pre-training**: The lack of pre-training hurts performance across all the tasks.


