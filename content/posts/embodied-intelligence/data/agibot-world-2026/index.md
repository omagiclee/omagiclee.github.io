+++
date = '2026-04-05T13:46:44+08:00'
draft = false
title = 'agibot-world-2026'
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

https://agibot-world.cn/

100%真实环境，涵盖了商业空间、家居等多类通用场景

多视角 RGB(D) + 触觉 + 力觉 + LiDAR + IMU + 关节状态

高层指令、段落文本标注（任务描述）与步骤文本标注（操作序列分解）构建任务逻辑框架，并进一步进行细粒度拆解，标注原子技能（如抓取、放置）、2D边界框等，同时特别纳入错误恢复过程的轨迹记录。

https://huggingface.co/collections/unitreerobotics/unifolm-wbt-dataset
https://huggingface.co/datasets/agibot-world/AgiBotWorld2026

<div style="display: flex; justify-content: center; align-items: center;">
  <img src="./images/index-20260407135625.webp" style="width:50%;" />
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
<div class="robot-name"><a href="https://www.agibot.com.cn/products/G2" rel="noopener noreferrer" target="_blank">精灵 G2</a></div>
<div class="robot-desc">工业级轮式人形双臂机器人，100% 车规级零部件</div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">最大高度</span><span class="val">1795 mm（可调）</span></div>
<div class="row"><span class="lbl">重量</span><span class="val">185 kg（含电池）</span></div>
<div class="row"><span class="lbl">全身自由度</span><span class="val">26</span></div>
<div class="row"><span class="lbl">最大速度</span><span class="val">1.5 m/s</span></div>
<div class="row"><span class="lbl">防护等级</span><span class="val">IP42</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">构型</span><span class="val">十字腕力控臂 × 2</span></div>
<div class="row"><span class="lbl">单臂自由度</span><span class="val">7 DoF</span></div>
<div class="row"><span class="lbl">负载</span><span class="val">5 kg / 臂</span></div>
<div class="row"><span class="lbl">操作精度</span><span class="val">亚毫米级</span></div>
<div class="row"><span class="lbl">力感知</span><span class="val">全臂关节扭矩传感</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">灵巧手</span><span class="val">19-DoF（选配）</span></div>
<div class="row"><span class="lbl">触觉</span><span class="val">3D 指尖触觉</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">腰部</span><span class="val">3-DoF（旋转 / 俯仰 / 侧摆）</span></div>
<div class="row"><span class="lbl">颈部</span><span class="val">3-DoF（抬头 / 转头 / 歪头）</span></div>
<div class="row"><span class="lbl">腿部</span><span class="val">2 DoF</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">类型</span><span class="val">全向底盘</span></div>
<div class="row"><span class="lbl">舵轮</span><span class="val">4 舵轮</span></div>
<div class="row"><span class="lbl">自由度</span><span class="val">4 DoF</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">head</span><span class="val">RGB-D × 1 + stereo × 1</span></div>
<div class="row"><span class="lbl">wrist</span><span class="val">RGB-D × 2</span></div>
<div class="row"><span class="lbl">鱼眼</span><span class="val">× 3（含头部后方 × 1）</span></div>
<div class="row"><span class="lbl">LiDAR</span><span class="val">底盘前后 × 2</span></div>
<div class="row"><span class="lbl">超声波</span><span class="val">底盘 × 8</span></div>
</div>
</td>
<td>
<div class="spec-t-v">
<div class="row"><span class="lbl">芯片</span><span class="val">NVIDIA Jetson Thor T5000</span></div>
<div class="row"><span class="lbl">算力</span><span class="val">2070 TFLOPS (FP4)</span></div>
<div class="row"><span class="lbl">延迟</span><span class="val">&lt; 10 ms</span></div>
</div>
</td>
</tr>
</tbody>
</table>
</div>

<div class="spec-t-block">
<p class="spec-t-cap">Table 1. AgiBot World dataset scale. (100 台同构机器人采集, 5 大场景)</p>
<div class="spec-t">
<table>
<thead>
<tr>
<th style="text-align:center">trajectories</th>
<th style="text-align:center">task types</th>
<th style="text-align:center">scenes (real-world)</th>
<th style="text-align:center">unique objects</th>
<th style="text-align:center">skills</th>
</tr>
</thead>
<tbody>
<tr>
<td style="text-align:center"><div class="spec-t-v">1,000,000+</div></td>
<td style="text-align:center"><div class="spec-t-v">217</div></td>
<td style="text-align:center"><div class="spec-t-v">100+</div></td>
<td style="text-align:center"><div class="spec-t-v">3,000+</div></td>
<td style="text-align:center"><div class="spec-t-v">87 atomic skills<br><span style="font-size:.72rem;color:#64748b">家居 · 餐饮 · 工业 · 商超 · 办公</span></div></td>
</tr>
</tbody>
</table>
</div>
</div>

