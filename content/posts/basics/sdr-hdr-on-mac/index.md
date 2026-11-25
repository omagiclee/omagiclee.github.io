+++
date = '2026-11-24T21:10:00+08:00'
draft = false
title = '从文件到屏幕：SDR、HDR，以及同一张图为什么在 Mac 上看起来不同'
description = '从 PQ、HLG、增益图到 macOS EDR，比较常见应用的显示路径，并用 HDR 截图、WebKit 逆向和缓冲区对照实验定位 Safari 27.2 的增益图色差。'
summary = '一张 HDR 照片能打开、能恢复高光、能还原颜色，是不同的事。本文用样片测试、应用逆向和单变量实验解释同一张图为何在 Safari 和预览里看起来不同。'
categories = ['影像画质']
tags = ['SDR', 'HDR', 'macOS', '色彩管理', 'PQ', 'HLG']
isCJKLanguage = true
contentLanguage = 'zh-CN'
+++

同一张夜景，同一块 Mac 屏幕：在「照片」里，车灯比网页白底亮得多；拖进浏览器，车灯和白底却差不多亮。也可能反过来，网页能播放一段 HDR 视频，QuickTime Player 却打不开那份文件。前者可能是显示路径不同，后者可能只是播放器不认容器。两件事不该都叫「不支持 HDR」。

判断 HDR，先问三次：**交付的文件有没有 HDR？应用有没有把 HDR 信号留到合成阶段？这块屏此刻有没有亮度余量？** 任意一步不成立，屏幕上就不一定有高于 SDR 白的高光。

> **2026 年 11 月 24 日 · 兼容性基线。** Chrome 用官方 **Chrome for Testing 158.0.8127.88**，对应当时的 Mac 稳定分支。WebKit 用 macOS 27.2 的系统 **WKWebView** 隔离验证解码，没有把它当作 Safari.app 的完整实测。照片、预览和 QuickTime 的行为以 Apple 文档为依据，另测了 ImageIO 和 AVFoundation。当时外接屏的 HDR 模式未开。 [Chrome 公告](https://chromereleases.googleblog.com/2026/11/stable-channel-update-for-desktop_01734282054.html) · [Safari 27.2](https://webkit.org/blog/18515/webkit-features-for-safari-27-2/)
>
> **2026 年 11 月 26 日 · 开启 HDR 后复测。** 用实际 **Safari 27.2** 和 **预览 11.0** 逐个前台显示，经系统 HDR HEIC 截图取样。两边都能保留这张合成样本的 4× 灰阶高光。复现的差异是 Safari 把增益图 JPEG 的彩色高光画得更淡。后续逆向和单变量实验把最有力的原因缩小到 **GPU 重建时，基图缓冲区没有携带源色彩空间**。见[第 6 节的逆向和实测](#safari-hdr-gain-map-gap)。

<!--more-->

## 1. SDR 和 HDR，到底差在哪里？

**SDR（Standard Dynamic Range）**和 **HDR（High Dynamic Range）**的核心差异，是在参考白固定的前提下，画面还能保留和呈现多大的明暗范围。想象一张阳光下的白纸：SDR 里白纸、云边和金属反光要共享较小的亮度空间；HDR 可以让白纸看起来仍像白纸，把额外亮度留给云边和反光。它不是把整张图一起调亮。

{{< codex-table compact="true" label="SDR 和 HDR 的区别" >}}
| 维度 | SDR | HDR |
| --- | --- | --- |
| 亮度 | 以 SDR 白为上限；传统参考监看常以约 100 nit 为白，不代表每台屏幕的实测亮度 | 保留高于参考白的高光；最终亮度取决于母版、映射和显示器 |
| 传递函数 | 网页图常见 sRGB；电视视频常见 BT.709 信号、BT.1886 参考显示 | 主要是 PQ、HLG；线性浮点亦用于制作和计算 |
| 色域与位深 | SDR 也可用 Display P3、BT.2020 或 10 bit | 常和宽色域、10/12 bit 一起交付，但这两项都不能单独证明 HDR |
{{< /codex-table >}}

**动态范围是能有多亮、多暗；色域是能显示哪些颜色；位深是两个数值之间能分多细。** 一个 16-bit SDR PNG 不会因为位深高就变成 HDR。手机相机的 HDR 多帧合成、RAW 里的曝光余量、经过色调映射的「HDR 风格」JPEG，也不等于交付文件能做 HDR 显示。参见 [ITU-R BT.2100](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.2100-3-202502-I%21%21PDF-E.pdf) 和 [BT.2408 制作实践](https://www.itu.int/dms_pub/itu-r/opb/rep/R-REP-BT.2408-9-2026-TOC-HTM-E.htm)。

## 2. HDR 有哪些种类？

### 视频：先分信号曲线，再分交付规格

{{< codex-table compact="true" label="常见 HDR 视频规格" >}}
| 规格 | 信号如何描述 | 典型场景 |
| --- | --- | --- |
| HDR10 | 10-bit PQ，通常用 BT.2020 信号容器；可带母版亮度/色度、MaxCLL、MaxFALL 等静态信息 | 影视、流媒体；常用作 HDR 回退版本 |
| HDR10+ | 在 HDR10 基础上加入随场景或帧变化的动态元数据 | 希望兼容 HDR10，同时让支持端逐场景调节映射 |
| Dolby Vision | 带动态元数据的一族规格；要看具体 Profile。8.1 有 HDR10 兼容基础层，8.4 有 HLG 兼容基础层；不能把所有 Profile 都当成可回退 | 影视流媒体、手机 HDR 视频 |
| HLG | 相对式亮度信号；显示端根据屏幕和观看条件解释，一般不依赖逐场景动态元数据 | 电视广播、直播、部分相机视频 |
{{< /codex-table >}}

**PQ**（SMPTE ST 2084）把码值对应到绝对亮度，数学范围到 10,000 nit，不代表片子做到了 10,000 nit，更不代表屏幕要达到这个值。**HLG**（Hybrid Log-Gamma）是相对式系统，显示要考虑目标屏幕及系统 gamma；旧 SDR 屏能否得到满意画面仍要看接收端和映射，不能把 HLG 改个标签当 SDR。

另外，HEVC、VP9、AV1 是**编码**，MP4、MOV、WebM 是**容器**，HLS 是**流媒体分发方式**。它们和 PQ／HLG 不在同一层。同样叫 MP4，可能是 SDR H.264，也可能是 HDR HEVC。Apple 还在 macOS 27 这一代为其 HLS 路径加入 Dolby Vision 8.1 支持；有基础层可播或服务有可播变体，不等于浏览器使用了动态元数据。参见 [Apple HDR 视频元数据](https://developer.apple.com/av-foundation/High-Dynamic-Range-Metadata-for-Apple-Devices.pdf)、[Apple HLS 规格](https://developer.apple.com/streaming/hls-authoring-specification-for-apple-devices.html) 和 [2026 HLS 更新](https://developer.apple.com/streaming/Whats-new-HLS.pdf)。

### 照片：直接编码 HDR，或用增益图兼顾两种屏幕

{{< codex-table compact="true" label="HDR 静态图的两种常见交付方式" >}}
| 方式 | 文件里有哪些数据 | 在 SDR 端发生什么 |
| --- | --- | --- |
| 直接 HDR（如 [ISO 22028-5](https://www.iso.org/standard/87778.html)） | 用 PQ／HLG 等直接编码 HDR，常见载体有 AVIF、HEIC、JPEG XL、带 cICP 的 PNG。OpenEXR 则常用在线性制作链路 | 如果能正确解码，通常由应用做 HDR 到 SDR 的色调映射；也可单独交付 SDR 版 |
| 增益图（如 [ISO 21496-1](https://www.iso.org/standard/86775.html)） | 常见方案是 SDR 基图 + Gain Map + 参数。支持的应用按当前余量重建高光；ISO 也允许以 HDR 为基图 | 当基图为 SDR，旧解码器可直接打开基图，不必猜一个 SDR 版本 |
{{< /codex-table >}}

Apple 的 **Adaptive HDR**、较早的 **Apple Gain Map**、Android 的 **Ultra HDR JPEG** 有亲缘关系，但不是同一个元数据封装。Ultra HDR JPEG 可同时写入自己的 Gain Map 元数据和 ISO 21496-1 元数据，兼顾不同解码器。只识别其中一套时，即使文件后缀仍是 `.jpg`，也可能只看到基图。网页图片服务若重编码时丢失附图、ICC 或 cICP 标签，也会改变结果。参见 [Apple Adaptive HDR](https://developer.apple.com/videos/play/wwdc2024/10177/) 和 [Android Ultra HDR 规格](https://developer.android.com/media/platform/hdr-image-format)。

## 3. 从文件到屏幕：哪一步把 HDR 变成了 SDR？

{{< mermaid >}}
flowchart TB
    accTitle: HDR 文件到 macOS 屏幕的显示链路
    accDescr: 应用先选择交付版本，再解码、恢复增益图或解释传递函数，然后合成并按系统显示余量输出 HDR，或者使用 SDR 版本及色调映射。
    A["交付<br/>原片、网页图或流媒体"]:::client
    B["解码<br/>读色彩标签、解码增益图"]:::service
    C["应用合成<br/>保留高光或限制到 SDR"]:::engine
    D["macOS / 显示器<br/>色彩空间与当前 EDR 余量"]:::service
    E["输出<br/>有余量就可能显示 HDR"]:::storage
    A --> B --> C --> D --> E
{{< /mermaid >}}

**EDR 是 macOS 的显示表示和合成方式，不是另一种视频文件格式。** 显示余量可以理解为**可用的 HDR 最高亮度 ÷ 此刻的 SDR 白亮度**。例如，网页白底是 200 nit，屏幕还能把一小块车灯高光显示到 600 nit，那就是 `3.0×` 余量。在 Apple 的线性 EDR 表示里，SDR 白是 `1.0`；`2.0×` 等于多一档，`1.0×` 则没有额外亮度空间。这些都是相对值，不是固定的 nit。屏幕最大潜在余量和此刻可用余量也不同。亮度设置、环境、显示模式、外接屏和连接链路都可能改变结果。比如同一块屏开启了可用 HDR 模式，不代表 App 就会请求或保留 EDR。[Apple EDR 文档](https://developer.apple.com/documentation/metal/determining-support-for-edr-values) · [在 Mac 上播放 HDR 视频](https://support.apple.com/en-us/102205)

能解码也不意味着映射一致。一个应用可能直接选 SDR 基图；另一个可能先重建 HDR，再压到 SDR。即使最后都在 SDR 屏上显示，云边和车灯也可能不一样。另一个常见差异来自 **色彩标签**：同一组像素，如果被解释为不同色域、传递函数或有限／全范围，亮度和颜色都可能变化。不要先靠重打标签「修」画面；先确认标签是否与真实编码一致。

## 4. Chrome、Safari、照片、预览和 QuickTime 有何不同？

{{< codex-table compact="true" label="Mac 各应用的图片和视频显示路径" >}}
| 应用 | 图片路径 | 视频路径 |
| --- | --- | --- |
| Chrome 158 | Chromium 的图像解码和浏览器合成；能处理多种 HDR 图片，需核对具体 HDR 标记和增益图。当前 Chrome 已能解码 JPEG XL | HTML 视频或站点的 MSE/播放器路径；Mac 上可结合硬件解码、系统视频层与 Chromium 合成 |
| Safari 27.2 | WebKit 从 Safari 26 开始提供网页 HDR 图片渲染；27 改进增益图的 GPU 解码与合成 | Safari 14 已引入 HDR 视频；Apple HLS、AVFoundation 和设备能力共同影响播放 |
| 照片 12.0 | 照片图库导入；Apple 明确说明支持 HDR 静态图，并有「显示完整 HDR」设置 | 可管理和播放图库中的视频；针对某种容器和 Profile 要实测 |
| 预览 11.0 | 直接打开本地图片；Apple 从 macOS 15 起明确列入 HDR 图片查看应用 | 不是视频播放基准；Finder 空格预览（Quick Look）也不是预览.app |
| QuickTime Player 10.5 | 不是通用 HDR 照片查看器 | 直接打开本地文件，走系统媒体路径；优先拿它检查本地 MP4/MOV |
{{< /codex-table >}}

**本地查看时**，照片用单张查看并核对「显示完整 HDR」；验证传输时导出未修改的原片。Finder 的空格预览（Quick Look）不是预览.app；用预览另存后请重新核对 HDR 元数据。QuickTime 的 `⌘I` 能看格式、位深、编码，不能证明当前屏幕在以 HDR 发光。

**网页播放还有三种变量：**

- **Safari 和 Chrome 不一定拿到同一份数据。** 网站可按浏览器、DRM、硬解、带宽或显示能力返回不同资源；HLS 可能在 SDR、PQ、HLG 变体之间选择。把同一个下载文件分别跑进两边，才能隔离「选了什么片」和「怎么显示」。
- **网页可以主动压住高光。** `dynamic-range-limit: standard` 可以限制 HDR 内容的显示范围；同一图片只用 `<img>` 和经过 SDR Canvas、重编码或加滤镜的组件，不要默认相同。顶层直开和嵌入页面的结果也应分别看。
- **浏览器视频的合成层不是恒定的。** Chromium 曾记录 Mac 上部分帧尺寸无法提升到 `AVSampleBufferDisplayLayer` 视频层、导致 HDR 高光损失的回归，修复在 M158 开发版本得到验证。这个案例解释了为什么「都是 Chrome，都能播放」还不够；不是说当前稳定版仍存在这个已修复的同一问题。

实现依据：[WebKit 的 HDR 图像和 CSS](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/#hdr-images) · [Safari 27 增益图管线](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/) · [Chrome JPEG XL 解码](https://developer.chrome.com/blog/jpeg-xl-in-chrome) · [Chromium Mac 视频合成回归](https://issues.chromium.org/issues/572225701) · [照片设置](https://support.apple.com/guide/photos/pht5156cc968/mac) · [Apple 对预览和照片 HDR 支持的说明](https://developer.apple.com/videos/play/wwdc2024/10177/?time=1104) · [QuickTime 影片检查器](https://support.apple.com/guide/quicktime-player/qtp65619118c/mac)

## 5. 同一批样片的实测：能开、认得 HDR、能发光，分别记

这组是 11 月 24 日的基线。图片以同一台本机 HTTP 服务送入两边；加载成功要求 `img.decode()` 完成且有实际像素尺寸。视频用带对应 MIME 类型的文件，播放成功要求有画面尺寸、媒体缓冲就绪且播放时间前进。原生系统另测 ImageIO 的 HDR 解码和 AVFoundation 的可播放、HDR 轨标记。浏览器测试不经过任何网站转码、DRM 或选流，也没测 Finder 双击、浏览器顶层导航或全屏。

{{< codex-table compact="true" label="静态图片样片的解码结果" >}}
| 样片 | Chrome 158 | WebKit | ImageIO 请求 HDR |
| --- | --- | --- | --- |
| 普通 SDR JPEG | 成功 | 成功 | 余量 1.00× |
| PQ AVIF、PQ PNG（16-bit，cICP） | 成功 | 成功 | 两份均为 4.93× |
| PQ HEIC（10-bit） | 该样片解码失败 | 成功 | 4.93× |
| ISO 增益图 JPEG、AVIF | 成功 | 成功 | 两份均识别 ISO 增益图，2.46× |
| 两份旧式 Apple 增益图 JPEG | 成功 | 成功 | 两份均识别 Apple 增益图，约 4.53×、8.00× |
| libjxl 的 PQ 渐变 JPEG XL | 成功 | 成功 | 能开，但报告 1.00×；不能据此判断别的 JPEG XL 样片 |
{{< /codex-table >}}

**表中倍数是 ImageIO 返回的内容余量，不是实测屏幕亮度。** 浏览器能开增益图 JPEG，也不代表应用了辅助图：同一个 JPEG 的 SDR 基图就足以通过这项测试。直接 HDR 的灰阶样片以 0、25、100、203、400、1000 nit 为输入生成；源文件中的这些数字不能拿来推导显示器输出。ISO、Apple 与 JPEG XL 样片分别来自 [libavif](https://github.com/AOMediaCodec/libavif/tree/main/tests/data)、[libultrahdr](https://github.com/google/libultrahdr/tree/main/tests/data) 和 [libjxl](https://github.com/libjxl/testdata/blob/main/jxl/pq_gradient.jxl)。

{{< codex-table compact="true" label="视频样片的解码与播放结果" >}}
| 样片 | Chrome 158 | WebKit | 系统文件探测 |
| --- | --- | --- | --- |
| H.264／MP4，BT.709 SDR | 可播 | 可播 | 可播，非 HDR 轨 |
| HEVC Main10／MP4，HDR10（PQ） | 可播 | 可播 | 可播，有 HDR 轨 |
| HEVC Main10／MP4，HLG | 可播 | 可播 | 可播，有 HDR 轨 |
| AV1 10-bit／MP4，PQ | 可播 | 可播 | 可播，有 HDR 轨 |
| VP9 Profile 2／WebM，PQ | 可播 | 可播 | 此文件不能打开 |
{{< /codex-table >}}

这组短片是本地合成的，不代表高码率、杜比视界、HDR10+ 或付费平台的表现。VP9 的结果说明，即使同一台 Mac 的两种浏览器都能播某个 WebM，原生文件 API 也可能打不开；它不是对 QuickTime Player 所有 WebM 行为的断言。

> **这组兼容性测试的边界。** 当时测试屏的 EDR 实时值和最大潜在值都为 `1.0`，两个浏览器环境的 `(dynamic-range: high)` 和 `(video-dynamic-range: high)` 都不匹配。这组只验证解码、播放与 HDR 识别，不是应用峰值亮度或显示一致性排名。

## 6. 逆向实测：为什么 Safari 的 HDR 高光有亮度，颜色却更淡？ {#safari-hdr-gain-map-gap}

开启外接屏 HDR 后，macOS 报告的即时 EDR 从最初的 `1.20×` 升到测试时的 `6.30×`，潜在值是 `12.61×`。这次屏幕有余量，Safari 的 `(dynamic-range: high)` 也为真。接下来用六格中性灰和两个高亮红绿色块做对照，避免把「高光不够亮」和「高光颜色不够纯」混为一谈。 [Apple 对即时与潜在 EDR 的定义](https://developer.apple.com/documentation/metal/determining-support-for-edr-values)

### 先在真实窗口里把差异复现出来

同一张 **512 × 256 的 ISO RGB 增益图 JPEG**，默认 ImageIO 解码只用 SDR 基图，最亮灰块为 `1.000`；显式请求 HDR 后升到 `4.003`。同机 Core Image 显式展开也得到约 `4.00`。把原文件在 Safari 用普通 `<img>`、`dynamic-range-limit: no-limit` 显示，在「预览」直接打开。两边轮流到前台，用 macOS 原生 HDR HEIC 截图，在扩展线性 Display P3 中采样。**单独显示时，最亮灰块在两边都是 `4.003`，但 Safari 的红绿高光更接近中性。** 例如，绿块的 RGB 从「预览」的 `(0.263, 1.497, 0.450)` 变成 Safari 的 `(0.472, 1.464, 0.527)`。这不是 JPEG 只显示了 SDR 基图。 [Apple HDR 截屏说明](https://support.apple.com/zh-cn/102646) · [为什么要让「预览」在前台](https://support.apple.com/en-my/guide/preview/prvw11470/11.0/mac/27)

再把这张 JPEG 和由**同一组色值**制作的直编码 Display P3 PQ PNG 放在 Safari 同一页、同一尺寸、同一背景，两排一起截。用次通道除以主通道看色纯度，数值越大，说明该次通道混入越多。这样比拿不同截图的整图亮度直接相减更可靠。

{{< codex-table compact="true" label="系统 HDR 截图的线性颜色取样" >}}
| 色块通道比 | 预览 JPEG | Safari JPEG 单图 | Safari 同窗 JPEG | Safari 同窗 PQ PNG |
| --- | ---: | ---: | ---: | ---: |
| 红块 G/R | 0.176 | 0.239 | 0.240 | 0.175 |
| 绿块 R/G | 0.176 | 0.322 | 0.321 | 0.173 |
{{< /codex-table >}}

**同一帧里，直接 PQ 的色比回到接近「预览」的位置，增益图 JPEG 的差异则重复出现。** 这把范围缩到 Safari 处理这类增益图的分支。两排图在这次截图里的最亮灰块分别约是各自参考白块的 `2.05×`、`2.01×`，和单图的 `4.00×` 不同。这个共同变化尚未归因，可能涉及布局、应用状态或系统截图/合成，不能把不同截图的数值当物理亮度比较。下面对色差的归因用的是同帧对照和独立缓冲区实验。

### 两条链路在哪里分叉？

{{< mermaid >}}
flowchart TB
    accTitle: Safari 与预览重建同一张 HDR 增益图的分叉
    accDescr: 两边读同一张 JPEG。Safari 条件满足时分别解码底图与增益图，经 GPU 图像缓存重建和网页绘制；预览用 Core Image 展开 HDR 并交给独立 EDR 图层。Safari 在基图转成 BGRA 缓冲区时没有传递色彩空间附件。
    A["同一张 JPEG<br/>P3 SDR 基图 + ISO 增益图"]:::client
    B["Safari / WebKit<br/>基图与增益图分开解码"]:::service
    C["GPU 图像缓存<br/>基图转 BGRA，未带上色彩空间附件"]:::engine
    D["ImageIO 合并增益图<br/>P3 PQ → IOSurface → CGImage"]:::service
    E["网页绘制<br/>图层、CSS、EDR 目标值"]:::storage
    P["预览 / Core Image<br/>直接展开 HDR"]:::service
    Q["独立原生图层<br/>EDR 强度、目标和窗口焦点"]:::storage
    A --> B --> C --> D --> E
    A --> P --> Q
{{< /mermaid >}}

1. **Safari 决定这次怎么解码。** `RenderImage` 把是否绘制 HDR、是否允许加速和 CSS 限幅传入。`BitmapImageSource` 可只取基图、请 ImageIO 直接解成 HDR，或保留 `BaseAndGainMap` 交给远程绘图路径。分开取增益图时，`ImageDecoderCG` 先找 ISO，找不到再查 Apple 类型。 [绘制入口](https://github.com/WebKit/WebKit/blob/5e62f67e97ebccc9da92e1ab166cfe640767dea4/Source/WebCore/rendering/RenderImage.cpp#L786-L808) · [解码分支](https://github.com/WebKit/WebKit/blob/5e62f67e97ebccc9da92e1ab166cfe640767dea4/Source/WebCore/platform/graphics/BitmapImageSource.cpp#L338-L347) · [辅助图读取](https://github.com/WebKit/WebKit/blob/5e62f67e97ebccc9da92e1ab166cfe640767dea4/Source/WebCore/platform/graphics/cg/ImageDecoderCG.cpp#L641-L668)
2. **Safari 在 GPU 进程建立图像缓存时合并。** `RemoteRenderingBackend::cacheNativeImage` 用共享位图恢复仍带色彩空间的基图，再经 `ShareableBitmap` 调到 `ShareableGainMap::applyGainMapToBaseImage`。它申请 Display P3 PQ 目标和默认 half-float 输出，经 `CGImageApplyHDRGainMap` 合并，再从 IOSurface 建 `CGImage`。远程绘制随后按资源 ID 取缓存里的 `NativeImage`，交给 `GraphicsContext`。EDR 限幅是后面的绘制环节；这个版本里显式的 `standard` 参考白映射分支不能用来解释测试页设为 `no-limit` 的色差。 [Safari 27 发布说明](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/) · [共享位图恢复](https://github.com/WebKit/WebKit/blob/5e62f67e97ebccc9da92e1ab166cfe640767dea4/Source/WebCore/platform/graphics/cg/ShareableBitmapCG.mm#L235-L258) · [增益图合并](https://github.com/WebKit/WebKit/blob/5e62f67e97ebccc9da92e1ab166cfe640767dea4/Source/WebCore/platform/graphics/cocoa/ShareableGainMap.cpp#L83-L183) · [绘制侧 EDR](https://github.com/WebKit/WebKit/blob/5e62f67e97ebccc9da92e1ab166cfe640767dea4/Source/WebCore/platform/graphics/cg/GraphicsContextCG.cpp#L397-L433)
3. **「预览」不走这段桥接。** 本机反汇编看到 `PVImageElement` 为显示用的 `CIImage` 选择 `kCIImageExpandToHDR` 或 `kCIImageToneMapHDRtoSDR`，识别 ISO 和 Apple 两种辅助图，并把首选 `high`、EDR 强度和目标交给自己的图层。`PVIKImageView2` 另有 HDR 焦点策略。WebKit 也有窗口失焦时抑制静态 HDR 的路径，不能拿一个前台窗口和另一个背景窗口做峰值对比。 [WebKit 焦点行为](https://bugs.webkit.org/show_bug.cgi?id=289152#c3)

<details>
<summary>查看本机二进制锚点和证据边界</summary>

本机为 macOS `27.2 (26B123)`，Safari / WebKit `22625.2.8.11.9`、预览 `11.0 (1147.1.10)`。用 `dyld_info` 读取 `arm64e.x1` 共享缓存里的实际指令，解析跨库 stub 的指向，并与 [WebKit-7625.2.8.11.9](https://github.com/WebKit/WebKit/releases/tag/WebKit-7625.2.8.11.9) 对照。以下是未加 ASLR slide 的虚拟地址，不是文件偏移或某次运行中的程序计数器。

{{< codex-table compact="true" label="本机 arm64e.x1 静态锚点" >}}
| 环节 | 实机静态证据 |
| --- | --- |
| WebKit GPU 缓存 | `RemoteRenderingBackend::cacheNativeImage` `0x1A495E64C`，`0x1A495E6A4` 的跨库调用解析到下行 |
| WebCore 重建 | `ShareableBitmap::createPlatformImage` `0x1B89BA1B4`，`0x1B89BA244` 直调 `ShareableGainMap::applyGainMapToBaseImage` `0x1BB585590` |
| 基图变成 BGRA | `createMetalCompatibleCVPixelBufferFromImage` `0x1BB577BBC`；`0x1BB577C28` 将创建缓冲区的色彩空间参数置空，`0x1BB577C80` 却把原色彩空间传给位图绘制；`0x1BB577958` 跳过空参数的附件设置 |
| ImageIO 合并和交接 | `0x1BB585AB0` 经 stub 调 `CGImageApplyHDRGainMap`，`0x1BB585BF0` 调 `CGImageCreateFromIOSurface` |
| ImageIO 基图色彩回退 | `-[HDRImage colorSpace]` `0x18D66A358` 经 `xdr_CVPixelBufferCopyColorSpace` 检查附件；若读不到也推不出色彩空间，`0x18D66A3E4` 用 `kCGColorSpaceSRGB` 创建回退值 |
| 网页绘制 | GPU `RemoteGraphicsContext::drawNativeImage` `0x1A49379B4` 查缓存，经虚表调用。对 `GraphicsContextCG`，该槽指向 `0x1BB56373C`，其后调用 `CGContextDrawImage` |
| 「预览」原生显示 | `_imageOptions` `0x10004ACB4`，采样显示路径 `_sourceCIImageWithSubsample…` `0x10004B77C`，`_createLayerForView` `0x10004CD08`，HDR 焦点入口 `0x100152148` |
{{< /codex-table >}}

静态调用链证明本机**有**这条实现，不等同于挂钩记录了每一帧。单图和同屏是实际 Safari/预览画面的取样，下一组探针则在独立进程调用同一系统入口。三类证据不要混用。

</details>

### 真正的缺口在基图被装进像素缓冲区时

`createMetalCompatibleCVPixelBufferFromImage` 读出基图的 `CGColorSpace`，**绘制 BGRA 像素时确实使用了 Display P3，但创建 `CVPixelBuffer` 时没有把色彩空间传下去**。于是字节是按 P3 的含义写入，承载这些字节的缓冲区却没有 `kCVImageBufferCGColorSpaceKey`。WebKit 另外把基图色彩空间写进一份用来询问**目标输出属性**的字典，但这不是给基图缓冲区补标签。传入合并操作的增益图色彩空间也属于另一份数据。 [创建和绘制基图缓冲区](https://github.com/WebKit/WebKit/blob/5e62f67e97ebccc9da92e1ab166cfe640767dea4/Source/WebCore/platform/graphics/cocoa/CVPixelBufferUtilities.cpp#L43-L114) · [目标属性与合并选项](https://github.com/WebKit/WebKit/blob/5e62f67e97ebccc9da92e1ab166cfe640767dea4/Source/WebCore/platform/graphics/cocoa/ShareableGainMap.cpp#L104-L159)

继续追到本机 ImageIO，合并函数把基图缓冲封装为 `HDRImage`。它的 `colorSpace` 先查缓冲区有没有色彩空间附件，再尝试从其他附件推导。两步都取不到时，会明确回退到 **sRGB**。这里的问题不只是少了一份描述，而是下游会用另一个色域来解释同一份像素字节。

我在独立进程用同一份 JPEG、同一套 BGRA 字节、原增益图和元数据，调用本机同一个 `CGImageApplyHDRGainMap`。不进入 Safari、不画页面，直接在合并完成的 IOSurface 输出上采样。**只改变基图缓冲区的色彩空间附件**，结果就从接近「预览」切换为接近 Safari。

{{< codex-table compact="true" label="独立重建探针：只改变基图缓冲区的颜色附件" >}}
| 基图附件 | 最亮灰块 | 红块 G/R | 绿块 R/G |
| --- | ---: | ---: | ---: |
| 正确的 Display P3 | 3.995 | 0.176 | 0.167 |
| 无附件 | 3.995 | 0.238 | 0.324 |
| 显式写 sRGB，字节不变 | 3.995 | 0.238 | 0.324 |
{{< /codex-table >}}

无附件与显式 sRGB 两组的八个色块读数在探针输出的四位小数内一致。换用复制后的增益图缓冲区、只剥掉它的附带颜色标签，或让增益图元数据经 XMP 序列化往返，都没有改变这个分组。**因此最有力的解释是，这组实验里无附件的 P3 基图字节按 sRGB 解释了。** 对中性的 `R = G = B`，两种色域之间的转换仍会保留中性；对高亮纯色却会改变通道比例。这正好解释了灰阶高光没掉、颜色却变淡。差异在独立合并输出上已经出现，不需要等到网页 CSS 或屏幕合成才出现。 [标准色彩转换矩阵](https://www.w3.org/TR/css-color-4/#color-conversion-code)

这不是对 Safari 做过修补后再运行的验证，也不是所有 HDR 图片都会偏色的结论。它也不同于 WebKit 曾修过的 RGB 增益图合并输出意外降到 8 位的问题。这里的目标缓冲区实测为 `RGhA`，只补基图附件即可在探针里恢复色彩。浏览器侧值得验证的修复是把原色彩空间传给基图缓冲区的创建函数，再用高亮 RGB 色块做回归，而不是只测灰阶。 [WebKit 的 8 位输出修复](https://github.com/WebKit/WebKit/commit/dfcca6f9900ac6564be76443848bf518bf8c4bf2)

[下载合成样本、同屏对照页、探针与原始取样数据](safari-hdr-lab.zip)。压缩包只含合成文件、代码和数值，没有桌面原截图。

## 7. 自己遇到「同一张看起来不一样」，怎么排查？

1. **锁住源文件。** 对照本地原片与网页实际请求（图片看 `currentSrc`，视频看网络面板和实际 HLS/选流记录）。如果是同一静态文件，比较哈希；不要拿照片缩略图、聊天压缩图或视频封面来比。
2. **先验文件。** 视频在 QuickTime Player 用 `⌘I` 看编码、HDR 格式与位深；也可用下面的 `ffprobe` 检查信号。照片查 ICC/cICP 与辅助增益图，不能只凭分辨率、后缀和位深。没有读到 HDR10+／Dolby Vision 元数据也不要只靠 PQ 标签给它定 Profile。
3. **锁住显示条件。** 两个窗口用同一屏、同一亮度/显示模式；如用外接 HDR 屏，确认 macOS 中已启用 HDR。若在笔记本上，查电池设置是否会让流媒体改播 SDR。照片用单图和「显示完整 HDR」，浏览器先排除会改变颜色或亮度的 CSS / Canvas，再单测全屏。
4. **用灰阶和高光判断，不要只比较整张图谁更亮。** 对照一块 SDR 白和上方 HDR 高光阶，看高光是否超过参考白、纹理是否仍可区分。浏览器的媒体查询是环境线索，不是某一帧的发光测量；普通 SDR 截图不能做峰值亮度证据。要比较应用实际输出相差多少 nit，至少用支持 HDR 的同一屏，严谨比较则用校准过的仪器。

```bash
ffprobe -v error -select_streams v:0 \
  -show_streams -of json sample.mp4
```

重点查 `codec_name`、`profile`、`pix_fmt`、`color_range`、`color_space`、`color_transfer`、`color_primaries`；静态或动态元数据有时还需检查帧级 side data。这样的文件探测不能替代显示验收。

**对发布方的建议：** 网页照片需要照顾普通屏，优先验证带 SDR 基图的增益图 JPEG，并确认 CDN 不丢辅助图；发给摄影或技术读者时，可另提供直接 HDR 版和清楚标注的 SDR 版。视频提供一份明确的 SDR 变体和一份明确的 HDR 变体，再验证实际选流及峰值。**最值得记录的不是「某应用支持 HDR」，而是某一份文件、某个版本、某个显示条件下，HDR 到底走到了哪一步。**
