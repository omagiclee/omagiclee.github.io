+++
date = '2021-07-29T12:16:16+08:00'
draft = false
title = 'Summary: Sequence Packing'
categories = ['LLMs']
tags = ['LLMs', 'Sequence Packing']
+++


. Instead of padding, we concatenate multiple shorter sequences into a single, longer sequence. This minimizes wasted compute (through padding tokens)


## References
- [Efficient Sequence Packing without Cross-contamination: Accelerating Large Language Models without Impacting Performance](https://arxiv.org/abs/2107.02027)
- https://huggingface.co/blog/sirluk/llm-sequence-packing
- https://docs.nvidia.com/nemo-framework/user-guide/24.12/nemotoolkit/features/optimizations/sequence_packing.html
- https://docs.pytorch.org/docs/stable/generated/torch.nn.utils.rnn.pack_sequence.html


