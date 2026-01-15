+++
date = '2025-11-27T21:07:50+08:00'
draft = false
title = 'vLLM: Easy, fast, and cheap LLM inference and serving'
categories = ['LLM Inference Frameworks']
tags = ['vLLM', 'PagedAttention', 'LLM Serving']
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
# Install vLLM in a fresh new environment (Recommended).
# conda: manage python & cuda version
(vllm-cu128) ➜  /workspace conda create -n vllm-cu128 python=3.12
(vllm-cu128) ➜  /workspace conda activate vllm-cu128

# pip install pipx
(vllm-cu128) ➜  /workspace pip install pipx

# pipx install uv       
(vllm-cu128) ➜  /workspace pipx install uv 
  installed package uv 0.10.2, installed using Python 3.12.12
  These apps are now globally available
    - uv
    - uvx
⚠️  Note: '/root/.local/bin' is not on your PATH environment variable. These apps will not be globally accessible until your PATH is updated. Run `pipx ensurepath` to automatically add it, or manually
    modify your PATH in your shell's config file (e.g. ~/.bashrc).
done! ✨ 🌟 ✨
(vllm-cu128) ➜  /workspace pipx ensurepath

# configure uv env
(vllm-cu128) ➜  /workspace vim pyproject.toml
[tool.uv]
index-url = "https://mirrors.aliyun.com/pypi/simple/"

# uv pip install vllm
(vllm-cu128) ➜  /workspace uv init vllm --python 3.12
(vllm-cu128) ➜  /workspace uv venv vllm-venv --python 3.12
(vllm-cu128) ➜  /workspace source vllm-venv/bin/activate
(vllm-venv) (vllm-cu128) ➜  /workspace uv pip install vllm --torch-backend=auto

# configure vllm env
export VLLM_USE_MODELSCOPE=True
export MODELSCOPE_CACHE="/opt/data/private/magiclee/work/modelscope/hub"

# install flash-attn
uv pip install flash-attn --no-build-isolation
```

## Offline Batched Inference
- **LLM**: the main class for running offline inference with vLLM engine.
- **SamplingParams**: specify the parameters for the sampling process. By default, vLLM will use sampling parameters recommended by model creator by applying the `generation_config.json` from the Hugging Face model repository if it exists. However, if vLLM's default sampling parameters are preferred, please set `generation_config="vllm"` when creating the LLM instance.

## Online Serving with OpenAI-compatible Server
vLLM can be deployed as a server that implements the OpenAI API protocol.

### Start the vLLM Server
```bash

# Start vLLM server on the remote server 
CUDA_VISIBLE_DEVICES=0,1,2,3 vllm serve --config config1.yaml
CUDA_VISIBLE_DEVICES=0,1,2,3 vllm serve --config config1.yaml (change port)

# Test on the local machine
curl http://localhost:8000/v1/models
```

#### GLM-5
Serving FP8 Model on 8xH200 (or H20) GPUs (141GB × 8)

#### DeepSeek-V3.2-Speciale
Serving on 8xH200 (or H20) GPUs (141GB × 8) / 8xB200 GPUs

https://docs.vllm.ai/projects/recipes/en/latest/DeepSeek/DeepSeek-V3_2-Exp.html#installing-vllm

#### Qwen3-Coder-Next
```yaml
# config.yaml

model: Qwen/Qwen3-Coder-Next
served-model-name: Qwen3-Coder-Next  # model alias name
host: "127.0.0.1"
port: 8000
uvicorn-log-level: "info"

# Memory Optimization
tensor_parallel_size: 8  # Tensor Parallelism (TP): split the model across multiple GPUs.
max_model_len: 200000  # context length
max_num_seqs: 2  # maximum batch size

use_cuda_graph true
--enable-prefix-caching true
```

#### Kimi-K2.5
It's not recommended on deploying Kimi-K2.5 with vLLM on 8x A100-80G , the context length can only be set to 70k and can not use flash-attn due to the head size, MLA architecture and the A100's capability.


```yaml
# config.yaml

model: moonshotai/Kimi-K2___5
served-model-name: Kimi-K25  # model alias name
host: "127.0.0.1"
port: 8002
uvicorn-log-level: "info"
trust_remote_code: True

# Memory Optimization
tensor_parallel_size: 8  # Tensor Parallelism (TP): split the model across multiple GPUs.
max_model_len: 50000  # context length
max_num_seqs: 2  # maximum batch size
gpu-memory-utilization: 0.98

enable_auto_tool_choice: true
tool_call_parser: "default"  # 或使用支持的解析器
```

### OpenAI Compatible API with vLLM

### OpenAI Chat Completions API with vLLM

```bash
uv pip install openai

from openai import OpenAI

openai_api_key = "omagiclee"
openai_api_base = "http://localhost:8000/v1"

client = OpenAI(
    api_key=openai_api_key,
    base_url=openai_api_base,
)

response = client.chat.completions.create(
    model="moonshotai/Kimi-K2.5",
    messages=[
        {
            "role": "system",
            "content": "You are a helpful AI Coding assistant."
        },
        {
            "role": "user",
            "content": "Write a Python function to calculate the Fibonacci sequence."
        }
    ]
)
```


## On Attention Backends
- On NVIDIA CUDA: FLASH_ATTEN or FLASHINFER

## Multi-modal Inputs
doc.vllm.ai/en/latest/features/multimodal_inputs/