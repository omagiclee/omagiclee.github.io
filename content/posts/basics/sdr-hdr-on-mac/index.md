+++
date = '2026-11-24T21:10:00+08:00'
draft = false
title = '从文件到屏幕：SDR、HDR，以及同一张图为什么在 Mac 上看起来不同'
description = '从 PQ、HLG、增益图到 macOS EDR，比较 Chrome 158、Safari 27.2、照片、预览和 QuickTime Player 的图片与视频显示路径。'
summary = '一张 HDR 照片能打开、能恢复高光、能在屏幕上显示高光，是三件不同的事。本文用同一批样片，区分文件、解码、应用合成和屏幕输出。'
categories = ['影像画质']
tags = ['SDR', 'HDR', 'macOS', '色彩管理', 'PQ', 'HLG']
isCJKLanguage = true
contentLanguage = 'zh-CN'
+++

同一张夜景，同一块 Mac 屏幕：在「照片」里，车灯比网页白底亮得多；拖进浏览器，车灯和白底却差不多亮。也可能反过来，网页能播放一段 HDR 视频，QuickTime Player 却打不开那份文件。前者可能是显示路径不同，后者可能只是播放器不认容器。两件事不该都叫「不支持 HDR」。

判断 HDR，先问三次：**交付的文件有没有 HDR？应用有没有把 HDR 信号留到合成阶段？这块屏此刻有没有亮度余量？** 任意一步不成立，屏幕上就不一定有高于 SDR 白的高光。

> **核验日期：2026 年 11 月 24 日。** Google 公告的 Mac Chrome 最新常规稳定分支为 **158.0.8127.88/.89**；实测用官方 **Chrome for Testing 158.0.8127.88**。Apple 当时的公开稳定版是 **Safari 27.2**；本机 macOS 27.2，用同机系统 **WKWebView** 隔离验证 WebKit 的样片解码，不把它当作 Safari.app 的完整实测。照片 12.0、预览 11.0、QuickTime Player 10.5 的应用行为以 Apple 文档为依据，另测底层 ImageIO 和 AVFoundation。**本机显示器没有 EDR 余量，没有做物理 HDR 亮度对比。** [Chrome 公告](https://chromereleases.googleblog.com/2026/11/stable-channel-update-for-desktop_01734282054.html) · [Safari 27.2](https://webkit.org/blog/18515/webkit-features-for-safari-27-2/)

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

图片以同一台本机 HTTP 服务送入两边；加载成功要求 `img.decode()` 完成且有实际像素尺寸。视频用带对应 MIME 类型的文件，播放成功要求有画面尺寸、媒体缓冲就绪且播放时间前进。原生系统另测 ImageIO 的 HDR 解码和 AVFoundation 的可播放、HDR 轨标记。浏览器测试不经过任何网站转码、DRM 或选流，也没测 Finder 双击、浏览器顶层导航或全屏。

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

> **显示验收的边界：** 当前测试屏的 EDR 实时值和最大潜在值都为 `1.0`。两个浏览器环境的 `(dynamic-range: high)` 和 `(video-dynamic-range: high)` 也都不匹配。这里验证的是文件能否走通解码/播放、底层能否识别 HDR；**没有给五个应用的实际峰值亮度、色调映射质量或显示一致性排名。**

## 6. 自己遇到「同一张看起来不一样」，怎么排查？

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
