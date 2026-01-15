+++
date = '2019-02-14T11:04:08+08:00'
draft = false
title = 'BBPE: Byte-level Byte Pair Encoding'
categories = ['LLMs']
tags = ['LLMs', 'Tokenizer']
+++

## 引言

字节级字节对编码（Byte-level Byte Pair Encoding, BBPE）是 GPT-2 引入的一种分词算法，它将传统的 BPE（Byte Pair Encoding）算法扩展为在字节级别操作。这种方法通过确保任何文本都能被分词而不产生未知标记，从根本上解决了词表外（Out-of-Vocabulary, OOV）问题，因为所有字符都可以表示为 UTF-8 字节。

## 传统 BPE 的问题

传统 BPE 算法直接在 Unicode 字符上操作。当遇到词表中不存在的字符时，这些算法会产生 `<UNK>`（未知）标记，导致信息丢失和模型性能下降。在处理以下情况时，这一限制变得尤为严重：

- **多语言文本**：不同语言具有完全不同的字符集
- **罕见字符**：特殊符号、表情符号或领域特定字符
- **混合脚本**：包含多种书写系统的文本

## BBPE 解决方案

BBPE 通过引入字节级预处理步骤来解决这些限制。BBPE 不是直接在字符上操作，而是：

1. 将所有文本转换为 UTF-8 字节序列
2. 将字节映射到可打印的 Unicode 字符（避免控制字符）
3. 对这些字节表示应用 BPE 合并操作

这确保了任何文本，无论语言或字符集如何，都能被分词而不产生未知标记。

## 技术架构

BBPE 分词过程包含四个顺序步骤：

### 步骤 1：预分词（Pre-tokenization）

预分词使用正则表达式在应用 BPE 之前将文本分割成更小的片段。这防止了不同类型字符的错误合并。GPT-2 分词器使用以下正则模式：

```python
import regex as re

PATTERN = r"""'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+"""
```

**模式组件：**

1. **缩略词**：`'s|'t|'re|'ve|'m|'ll|'d` - 处理英文缩略形式
2. **字母**：` ?\p{L}+` - 可选空格后跟一个或多个 Unicode 字母（包括中文字符）
3. **数字**：` ?\p{N}+` - 可选空格后跟一个或多个 Unicode 数字
4. **标点符号**：` ?[^\s\p{L}\p{N}]+` - 可选空格后跟非空白、非字母、非数字字符
5. **尾部空白**：`\s+(?!\S)` - 文本末尾的空白字符（负向前瞻）
6. **通用空白**：`\s+` - 任何空白字符序列（兜底规则）

**示例：**

```python
text = "I'm 26岁, 住在 101号. 很高兴认识你!   "
# 预分词结果：
# ['I', "'m", ' 26', '岁', ',', ' 住在', ' 101', '号', '.', ' 很高兴认识你', '!', '   ']
```

### 步骤 2：字节到 Unicode 映射（Byte-to-Unicode Mapping）

此步骤将 256 个可能的字节值（0-255）映射到可打印的 Unicode 字符，避免会干扰 BPE 处理的控制字符和空白字符。

**为什么需要这个映射：**

- BPE 算法在 Unicode 字符串上操作，而不是原始字节
- 直接使用字节表示需要大量词汇表来覆盖所有可能的字节组合
- 在 10B token 的数据集上，大约需要 5K 个 Unicode 字符，这会占用典型 32K BPE 词表的很大一部分
- 该映射允许高效的词表使用，同时保持完整的字节覆盖

**实现：**

```python
def bytes_to_unicode() -> dict[int, str]:
    """
    将 UTF-8 字节映射到可打印的 Unicode 字符。
    
    返回:
        将字节值（0-255）映射到 Unicode 字符的字典
    """
    # 可打印的 ASCII 范围：! (33) 到 ~ (126)
    # 扩展拉丁字符范围用于额外的可打印字符
    bs = (
        list(range(ord("!"), ord("~") + 1)) +  # ASCII 可打印字符
        list(range(ord("¡"), ord("¬") + 1)) +   # 扩展拉丁 1
        list(range(ord("®"), ord("ÿ") + 1))     # 扩展拉丁 2
    )
    cs = bs[:]  # 初始时，字符等于字节
    n = 0
    
    # 将不可打印的字节映射到 U+0100 以上的 Unicode 字符
    for b in range(2**8):  # 所有 256 个可能的字节值
        if b not in bs:
            bs.append(b)
            cs.append(2**8 + n)  # 映射到 U+0100+ 范围
            n += 1
    
    cs = [chr(n) for n in cs]  # 转换为 Unicode 字符
    return dict(zip(bs, cs))
```

**示例：**

```python
# 中文字符 "岁" 的 UTF-8 编码：\xe5\xb2\x81
# 字节到 Unicode 映射后："å²ģ"
token = "岁"
byte_encoder = bytes_to_unicode()
mapped = "".join(byte_encoder[b] for b in token.encode("utf-8"))
# 结果："å²ģ"
```

### 步骤 3：BPE 合并操作（BPE Merge Operations）

核心 BPE 算法根据预计算的合并表（`bpe_ranks`）迭代合并最频繁的标记对。合并过程持续进行，直到无法再进行合并。

**算法：**

```python
def get_pairs(word: tuple[str, ...]) -> set[tuple[str, str]]:
    """从单词中提取所有连续的字符对。"""
    pairs = set()
    prev_char = word[0]
    for char in word[1:]:
        pairs.add((prev_char, char))
        prev_char = char
    return pairs

def bpe(self, token: str) -> str:
    """
    对标记应用 BPE 合并操作。
    
    算法流程：
    1. 在 bpe_ranks 中找到优先级最高的对（rank 值最小）
    2. 合并该对的所有出现
    3. 重复直到无法继续合并
    
    参数:
        token: 输入标记（经过字节到 Unicode 映射后）
        
    返回:
        用空格分隔的 BPE 标记
    """
    # 使用缓存提高性能
    if token in self.cache:
        return self.cache[token]
    
    word = tuple(token)
    pairs = get_pairs(word)

    if not pairs:
        return token

    # 迭代合并
    while True:
        # 找到优先级最高的对（最小 rank）
        bigram = min(
            pairs, 
            key=lambda pair: self.bpe_ranks.get(pair, float("inf"))
        )
        
        # 如果该对不在合并表中，停止
        if bigram not in self.bpe_ranks:
            break
            
        first, second = bigram
        new_word = []
        i = 0
        
        # 合并 (first, second) 的所有出现
        while i < len(word):
            try:
                j = word.index(first, i)
            except ValueError:
                # 没有更多出现，添加剩余部分
                new_word.extend(word[i:])
                break
            else:
                # 添加 first 之前的字符
                new_word.extend(word[i:j])
                i = j

            # 检查 (first, second) 对是否存在
            if i < len(word) - 1 and word[i + 1] == second:
                new_word.append(first + second)  # 合并
                i += 2
            else:
                new_word.append(word[i])  # 不合并
                i += 1
                
        new_word = tuple(new_word)
        word = new_word
        
        # 如果只剩下一个标记，停止
        if len(word) == 1:
            break
        else:
            pairs = get_pairs(word)
    
    # 用空格连接标记
    result = " ".join(word)
    self.cache[token] = result
    return result
```

### 步骤 4：标记 ID 映射（Token ID Mapping）

最后一步将每个 BPE 标记映射到词表中对应的 ID。该映射通常存储在字典（`vocab`）中，将标记字符串映射到整数 ID。

## 完整实现示例

```python
import regex as re
from transformers import PreTrainedTokenizer

class GPT2Tokenizer(PreTrainedTokenizer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pat = re.compile(
            r"""'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+"""
        )
        self.byte_encoder = bytes_to_unicode()
        self.byte_decoder = {v: k for k, v in self.byte_encoder.items()}
        self.cache = {}

    def _tokenize(self, text: str) -> list[str]:
        """使用 BBPE 对文本进行分词。"""
        bpe_tokens = []

        # 步骤 1：预分词
        for token in re.findall(self.pat, text):
            # 步骤 2：字节到 Unicode 映射
            token = "".join(
                self.byte_encoder[b] for b in token.encode("utf-8")
            )
            
            # 步骤 3：应用 BPE 合并
            bpe_tokens.extend(
                bpe_token for bpe_token in self.bpe(token).split(" ")
            )
        
        return bpe_tokens

    def _convert_token_to_id(self, token: str) -> int:
        """将 BPE 标记转换为词表 ID。"""
        return self.vocab.get(token, self.unk_token_id)
```

## BBPE 的主要优势

1. **无 OOV 问题**：通过在字节级别操作，完全消除了未知标记
2. **语言无关**：适用于任何语言或书写系统
3. **可逆性**：编码过程完全可逆，允许准确还原文本
4. **高效性**：在覆盖所有可能输入的同时，保持合理的词表大小

## 对比：Tiktoken vs HuggingFace Tokenizer

### Tiktoken

- **目的**：为 GPT 模型优化的高性能 BPE 实现
- **实现**：核心算法使用 Rust 编写
- **性能**：极快的分词速度
- **适用范围**：专门针对 OpenAI 的 GPT 模型

### HuggingFace Tokenizer

- **目的**：通用分词框架
- **实现**：支持多种算法（BPE、WordPiece、SentencePiece 等）
- **性能**：Fast Tokenizer 使用 Rust 后端，Slow Tokenizer 是纯 Python
- **适用范围**：兼容各种模型架构的通用框架

### 架构对比

**HuggingFace Tokenizer 类结构：**

```
PreTrainedTokenizerBase
├── PreTrainedTokenizer (PythonBackend)
│   ├── GPT2Tokenizer
│   ├── Qwen2Tokenizer
│   └── ...
└── PreTrainedTokenizerFast (RustBackend)
    ├── GPT2TokenizerFast
    ├── Qwen2TokenizerFast
    └── ...
```

**主要区别：**

- **Slow Tokenizers**：完整的 Python 实现，功能完整但速度较慢
- **Fast Tokenizers**：基于 Rust 的后端，性能更快但可能有功能限制

## 分词器可视化

### Qwen-3-VL-2B-Instruct 词表分析

- [vocab_decode_all.json](./assets/vocab_decode_all.json) - 完整词表解码
- [vocab_decode_chinese.json](./assets/vocab_decode_chinese.json) - 中文标记
- [vocab_decode_non_chinese.json](./assets/vocab_decode_non_chinese.json) - 非中文标记

## 参考文献

- Radford, A., et al. (2019). [Language Models are Unsupervised Multitask Learners](https://d4mucfpksywv.cloudfront.net/better-language-models/language_models_are_unsupervised_multitask_learners.pdf). OpenAI.
- Karpathy, A. (2023). [Let's build the GPT Tokenizer](https://www.youtube.com/watch?v=zduSFxRajkE). YouTube.
- OpenAI. [tiktoken/_educational.py](https://github.com/openai/tiktoken/blob/main/tiktoken/_educational.py). GitHub.
- [Tiktokenizer](https://tiktokenizer.vercel.app/) - 交互式分词可视化工具。
- Neural Machine Translation of Rare Words with Subword Units