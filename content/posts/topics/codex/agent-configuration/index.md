+++
date = '2026-10-02T00:00:00+08:00'
draft = false
title = 'Codex Agent 配置'
subtitle = 'Speed：处理速度与用量'
description = '凝练 Codex Speed 文档，对照 Standard、Fast 与 Ultrafast 的速度、额度消耗和计费倍率，并整理 Fast 配置与适用限制。'
summary = '一张表看清 Standard、Fast、Ultrafast 的速度与用量差异，附 Fast 开启方法和可用性说明。'
categories = ['Codex']
tags = ['Codex', 'Agent Configuration', 'Speed']
topic = true
contentLanguage = 'zh-CN'
isCJKLanguage = true
math = false
+++

本文先整理 Agent 配置中的 **Speed**：以更高用量换取更快处理。依据 [OpenAI 官方 Speed 文档](https://learn.chatgpt.com/docs/agent-configuration/speed)，核验日期为 **2026-10-02**。

<!--more-->

## Speed 速览

{{< codex-table label="Standard、Fast 与 Ultrafast 的速度及用量对照" >}}

| 模式 | 适用模型 | 速度表现 | 套餐内额度消耗 | 购买 credits / 企业按量计费 |
| :--- | :--- | :--- | :---: | :---: |
| **Standard** | 对应模型的标准档 | 基准 | **1×** | **1×** |
| **Fast** | GPT-6.1 Sol<br>GPT-6 Astra / Sol / Luna<br>GPT-5.6 / 5.5 | 支持的模型可加速；GPT-5.6 / 5.5 为 **1.5×** | **2.5×** | **2×** |
| **Ultrafast** | GPT-6 Astra | token 生成速度最高 **8×** | **8×** | **6×** |

{{< /codex-table >}}

表中倍率均相对同模型的 Standard。**消耗与计费倍率不能用作速度倍率；token 生成加速也不等于整个任务同比提速。** 企业费用依工作区协议执行。[来源](https://learn.chatgpt.com/docs/agent-configuration/speed)

## 开启 Fast

{{< codex-table label="Fast 模式的配置入口" compact="true" >}}

| 操作 | 配置入口 |
| :--- | :--- |
| CLI 切换 Fast | `/fast` |
| CLI 页脚显示状态 | `/statusline` |
| 保存默认设置 | 在 `config.toml` 中合并下方配置 |
| 使用客户端 | 以 ChatGPT 登录桌面应用、Codex CLI 或 IDE 扩展 |

{{< /codex-table >}}

```toml
service_tier = "fast"

[features]
fast_mode = true
```

已有 `[features]` 时，将 `fast_mode` 合并到该节，避免重复声明。[配置依据](https://learn.chatgpt.com/docs/agent-configuration/speed)

## 可用性与计费

- **Fast**：是否开放取决于套餐、客户端、工作区设置与发布进度；GPT-6.1 Sol 支持 Standard 与 Fast。
- **Ultrafast**：限 Pro $500 及符合条件的 Enterprise / Edu；Pro 先用套餐额度，再用可用 credits。Enterprise 默认关闭，需所有者开放权限；旧版限流制 Enterprise 不支持。要求推理驻留美国以外的工作区不支持。
- **共享用量**：ChatGPT Work 与 Codex 共用额度、credits 和限制。
- **API key**：按 API token 价格计费，上表的 ChatGPT 用量倍率不适用。[来源](https://learn.chatgpt.com/docs/agent-configuration/speed)

> **版本提醒**：GPT-5.5 将于 **2026-10-14** 从 ChatGPT、ChatGPT Work 与 Codex 退役；API 不受影响。[官方说明](https://learn.chatgpt.com/docs/agent-configuration/speed#retirement-and-migration)
