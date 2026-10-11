+++
date = '2026-04-21T13:33:45+08:00'
draft = false
title = '京东具身数据'
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


【26.04.16京东具身智能生态发布会，发布具身大模型JoyAI-RA、具身智能交易平台】https://www.bilibili.com/video/BV1H8dYBTEax?vd_source=e05fafaa995c59e16affc059ba418214


https://robotdata.jdcloud.com/


## [JoyEgoCam](https://robotdata.jdcloud.com/data-collection)

![](./images/index-20260421133913.webp)

![](./images/index-20260421133935.webp)

- FOV：130°（垂直、水平）
- 重量：220g。

高清双目，高精度自研立体校正算法，重投影误差小于0.2pixel
车规级imu

60hz

超宽瞳距


Isaac Sim 

- 家庭服务：通过京东家政覆盖整理、收纳、桌面作业等家庭服务场景。
- 物流仓储：基于京东物流一体化供应链物流服务网络，聚焦分拣、上架、打包等场景。
- 健康医疗：京东旗下京东大药房等门店，采集真实作业场景数据，支撑具身智能感知、抓取与巡检训练。

## [具身智能数据交易平台](https://robotdata.jdcloud.com/market)

![](./images/index-20260421135253.webp)

手物检测、手势识别、深度重建、手物分割、子任务分段及Caption

![](./images/index-20260421153012.webp)

![](./images/index-20260421153111.webp)

![](./images/index-20260421153306.webp)

![](./images/index-20260421153452.webp)

![](./images/index-20260421153605.webp)

![](./images/index-20260421153722.webp)

![](./images/index-20260421153956.webp)

![](./images/index-20260421154039.webp)

![](./images/index-20260421154152.webp)

![](./images/index-20260421154826.webp)

![](./images/index-20260421155240.webp)

![](./images/index-20260421155454.webp)

![](./images/index-20260421155539.webp)

![](./images/index-20260421155722.webp)

![](./images/index-20260421155857.webp)

![](./images/index-20260421155946.webp)

![](./images/index-20260421162436.webp)

![](./images/index-20260421162522.webp)

![](./images/index-20260421162630.webp)

![](./images/index-20260421162730.webp)

![](./images/index-20260421163026.webp)

![](./images/index-20260421163249.webp)

![](./images/index-20260421163437.webp)

![](./images/index-20260421163544.webp)

![](./images/index-20260421163630.webp)

![](./images/index-20260421163751.webp)

![](./images/index-20260421163849.webp)

![](./images/index-20260421164026.webp)

![](./images/index-20260421164139.webp)

![](./images/index-20260421164458.webp)

![](./images/index-20260421164831.webp)

![](./images/index-20260421164925.webp)

![](./images/index-20260421165030.webp)

![](./images/index-20260421165055.webp)

![](./images/index-20260421165122.webp)

![](./images/index-20260421165432.webp)


生数科技，清华大学朱军，通用世界模型思考

![](./images/index-20260421172007.webp)

![](./images/index-20260421172944.webp)


众擎机器人：egocentric：数据金字塔的底层，基础认知，没有轨迹，能否生成轨迹数据值得思考。
自变量：同意上面ego centric 数据金字塔底层，有一些limitation，没有动作轨迹，动作视觉时空一致性
真机数据还是最优价值的，能得到模型反馈。
优必选：egocentric data和本体无关
京东：核心问题是 scaling up 问题，跨本体问题

数据质量，标准化，以及落地合作模式
数据质量：采集维度，数据定义，过程中把控，采集设备硬件精度，比如防抖动稳定性，设备畸变算法，精度，深度等；数据处理

模型和软件协同还有哪些优化空间？
众擎机器人：模型基本结构没有收敛，收敛在两个大方向，vla, world model，如果模型没有收敛，那数据也不会收敛；硬件本体从灵巧手还是有很大缺陷的，和人有差距；离具身智能chatgpt还有差距。
自变量：chatgpt moment不在今年，可能明后年；今天更多在数据，模型规模，落地应用；如何评估，zero-shot，长程任务。现在在简单任务上已经有了zero-shot能力；模型决定上限，硬件决定下限。
优必选：和自变量理解不太一样，而是在某个场景的多任务，或者一个任务的多场景的应用有chatgpt moment能力就行。99.99%的成功率+纠错能力就可以了。有了这个，就可以有更多的投资，更多的参与者。
京东：seed dance 2.0 在多模态能力上提升很多。数据的scaling up 模型如何follow是个问题。

top3 核心场景：
京东：机器人进家庭才能规模化，才能带动产业；落地最快的轻应用（娱乐表演，标准化的（安防，巡检，危险作业等场景限定）。
优必选：高质标准化 -> 家庭场景（情绪价值->干活）
自变量：能干活的，top1 家庭是最大的；泛家庭很重要，酒店，养老，商场等泛服务的；工业服务，工业物流，近期准备落地；
众擎机器人：作业智能，最高的能力。首先落地的情绪价值，巡检，导览，最容易实现的；带了作业智能，成功率，泛化能力，节拍三个问题，典型是在工业场景；最后是家庭最难，对机器人要求很高，安全性和泛化性要求最高。

生态：
众擎机器人：人形机器人格斗，如何商业化落地，如何根据ip商业化布局？ -> 面向全球开发者；产品层面推向世界；从本体迭代硬件稳定性，小脑的运动控制生态是个促进，大脑肯定会有数据回流迭代对动作认知的大脑。
自变量：布局家庭场景，有哪些难点，落地节奏什么规划？-> 联合58进家庭的服务，约的消费者很多。第一是提升产能，预订机器人进家庭的服务；主要问题：执行效率太低，比保洁阿姨要低很多；硬件方面：真正去干活的时候会发现很多硬件问题，比如操作空间不可以，小户型家庭进不去。既要够得着柜子，又要去洗手间，又要去茶几。还有不能是大的底盘。还有安全性，和用户保证，打破包赔。
优必选：数据标准如何联合行业体系共建？
