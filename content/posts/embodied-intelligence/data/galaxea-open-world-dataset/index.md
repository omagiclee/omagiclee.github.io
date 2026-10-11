+++
date = '2026-04-05T11:44:23+08:00'
draft = false
title = 'galaxea-open-world-dataset'
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


https://huggingface.co/datasets/OpenGalaxea/Galaxea-Open-World-Dataset

500+ hours of real-world mobile manipulation data.
All data collected using one uniform robotic embodiment for consistency.
Fine-grained subtask language annotations.
Covers residential, kitchen, retail, and office settings.
Dataset in RLDS and LeRobot format.


<div style="display: flex; justify-content: center; align-items: center;">
  <img src="./images/index-20260407115136.webp" style="width:30%;" />
</div>

<style>
.spec-t{margin:1.5rem 0;overflow-x:auto;-webkit-overflow-scrolling:touch}
.spec-t table{width:100%;min-width:0;border-collapse:collapse;font-size:.81rem;line-height:1.5;table-layout:auto}
.spec-t th{padding:.6rem .75rem;text-align:left;vertical-align:middle!important;font-weight:600;font-size:.72rem;letter-spacing:.04em;border-bottom:2px solid #334155;color:#334155;white-space:nowrap}
.spec-t-block{margin:1.5rem 0}
.spec-t-block .spec-t{margin:0}
.spec-t-cap{margin:0 0 .65rem;padding:0 .75rem;text-align:center;font-size:.78rem;font-weight:600;line-height:1.5;color:#334155}
body[theme=dark] .spec-t-cap{color:#cbd5e1}
.spec-t td{padding:.7rem .75rem;vertical-align:middle!important;border-bottom:1px solid #e2e8f0}
.spec-t .spec-t-v{display:inline-flex;flex-direction:column;justify-content:center;align-items:flex-start;width:100%;box-sizing:border-box;vertical-align:middle}
.spec-t-block .spec-t .spec-t-v{align-items:center;text-align:center}
.spec-t tr:last-child td{border-bottom:none}
.spec-t .row{display:flex;align-items:baseline;gap:.4rem;margin-bottom:.18rem}
.spec-t .row:last-child{margin-bottom:0}
.spec-t .lbl{color:#64748b;font-size:.71rem;white-space:nowrap;flex-shrink:0}
.spec-t .val{color:#1e293b;white-space:nowrap}
.spec-t .val.is-wrap{white-space:normal}
.spec-t .robot-name{font-size:.88rem;font-weight:700;color:#0f172a;margin-bottom:.3rem;white-space:nowrap}
.spec-t .robot-name a{color:inherit;text-decoration:none;border-bottom:1px solid rgba(15,23,42,.25)}
.spec-t .robot-name a:hover{border-bottom-color:#0f172a}
body[theme=dark] .spec-t .robot-name a{border-bottom-color:rgba(241,245,249,.35)}
body[theme=dark] .spec-t .robot-name a:hover{border-bottom-color:#f1f5f9}
.spec-t .robot-desc{font-size:.76rem;color:#475569;line-height:1.45}
body[theme=dark] .spec-t th{color:#cbd5e1;border-bottom-color:#475569}
body[theme=dark] .spec-t td{border-bottom-color:#334155}
body[theme=dark] .spec-t .lbl{color:#94a3b8}
body[theme=dark] .spec-t .val{color:#e2e8f0}
body[theme=dark] .spec-t .robot-name{color:#f1f5f9}
body[theme=dark] .spec-t .robot-desc{color:#94a3b8}
</style>

<div class="spec-t">
<table>
<thead>
<tr>
<th>机器人本体</th>
<th>全身参数</th>
<th>手臂</th>
<th>末端执行器</th>
<th>躯干参数</th>
<th>底盘参数</th>
<th>传感器</th>
<th>算力参数</th>
</tr>
</thead>
<tbody>
<tr>
<td style="min-width:9rem;max-width:10.5rem">
<div class="spec-t-v">
<div class="robot-name"><a href="https://galaxea-ai.com/cn/products/R1-Lite" rel="noopener noreferrer" target="_blank">Galaxea R1 Lite</a></div>
<div class="robot-desc">全向轮式移动双臂机器人，躯干可升降</div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">总高</span><span class="val">1280 mm</span></div>
<div class="row"><span class="lbl">底盘宽</span><span class="val">600 mm</span></div>
<div class="row"><span class="lbl">平台宽</span><span class="val">670 mm</span></div>
<div class="row"><span class="lbl">全身自由度</span><span class="val">23</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">双臂</span><span class="val">6-DoF x2</span></div>
<div class="row"><span class="lbl">臂长</span><span class="val">600 mm</span></div>
<div class="row"><span class="lbl">负载</span><span class="val">额定 3 kg，最大 5 kg</span></div>
<div class="row"><span class="lbl">安装</span><span class="val">上装</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">类型</span><span class="val">平行夹爪</span></div>
<div class="row"><span class="lbl">腕部</span><span class="val">球形腕</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">自由度</span><span class="val">3</span></div>
<div class="row"><span class="lbl">工作空间</span><span class="val">0–1.7 m</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">自由度</span><span class="val">6</span></div>
<div class="row"><span class="lbl">移动速度</span><span class="val">1.5 m/s</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">head</span><span class="val">stereo RGB ×1</span></div>
<div class="row"><span class="lbl">wrist</span><span class="val">RGB-D ×2（选配）</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">CPU</span><span class="val">i9-12900HK，14 核，2.5 GHz</span></div>
<div class="row"><span class="lbl">内存</span><span class="val">32 GB RAM</span></div>
<div class="row"><span class="lbl">存储</span><span class="val">1 TB SSD</span></div>
</div>
</td>
</tr>
</tbody>
</table>
</div>

<div class="spec-t-block">
<p class="spec-t-cap">Table 1. Galaxea Open-World dataset scale. (identical embodiment, isomorphic teleoperation)</p>
<div class="spec-t">
<table>
<thead>
<tr>
<th style="text-align:center">trajectories</th>
<th style="text-align:center">task categories</th>
<th style="text-align:center">scenes (real-world)</th>
<th style="text-align:center">unique objects</th>
<th style="text-align:center">skills</th>
</tr>
</thead>
<tbody>
<tr>
<td style="text-align:center"><div class="spec-t-v">~100K</div></td>
<td style="text-align:center"><div class="spec-t-v">150</div></td>
<td style="text-align:center"><div class="spec-t-v">50</div></td>
<td style="text-align:center"><div class="spec-t-v">1600+</div></td>
<td style="text-align:center"><div class="spec-t-v">58 operational skills<br><span style="font-size:.72rem;color:#64748b">fine-grained pick-and-place → coordinated whole-body manipulation</span></div></td>
</tr>
</tbody>
</table>
</div>
</div>

![](./images/index-20260407133828.webp)

![](./images/index-20260407134352.webp)