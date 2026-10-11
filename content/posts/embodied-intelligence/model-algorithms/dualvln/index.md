+++
date = '2026-04-16T11:45:18+08:00'
draft = false
title = 'Dualvln'
categories = []
tags = []
featured = false
+++

:(fas fa-award fa-fw):<span style="color:gray"></span>
:(fas fa-building fa-fw):<span style="color:gray"></span>
:(fas fa-file-pdf fa-fw):[arXiv ]()
:(fab fa-github fa-fw):[]()
<img src="https://huggingface.co/front/assets/huggingface_logo-noborder.svg" alt="Hugging Face" style="height: 0.9em; vertical-align: -0.15em; margin-right: 2px;">[]()
:(fas fa-globe fa-fw):[]()
:(fas fa-blog fa-fw):[]()


1. vision-language navigation with discrete action space (VLN-CE)
2. visual navigation (VN) given point/image/trajectory goals
3. the whole VLN system with continuous trajectory outputs.

system-2 : qwen-vl-2.5

output:
- self-directed view adjustments
- pixel-goal grounding
- STOP actions

## System-2: Co-Training Data
- Vision-Language Action Data: using the Habitat simulator across multiple public VLN datasets.
    - 450K video clips from 60 Matterport3D (MP3D) environments, sourced from R2R, R2R-EnvDrop and RxR.
    - 300K samples from a subset of ScaleVLN, spanning 700 Habitat Matterport3D (HM3D) scenes. -> to further improve generalization through increased scene diversity,
    - 240K DAgger-collected samples

- General Vision-Language Data -> to retain the general reasoning capabilities of the pretrained Video-LLM.
    - 248K video-based visual question-answering (VQA) samples sourced from publicly available datasets LLaVA-Video-178K and ScanQA.
    - 230K interleaved image-text samples from MMC4 -> augment multi-turn vision-language interactions.

## System-1: Trajectory Data
from System-2, max 10% 饱和

## NM 改造
1. System-2 (VLM): Instruction-following 增强Navigation-following
2. System-1 (action expert):
