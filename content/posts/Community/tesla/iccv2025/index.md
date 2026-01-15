+++
date = '2025-11-18T12:22:50+08:00'
draft = false
title = 'Building an Autonomous Future (ICCV 2025 WDFM-AD)'
organization = ['Tesla']
categories = []
tags = []
+++

Ashok Elluswamy, VP, Tesla

## Recently Achievements

- 2025.06, launch robotaxi service
- deliver the first self-driving production vehicle from the tesla factory in austin to customer's home in austin (20-30 minutes).
- in the us, the production vehicle delivers itself from the manufacturing line to the loding docks (a couple miles away).

## End-to-End Foundation Model at Scale

- Map raw sensor inputs directly to control signal (next steering and acceleration (two tokens) -> steering angle, throttle, brake)
- Runs at 36Hz
- Perception can be implicit and can be trained as auxiliary things

![1763442624131](images/1763442624131.webp)

## Why End-to-End?

![1763443008269](images/1763443008269.webp)

### Codifying human values is incredibly difficult

![1763443817575](images/1763443817575.webp)

### Interface between perception, prediction and planning is ill-defined

  ![1763444181379](images/1763444181379.webp)

## Challenges of End-to-End

### Curse of dimensionality

- Problem: scale mismatch between input and output
- Solution:
  - large data: Tesla fleet can provide 500 years of driving data every single day.
  - data engine

![1763444333478](images/1763444333478.webp)

![1763445111214](images/1763445111214.webp)

![1763445654521](images/1763445654521.webp)

### Interpretability, Safety Guarantees and Internal Supervision

#### Rich Intermediate Outputs: Perception, 3DGS, Language

- with prompts
- auxiliary but helpful

![1763445860960](images/1763445860960.webp)

![1763445936167](images/1763445936167.webp)

#### Efficient 3D Gaussian Splatting for System Debugging

![1763446126710](images/1763446126710.webp)

#### Real-Time and Reflective Modes in a Single Model （Dual-Mode）

- A fast path for low-lattency control, used in normal driving
- [optional] A reflective mode for introspection, where the model can emit reasoning tokens and natural language summaries of its decision logic when more time is available.

![1763446392802](images/1763446392802.webp)

### Evaluation (Hardest of All)

- Training loss and open-loop metrics can not indicate closed-loop performance.
- Safety-critical driving policy is multi-modal, and can not be judged by distance-to-ground-truth alone.

![1763448148809](images/1763448148809.webp)

#### Neural Network Closed-loop World Simulator

- closed-loop evaluation
- closed-loop reinforcement learning

![1763448562085](images/1763448562085.webp)

![1763448750146](images/1763448750146.webp)

![1763448900634](images/1763448900634.webp)

![1763449061821](images/1763449061821.webp)

![1763449148065](images/1763449148065.webp)

## What's Next

![1763449299812](images/1763449299812.webp)

![1763449836356](images/1763449836356.webp)

![1763449886240](images/1763449886240.webp)

![1763449923047](images/1763449923047.webp)

## References

- [The 2nd Workshop on Distillation of Foundation Models for Autonomous Driving (WDFM-AD)](https://wdfm-ad.github.io/iccv25/)
- [Medium](https://medium.com/@byaman019/a-peek-into-teslas-autonomous-future-core-tech-revealed-by-vp-ashok-elluswamy-at-iccv-2025-906df7ae95de)
- [Youtube](https://www.youtube.com/watch?v=IRu-cPkpiFk)
