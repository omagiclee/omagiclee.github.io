+++
date = '2026-02-09T13:24:24+08:00'
draft = false
title = 'VAD'
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

## TL;DR

<span style="color:red;"></span>

## Motivations & Innovations

## Approach


[图片]
Scene Representation
Map token: predict the vectorized representation of the map$$\hat{V}_{map} \in \R^{N_m \times (N_p \times 2 +C)}$$, where $$N_m$$, $$N_p$$ and $$C$$denote the number of predicted map vectors, the number of points contained in each map vector and the number of class  (including lane centerline, lane divider, road boundary, pedestrian crossing).
Agent token : predict agent information $$\hat{V}_{agent} \in \R^{N_a \times (N_k \times N_t \times 2 +N_k)}$$, where $$N_a$$, $$N_k$$and $$N_t$$denote the number of predicted agents, the number of modalities (driving intention), and the number of future timestamps. (including location, orientation , size, speed, category, and multi-mode future trajectories). VAD outputs a probability score for each modality.
Traffic signal token : predict the states of traffic signal (traffic light and stop sign)
1. Navigation infromation : encoder with an MLP
2. Ego status : encoder with an MLP
Planning via Interaction
Ego-Agent Interaction
 $$Q'_{\text{ego}}$$
[图片]
Ego-Map Interaction
$$Q''_{\text{ego}}$$
[图片]
[图片]
Planning Head (MLP)
$$\hat{V}_{\text{ego}} \in {\R}^{N_c \times N_k \times N_t \times 2}$$, where $$N_c$$denote the number of high-level command (turn left, turn right, go straight)
[图片]
End-to-End Learning
[图片]
Map Loss
- Focal loss: classification loss
- Manhattan distance: regression loss between the predicted map points and the ground truth map points.
Agent Loss
- Detection
  - L1 loss: regression loss
  - Focal loss: classification loss
- Motion
  Use the trajectory which has the minimum final displacement error (minFDE) as a representative prediction.
  - L1 loss: motion regression loss between the representative trajectory and the ground truth trajectory
  - Focal loss: multi-modal motion classification loss
Constraint Loss
[图片]
Ego-agent Collision Constraint
1. Agent selection: filter out low-confidence agent predictions by a threshold
2. Multi-modality motion selection: select the trajectory with the highest confidence score as the final prediction
[图片]
Ego-Boundary over-stepping Constraint
Ego-Lane Directional Constraint
Imitation Learning Loss (L1 loss)
VAD adopt an L1 loss between the predicted ego trajectory and the ground truth ego trajectory, aiming at guiding the planning trajectory with expert driving behavior.
[图片]

### Model

### Training Recipe

### Data Recipe

## Experiments


