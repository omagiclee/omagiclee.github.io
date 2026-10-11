+++
date = '2026-04-01T00:00:00+08:00'
draft = false
title = 'LingBot-VLA'
categories = []
tags = []
featured = false
+++

## TL;DR

## Model Architecture

![](./images/index-20260401140748.webp)

## Data Recipe

### Data Collection

![](./images/index-20260401141358.webp)

1. **teleoperated data** collected from **9 popular dual-arm robot embodiments** with **grippers as end-effectors.**

### Data Filtering
#### Automated Filtering
static frames at the start and end of the videos are eliminated at this stage.

#### Manual Review

### Data Labeling

<div style="display: flex; align-items: flex-start; gap: 24px;">
  <div style="flex: 0 0 32%;">
    <img src="./images/index-20260413141722.webp" alt="Automatic and human-refined annotation of dual-arm robot videos" style="width:100%;">
  </div>
  <div style="flex: 1;">
    <img src="./images/index-20260401141717.webp" alt="Word clouds comparing atomic actions in pretraining and benchmark data" style="width:100%; margin-bottom: 16px;">
    <ul>
    <li><b>Video Segment</b>: <b>Decomposed into clips by human annotators</b> according to <b>predefined atomic actions</b>.</li>
    <li><b>Instruction Annotation</b>: Employ <b>Qwen3-VL-235B-A22B</b> for precise annotation of <b>task and sub-task instructions</b>.</li>
    </ul>
  </div>
</div>

## Training Recipe

## Deployment

## Experiments
