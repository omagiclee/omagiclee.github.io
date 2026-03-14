+++
date = '2025-05-07T14:35:34+08:00'
draft = false
title = 'Transformers'
+++

Transformers is a library of pretrained natural language processing, computer vision, audio, and multimodal models for inference and training. 


# Pretrained models
Each **pretrained model** inherits from three base classes.

* PretrainedConfig
* PreTrainedModel
* Preprocessor

# Pipeline
Simple and optimized **inference** class for many machine learning tasks like text generation, image segmentation, automatic speech recognition, document question answering, and more.

# Trainer
A comprehensive trainer that supports features such as mixed precision, torch.compile, and FlashAttention for **training** and distributed training for PyTorch models.

# generate
Fast text generation with large language models (LLMs) and vision language models (VLMs), including support for streaming and multiple decoding strategies.

# Design
1. Fast and easy to use: Every model is implemented from only three main classes (configuration, model, and preprocessor) and can be quickly used for inference or training with Pipeline or Trainer.
2. Pretrained models: Reduce your carbon footprint, compute cost and time by using a pretrained model instead of training an entirely new one.
# [Installation](https://huggingface.co/docs/transformers/installation)
```bash
pip install transformers
```

# [Download files from the Hub](https://huggingface.co/docs/huggingface_hub/guides/download#download-files-from-the-hub)






## 查看模型结构
### 打印 Model 对象
```python
from transformers import AutoModel
model = AutoModel.from_pretrained('bert-base-uncased')
print(model)
```