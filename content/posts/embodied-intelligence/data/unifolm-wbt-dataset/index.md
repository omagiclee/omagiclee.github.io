+++
date = '2026-04-05T14:30:09+08:00'
draft = false
title = 'unifolm-wbt-dataset'
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

2026-03-05 开源，人形机器人

https://huggingface.co/collections/unitreerobotics/unifolm-wbt-dataset


<div style="display: flex; justify-content: center; align-items: center;">
  <img src="./images/index-20260407143220.webp" style="width:50%;" />
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
<th>腿部参数</th>
<th>传感器</th>
<th>算力参数</th>
</tr>
</thead>
<tbody>
<tr>
<td style="min-width:9rem;max-width:10.5rem">
<div class="spec-t-v">
<div class="robot-name"><a href="https://www.unitree.com/g1" rel="noopener noreferrer" target="_blank">Unitree G1 EDU</a></div>
<div class="robot-desc">小型双足人形双臂机器人，模仿 / 强化学习驱动</div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">站立尺寸</span><span class="val">1320 × 450 × 200 mm</span></div>
<div class="row"><span class="lbl">折叠尺寸</span><span class="val">690 × 450 × 300 mm</span></div>
<div class="row"><span class="lbl">重量</span><span class="val">~35 kg+（含电池）</span></div>
<div class="row"><span class="lbl">全身自由度</span><span class="val">23–43（可配置）</span></div>
<div class="row"><span class="lbl">移动速度</span><span class="val">2 m/s</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">单臂自由度</span><span class="val">7 DoF</span></div>
<div class="row"><span class="lbl">shoulder</span><span class="val">3 DoF</span></div>
<div class="row"><span class="lbl">elbow</span><span class="val">2 DoF</span></div>
<div class="row"><span class="lbl">wrist</span><span class="val">2 DoF（选配）</span></div>
<div class="row"><span class="lbl">臂展</span><span class="val">~0.45 m</span></div>
<div class="row"><span class="lbl">负载</span><span class="val">~3 kg</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">灵巧手</span><span class="val">Dex3-1 力控三指（选配）</span></div>
<div class="row"><span class="lbl">单手自由度</span><span class="val">7 DoF</span></div>
<div class="row"><span class="lbl">拇指</span><span class="val">3 DoF</span></div>
<div class="row"><span class="lbl">食指 / 中指</span><span class="val">各 2 DoF</span></div>
<div class="row"><span class="lbl">触觉</span><span class="val">触觉传感阵列（选配）</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">腰部</span><span class="val">1 DoF（Z ±155°）</span></div>
<div class="row"><span class="lbl">选配扩展</span><span class="val">+2 DoF（X ±45° / Y ±30°）</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">单腿自由度</span><span class="val">6 DoF</span></div>
<div class="row"><span class="lbl">hip</span><span class="val">3 DoF（P ±154° / R −30°~+170° / Y ±158°）</span></div>
<div class="row"><span class="lbl">knee</span><span class="val">1 DoF（0–165°）</span></div>
<div class="row"><span class="lbl">ankle</span><span class="val">2 DoF</span></div>
<div class="row"><span class="lbl">腿长</span><span class="val">0.6 m（小腿 + 大腿）</span></div>
<div class="row"><span class="lbl">膝关节扭矩</span><span class="val">120 N·m</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">head RGB-D</span><span class="val">Intel RealSense D435i</span></div>
<div class="row"><span class="lbl">head 3D LiDAR</span><span class="val">Livox Mid-360</span></div>
<div class="row"><span class="lbl">音频</span><span class="val">4-mic 阵列 + 5W 扬声器</span></div>
<div class="row"><span class="lbl">关节</span><span class="val">双编码器</span></div>
<div class="row"><span class="lbl">连接</span><span class="val">Wi-Fi 6 / Bluetooth 5.2</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">高算力模块</span><span class="val">NVIDIA Jetson Orin</span></div>
<div class="row"><span class="lbl">基础算力</span><span class="val">8 核高性能 CPU</span></div>
<div class="row"><span class="lbl">电池</span><span class="val">9000 mAh 快拆锂电（54V）</span></div>
<div class="row"><span class="lbl">续航</span><span class="val">~2 h</span></div>
</div>
</td>
</tr>
</tbody>
</table>
</div>

衣物处理：

G1_WBT_Inspire_Collect_Clothes：收集衣物。

G1_WBT_Inspire_Put_Clothes_into_Washing_Machine：将衣服放入洗衣机。

物品搬运与收纳：

G1_WBT_Inspire_Pickup_Pillow：捡起枕头。

G1_WBT_Inspire_Put_Kettle_on_Induction_Cooker：将水壶放到电磁炉上。

G1_WBT_Inspire_Stack_Blocks：堆叠方块（精细操作）。

清洁与日常：

涵盖了清理台面、收纳杂物等多种开放场景任务。


23~43 joint motors