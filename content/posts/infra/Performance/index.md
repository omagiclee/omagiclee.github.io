+++
date = '2025-05-27T16:15:09+08:00'
draft = false
title = 'Performance Profile'
categories = ['Infra']
tags = ['Infra', 'PCIe']
+++

## 确认PCIe 型号/通道数量/带宽
| PCIe 版本 | 发布时间 | 传输速率 | 编码方式 | 单通道带宽 | x16 带宽 |
|:---------|:--------|:--------|:--------|:----------|:---------|
| PCIe 1.0 | 2003年 | 2.5 GT/s | 8b/10b | 250 MB/s | 4 GB/s |
| PCIe 2.0 | 2007年 | 5.0 GT/s | 8b/10b | 500 MB/s | 8 GB/s |
| PCIe 3.0 | 2010年 | 8.0 GT/s | 128b/130b | 984.6 MB/s | 15.75 GB/s |
| PCIe 4.0 | 2017年 | 16.0 GT/s | 128b/130b | 1.969 GB/s | 31.5 GB/s |
| PCIe 5.0 | 2019年 | 32.0 GT/s | 128b/130b | 3.938 GB/s | 63 GB/s |
| PCIe 6.0 | 2022年 | 64.0 GT/s | PAM4 | 7.877 GB/s | 126 GB/s |

- GT/s (Giga Transfers per second) 表示每秒传输次数
- 实际带宽需要考虑编码开销

## 4090 vs L40S vs A100 PCIe 规格对比
| 显卡型号 | PCIe 版本 | 通道数 | 理论带宽 | 实际带宽 |
|:--------|:---------|:------|:--------|:--------|
| RTX 4090 | PCIe 4.0 | x16 | 64 GB/s | 63 GB/s |
| L40S | PCIe 4.0 | x16 | 64 GB/s | 63 GB/s |
| A100 | PCIe 4.0 | x16 | 64 GB/s | 63 GB/s |

- 所有三款显卡都支持 PCIe 4.0 x16，理论带宽相同
- 实际使用中，带宽利用率受以下因素影响：
   - 主板 PCIe 插槽版本
   - CPU 支持的 PCIe 版本
   - 系统总线带宽
   - 其他 PCIe 设备占用

## 查看实际 PCIe 配置：
```bash
# 查看 PCIe 链路状态
nvidia-smi -q | grep -A 10 "PCI"
# 或使用
lspci -vv | grep -i "LnkSta"
```



```shell
# nvidia-smi: NVIDIA 显卡管理和监控工具，显示 GPU 状态信息
# -q: Query, 详细显示 NVIDIA GPU 的所有状态和配置信息
# grep -A 10 "PCI": 查找包含"PCI"关键字的行，并显示该行及其后面10行内容
nvidia-smi -q | grep -A 10 "PCI"
```


```shell
watch -n 0.5 nvidia-smi dmon -s puctmvb
nvtop
NVIDIA Nsight Systems
```



nvidia-smi

num_workers，通常设置为 CPU核心数的2-4倍
pin_memory, True, 数据加载到 CPU 的锁页内存中，从而使后续 CPU->GPU 的数据传输更快
torchvision.transforms.v2 / NVIDIA DALI
io 瓶颈

PyTorch Profiler
NVIDIA Nsight Systems
NVIDIA Nsight Compute：深入分析和优化单个 CUDA Kernel 工具

加速数据加载，数据格式转为 TFRecord/HDF5减小小文件 IO
使用OpenCV/TurboJPEG替代 Pillow 解码图像
混精度训练
算子优化：
torch.compile 编译模型，生成静态图加速
替换低效算子
显存带宽优化

通信瓶颈：
DDP 替代DP
A100/H100启用 NVLink

扩展优化：
DeepSpeed：
FSDP：适合超大模型
