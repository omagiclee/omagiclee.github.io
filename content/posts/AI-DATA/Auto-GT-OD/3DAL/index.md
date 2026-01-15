+++
date = '2021-03-08T11:38:25+08:00'
draft = false
title = '3DAL: Offboard 3D Object Detection from Point Cloud Sequences'
categories = ['Auto-GT']
tags = ['Auto-GT', 'Auto-GT-OD']
+++

:(fas fa-award fa-fw):<span style="color:gray"></span>
:(fas fa-building fa-fw):<span style="color:gray">Waymo LLC</span>
:(fas fa-file-pdf fa-fw):[arXiv 2103.13612](https://arxiv.org/abs/2103.13612)

## TL;DR

<span style="color:red;"></span>

## Motivations & Innovations

## Approach

![](./images/index-20260225114033.webp)

### Multi-frame 3D Object Detection

### Multi-object Tracking

tracking-by-detection: using detector boxes for associations and Kalman filter for state updates.

### Object Track Data Extraction

### Object-centric Auto Labeling
#### Divide and conquer: motion state estimation

A linear classifier using a few heuristic features from the object track’s boxes can already achieve 99%+ motion state classification accuracy for vehicles.

#### Static object auto labeling

![](./images/index-20260225115254.webp)

#### Dynamic object auto labeling

![](./images/index-20260225115612.webp)







