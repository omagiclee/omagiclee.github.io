+++
date = '2025-01-01T19:59:15+08:00'
draft = false
title = 'Local AI Programming Assistant: VSCode + Continue/Cline + vLLM + Kimi-K2.5'
categories = ['LLM Inference Engines']
tags = ['LLM Inference Engines', 'VSCode', 'Continue', 'Cline', 'vLLM', 'OpenAI Compatible']
featured = true
+++

## Introduction

This document provides a comprehensive guide to integrating [vLLM](https://github.com/vllm-project/vllm) with [Continue](https://github.com/continuedev/continue) and [Cline](https://github.com/cline/cline) to build a high-performance, low-latency local LLM programming assistant environment.
- vLLM leverages advanced inference technologies including PagedAttention for efficient memory management
- Continue and Cline provide powerful AI-assisted coding capabilities directly within the VSCode environment through OpenAI-compatible API integration.

## Architecture

<div style="display: flex; justify-content: center;">
{{% mermaid %}}
graph TB
    subgraph "User Interface"
        A[VSCode]
    end
    
    subgraph "AI Copilot Layer"
        B[Continue Extension]
        C[Cline]
    end
    
    subgraph "Inference Layer"
        D[vLLM Server]
    end
    
    subgraph "Model Storage"
        F[HuggingFace<br/>ModelScope]
    end
    
    A --> B
    A --> C
    B --> D
    C --> D
    D --> F
{{% /mermaid %}}
</div>

### Component Description

| Component | Role | Key Features |
|:---------:|:----:|:------------:|
| **vLLM** | LLM Inference Service | PagedAttention, Streaming, Prefix Caching |
| **Continue** | VSCode AI Copilot | Code Completion, Summarization, Diagnostics, Refactoring |
| **Cline** | AI Programming Assistant | Task Execution, Conversation, Multi-file Operations |
| **OpenAI API** | Communication Protocol | Standardized Interface, Good Compatibility |


## Installation & Configuration
### [vLLM Installation & Configuration](/posts/toolkits/llm-inference-engines/vllm/#installation)

### Continue & Cline Installation & Configuration

#### Install Continue & Cline Extensions

1. Open VSCode Extension Market (`Ctrl+Shift+X`)
2. Search for "Continue" or "Cline"
3. Click to install the extension

#### Configure Continue & Cline

- **Continue Configuration**
  - API Provider: OpenAI Compatible
  - Base URL: http://localhost:8000/v1
  - API Key: YOUR_API_KEY
  - Model ID: Qwen3-Coder-Next (same as the model name when starting the vLLM server)
  - Context Window Size: 8192-16384

- **Cline Configuration**
  - API Provider: OpenAI Compatible
  - Base URL: http://localhost:8000/v1
  - API Key: YOUR_API_KEY
  - Model ID: Qwen3-Coder-Next (same as the model name when starting the vLLM server)
  - Context Window Size: 8192-16384

## Model Selection Strategy

| Task Type | Recommended Model | Reason |
|:---------:|:-----------------:|:------:|
| Code Completion | ~7B | Fast speed, low resource usage |
| Code Generation | 7B+ | Balanced performance and quality |

## Custom Prompt Templates [to review]

### Continue Prompt Template

Create `~/.continue/prompt.py` with a custom system prompt configuration:

```python
from typing import List
from continue_core.config.config import Config

def build_prompt(context: List[str], user_query: str, config: Config) -> str:
    context_str = "\n\n".join(context) if context else "No context provided."
    
    return f"""<|begin_of_text|><|start_header_id|>system<|end_header_id|>
You are an expert full-stack developer proficient in Python, TypeScript, and Go.

**Code Quality Standards:**
1. Follow PEP 8 / Google Style Guide
2. Include type annotations
3. Implement error handling
4. Write unit tests

**Output Format:**
- Brief explanation first
- Then provide code implementation
- Finally, include usage examples

<|eot_id|><|start_header_id|>user<|end_header_id|>
**Context Code:**
{context_str}

**Question:**
{user_query}

Please follow the above specifications:<|eot_id|><|start_header_id|>assistant<|end_header_id|>"""
```

### Cline Prompt Template

Cline supports custom system prompts via `~/.cline/config.yaml`:

```yaml
models:
  - name: Qwen-Coder
    provider: openai
    model: Qwen-Coder
    api_base: http://localhost:8000/v1
    api_key: EMPTY
    context_length: 8192
    system_prompt: |
      You are an expert full-stack developer proficient in Python, TypeScript, and Go.
      
      **Code Quality Standards:**
      1. Follow PEP 8 / Google Style Guide
      2. Include type annotations
      3. Implement error handling
      4. Write unit tests
      
      **Output Format:**
      - Brief explanation first
      - Then provide code implementation
      - Finally, include usage examples
```
