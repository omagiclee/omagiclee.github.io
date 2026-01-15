import os
import json
import re
from transformers import AutoTokenizer

# 设置路径
model_path = '/Users/omagiclee/.cache/modelscope/hub/models/Qwen/Qwen3-VL-2B-Instruct'

# 1. 加载 Tokenizer
tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)

# 2. 读取原始词表
vocab_path = os.path.join(model_path, "vocab.json")
with open(vocab_path, "r", encoding="utf-8") as f:
    vocab = json.load(f)

# 3. 初始化存储字典
decoded_all = {}
decoded_chinese = {}
decoded_non_chinese = {}

# 定义匹配中文的正则
# [\u4e00-\u9fa5] 是基本汉字区间，可以根据需要扩大
chinese_pattern = re.compile(r'[\u4e00-\u9fa5]')

# 4. 遍历并分类
for token_str, token_id in sorted(vocab.items(), key=lambda x: x[1]):
    try:
        native_content = tokenizer.decode([token_id])
    except:
        native_content = f"[ERROR: {token_str}]"

    # 存入全集
    decoded_all[token_id] = native_content

    # 分类存储
    if chinese_pattern.search(native_content):
        decoded_chinese[token_id] = native_content
    else:
        decoded_non_chinese[token_id] = native_content

# 5. 定义保存函数
def save_json(data, filename):
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"已保存: {filename} (条目数: {len(data)})")

# 执行保存
save_json(decoded_all, 'vocab_all.json')
save_json(decoded_chinese, 'vocab_chinese.json')
save_json(decoded_non_chinese, 'vocab_non_chinese.json')