+++
date = '2025-04-28T15:42:09+08:00'
draft = false
title = 'NVIDIA Container Toolkit'
+++

<div style="text-align: center;">
<table>
  <tr>
    <th>GPUs</th>
    <th>Compute Capability</th>
    <th>Architecture</th>
  </tr>
  <tr>
    <td>GeForce RTX 4090</td>
    <td>8.9</td>
    <td>Ada Lovelace</td>
  </tr>
  <tr>
    <td>GeForce RTX 5090</td>
    <td>12.0</td>
    <td>Blackwell</td>
  </tr>
  <tr>
    <td>L40/L40S</td>
    <td>8.9</td>
    <td>Ada Lovelace</td>
  </tr>
  <tr>
    <td>A800/A100</td>
    <td>8.0</td>
    <td>Ampere</td>
  </tr>
  <tr>
    <td>H800/H100/H200</td>
    <td>9.0</td>
    <td>Hopper</td>
  </tr>
  <tr>
    <td>B200/B300/GB200</td>
    <td>10.0</td>
    <td>Blackwell</td>
  </tr>
  <tr>
    <td>Jetson AGX Orin</td>
    <td>8.7</td>
    <td>Ampere</td>
  </tr>
  <tr>
    <td>Jetson AGX Thor</td>
    <td>?</td>
    <td>Blackwell</td>
  </tr>
</table>
</div>

https://docs.nvidia.com/deeplearning/cudnn/backend/latest/reference/support-matrix.html#cudnn-cuda-hardware-versions
- NVIDIA Drvier: >=570.26
- CUDA: 12.8 Update 1
- cuDNN: 9.8.0
- Distribution: Ubuntu 24.04.z (z <= 1) LTS
- TensorRT: 10.9
- TensorRT-LLM: 0.20.0rc0
- Python: 3.12
- PyTorch: 2.7.0

SM_100
SM_101
SM_120

# References
 - https://github.com/NVIDIA/nvidia-container-toolkit
 - https://developer.nvidia.com/cuda-toolkit-archive
 - [GPUs - Compute Capability 对照表](https://developer.nvidia.com/cuda-gpus)
 - https://pytorch.org/get-started/locally/
 - https://developer.nvidia.com/tensorrt
