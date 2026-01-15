+++
date = '2026-02-03T15:34:54+08:00'
draft = false
title = 'HuggingFace'
categories = []
tags = []
+++

:(fas fa-award fa-fw):<span style="color:gray"></span>
:(fas fa-building fa-fw):<span style="color:gray"></span>
:(fas fa-file-pdf fa-fw):[arXiv ]()
:(fab fa-github fa-fw):[]()
<img src="https://huggingface.co/front/assets/huggingface_logo-noborder.svg" alt="Hugging Face" style="height: 0.9em; vertical-align: -0.15em; margin-right: 2px;">[]()
:(fas fa-globe fa-fw):[]()
:(fas fa-blog fa-fw):[]()

## Installation
```python
# To configure where repository from the Hub will be cached locally (models, dataset and spaces)
HF_HUB_CACHE="/path/to/your/cache" # Default to  "HF_HOME/hub" (e.g. "~/.cache/huggingface/hub")

# To configure where Xet chunks (byte ranges from files managed by Xet Backend) are cached locally.
HF_XET_CACHE="/path/to/your/cache" # Default to  "HF_HOME/xet" (e.g. "~/.cache/huggingface/xet")
```

## Pretrained Models

Each pretrained model inherits from three base classes. 

- `PreTrainedConfig`: A file that specifies a model's attributes such as the number of attention heads or vocabulary size.
- `PreTrainedModel`: A model (or architecture) defined by the model attributes from the configuration file. A pretrained model only returns the raw hidden states. For a specific task, use the appropriate model head to convert the raw hidden states into a meaningful result (for example, LlamaModel versus LlamaForCausalLM)
- `Preprocessor`: A class for converting raw inputs (text, images, audio, multimodal) into numerical inputs to the model. For example, `PreTrainedTokenizer` converts text into tensors and `ImageProcessingMixin` converts pixels into tensors.



```python
from transformers import AutoModelForCausalLM, AutoTokenizer

# Define model path
ROOT_PATH = "/opt/data/private/magiclee/work/modelscope/hub/models/"
model_name = "Qwen/Qwen3-8B"
model_path = ROOT_PATH + model_name

# Instantiate tokenizer and model
tokenizer = AutoTokenizer.from_pretrained(model_path)
model = AutoModelForCausalLM.from_pretrained(model_path, dtype="auto", device_map="auto")

# Generate text
prompt = "Hello, how are you?"
inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
outputs = model.generate(**inputs, max_new_tokens=100, temperature=0.7, top_p=0.95)
decoded_outputs = tokenizer.batch_decode(outputs, skip_special_tokens=True)
print(decoded_outputs)
```

## Pipeline (Inference)

inference API

supports GPUs, Apple Silicon, and half-precision weights to accelerate inference and save memory.

transformers has two pipeline classes:
- a generic `Pipeline` class with task-specific task identifier
- many task-specific pipelines like `TextGenerationPipeline`

Each task is configured to use a default pretrained model and preprocessor, but this can be overridden with the model parameter.

```python
from transformers import pipeline

device = Accelerator().device
model_path = "Qwen/Qwen3-32B"

# Instantiate pipeline
text_generater = pipeline(task="text-generation", model=model_path, device=device)

# Generate text
prompt = "Hello, how are you?"
outputs = text_generater(prompt, max_new_tokens=100, temperature=0.7, top_p=0.95)
print(outputs)
```



## Trainer (Training or Fine-tuning)


## AutoClass API
The `Auto` classes can automatically infers the appropriate architecture for each task based on the name or path to the pretrained weights/config/vocabulary.

- `AutoConfig`
- `AutoModel`
- `AutoTokenizer`

```python
fro

model = AutoModel.from_pretrained("meta-llama/Llama-2-7b-hf", dtype="auto", device_map="auto")
tokenizer = AutoTokenizer.from_pretrained("meta_llama/Llama-2-7b-hf")
```