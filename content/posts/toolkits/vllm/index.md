+++
date = '2025-11-27T21:07:50+08:00'
draft = false
title = 'vLLM'
organization = []
categories = []
tags = []
+++

[Docs](https://docs.vllm.ai/en/latest/) &middot; [GitHub](https://github.com/vllm-project/vllm)


vLLM is a high-throughput and memory-efficient **inference and serving engine for LLMs**.
- Run open-source models on vLLM
- Build appplications with vLLM
- Build vLLM

vLLM is fast with:

- State-of-the-art serving throughput
- Efficient management of attention key and value memory with PagedAttention
- Continuous batching of incoming requests
- Fast model execution with CUDA/HIP graph
- Quantization: GPTQ, AWQ, INT4, INT8, and FP8
- Optimized CUDA kernels, including integration with FlashAttention and FlashInfer.
- Speculative decoding
- Chunked prefill

vLLM is flexible and easy to use with:

- Seamless integration with popular HuggingFace models
- High-throughput serving with various decoding algorithms, including parallel sampling, beam search, and more
- Tensor, pipeline, data and expert parallelism support for distributed inference
- Streaming outputs
- OpenAI-compatible API server
- Support for NVIDIA GPUs, AMD CPUs and GPUs, Intel CPUs and GPUs, PowerPC CPUs, Arm CPUs, and TPU.
- Support for diverse hardware plugins such as Intel Gaudi, IBM Spyre and Huawei Ascend.
- Prefix caching support
- Multi-LoRA support

## Installation
```bash
# Install vLLM with CUDA 12.8 in a fresh new environment.
# pip install vllm --extra-index-url https://download.pytorch.org/whl/cu128
conda create -n vllm-cu128 python=3.12
conda activate vllm-cu128
pip install vllm --extra-index-url https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/pytorch/ # 替换清华源
```
## Offline Batched Inference
- **LLM**: the main class for running offline inference with vLLM engine.
- **SamplingParams**: specify the parameters for the sampling process. By default, vLLM will use sampling parameters recommended by model creator by applying the `generation_config.json` from the Hugging Face model repository if it exists. However, if vLLM's default sampling parameters are preferred, please set `generation_config="vllm"` when creating the LLM instance.

## Online Serving with OpenAI-compatible Server
vLLM can be deployed as a server that implements the OpenAI API protocol.

## On Attention Backends
- On NVIDIA CUDA: FLASH_ATTEN or FLASHINFER

## Multi-modal Inputs
doc.vllm.ai/en/latest/features/multimodal_inputs/