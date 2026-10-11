+++
date = '2026-04-02T15:27:20+08:00'
draft = false
title = 'Gen-1: Scaling Embodied Foundation Models to Mastery'
categories = []
tags = []
featured = false
+++

:(fas fa-award fa-fw):<span style="color:gray"></span>
:(fas fa-building fa-fw):<span style="color:gray">Generalist AI</span>
:(fas fa-file-pdf fa-fw):[arXiv ]()
:(fab fa-github fa-fw):[]()
<img src="https://huggingface.co/front/assets/huggingface_logo-noborder.svg" alt="Hugging Face" style="height: 0.9em; vertical-align: -0.15em; margin-right: 2px;">[]()
:(fas fa-globe fa-fw):[]()
:(fas fa-blog fa-fw):[Scaling the Pretraining Era of Embodied Intelligence](https://generalistai.com/blog/apr-02-2026-GEN-1#scaling-the-pretraining-era-of-embodied-intelligence)

## TL;DR

<span style="color:red;"></span>

mastery of simple physical tasks.
- reliability: improve average success rates to **99%** on tasks where previous models achieve **64%**
- speed:complete tasks roughly **3x faster** than state of the art
- improvisation: exhibits a broad range of emergent behaviors to recover in unexpected scenarios, while only requires only **1 hour of robot data** for each of these results


Five months ago, with GEN-0, we showed for the first time that scaling laws1 exist in robotics–bringing physical AI models into the pretraining era, which has analogously underpinned predictable progress in language models.2 GEN-0 was made possible by a new multimodal architecture trained on our own (world’s largest) robotics pretraining dataset, and it demonstrated the ability to quickly learn new tasks, adapt to new environments,3 and display moments of physical commonsense.4

GEN-1 follows our own full redesign of embodied foundation models built for the real world, and is trained from scratch on our dataset of now half a million hours of real-world data.


Previously, with GEN-0, we showed for the first time that scaling laws exist in robotics

- scaling of data
- scaling of compute
- algorithmic advance

Previous general models in robotics that surpass 90% success have depended on enormous teleoperation datasets that are expensive and difficult to scale.

Instead, for GEN-0 and GEN-1 the base foundation model is trained without any robot data—it instead uses data from low-cost wearable devices on humans doing millions of activities, and provides an existence proof that this pretraining can lead to high levels of mastery without requiring large teleoperation or simulation datasets.

It is not only about what the robot must do, but also (perhaps, more importantly) what it should not do. Hence, emergent behaviors can be a strength (e.g. recovery behaviors not explicitly trained for), but also at times a liability. 


