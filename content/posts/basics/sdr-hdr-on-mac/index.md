+++
date = '2026-11-24T21:10:00+08:00'
draft = false
title = 'Mac 上的 SDR 与 HDR 显示差距：Chrome、Safari、照片、预览和 QuickTime'
description = '从 Safari 和预览的真实 HDR 截图出发，追查增益图色差，再用样片区分 Mac 上 SDR、PQ、HLG 的文件、解码、合成和屏幕输出。'
summary = '同一张 JPEG 在 Safari 和预览里都能保留约 4× 的灰阶高光，亮绿色却深浅不同。看真实截图，再顺着反汇编和单变量实验追到丢失的 Display P3 标签。'
categories = ['影像画质']
tags = ['SDR', 'HDR', 'macOS', '色彩管理', 'PQ', 'HLG', '增益图']
isCJKLanguage = true
contentLanguage = 'zh-CN'
+++

同一个 HDR JPEG，Safari 和「预览」都把最亮的灰块画到了约 **4× SDR 白**。但在 Safari 里，旁边的亮绿色变淡了。把图片换成直接编码的 PQ PNG，在同一扇 Safari 窗口里，颜色又回到了接近「预览」的位置。

**灰阶有 HDR，不等于彩色高光正确。** 这次我们顺着两款应用的调用链，把差异定位到了 WebKit 在 GPU 重建时没有传下去的一处颜色标签。也正因为画面没有整体变暗，只用灰阶做验收很容易漏掉它。

<!--more-->

[先看截图](#safari-hdr-gain-map-gap) · [追到色差发生的位置](#hdr-root-cause) · [查五款应用的结果](#mac-media-matrix) · [拿样片复验](#hdr-reproduction)

## 1. 同一张图，Safari 到底画得哪里不同？ {#safari-hdr-gain-map-gap}

<figure id="safari-preview-captures">
  <img src="images/safari-jpeg.png" width="768" height="124" alt="Safari 的 HDR 截图裁片。六格灰阶后是变淡的红和绿。">
  <img src="images/preview-jpeg.png" width="768" height="124" alt="预览的 HDR 截图裁片。同一张 JPEG 的六格灰阶接近上排，红和绿更浓。">
  <figcaption><strong>图 1 · 同一个增益图 JPEG，两款应用各自在前台。</strong> 上排 Safari 27.2，下排「预览」11.0。重点看最右边两格。</figcaption>
</figure>

<figure id="safari-format-captures">
  <img src="images/safari-same-jpeg.png" width="768" height="124" loading="lazy" alt="Safari 同窗 HDR 截图的上排，ISO 增益图 JPEG。右侧绿色偏淡。">
  <img src="images/safari-same-pq.png" width="768" height="124" loading="lazy" alt="同张 Safari HDR 截图的下排，直接 Display P3 PQ PNG。右侧绿色更纯。">
  <figcaption><strong>图 2 · 同一扇 Safari 窗口，同一次 HDR 截屏。</strong> 上排是增益图 JPEG，下排是用同一组色值制作的直编码 Display P3 PQ PNG。尺寸、背景和 CSS 一样。</figcaption>
</figure>

**这四条是真实 HDR HEIC 截图的裁片，不是重绘的色卡。** 为了让普通 SDR 屏也能看见差异，四条图统一做 HDR 解码、在线性 Display P3 中使用相同倍率缩放，再导出为带 P3 色彩描述的 SDR PNG。所有裁片都只有合成色条，没有桌面和其他内容。下表取自原始 HDR 截图，不从网页展示图反推。 [下载 16-bit PQ 裁片和取样说明](safari-hdr-capture-crops.zip)

{{< codex-table compact="true" label="三张 HDR 截图的线性红绿通道比" >}}
| 截图里的测试条 | 红块 G/R | 绿块 R/G |
| --- | ---: | ---: |
| 图 1 上 · Safari / 增益图 JPEG | 0.239 | 0.322 |
| 图 1 下 · 预览 / 同一张 JPEG | 0.176 | 0.176 |
| 图 2 上 · Safari / 增益图 JPEG | 0.240 | 0.321 |
| 图 2 下 · Safari / 直接 PQ PNG | 0.175 | 0.173 |
{{< /codex-table >}}

**图 1 换应用。** 最亮灰块两边都是 `4.003`，但 Safari 的亮绿混入了更多红通道。**图 2 不换应用、不换屏幕，只换交付方式。** 增益图 JPEG 的偏移重现，直接 PQ PNG 则接近「预览」。通道比只描述这两个色块，不是通用的感知饱和度或色差指标。

<details>
<summary>截图条件、EDR 余量与亮度边界</summary>

- macOS **27.2（26B123）**，Safari **27.2**，预览 **11.0**。外接屏开启 HDR 后，系统报告的即时 EDR 由 `1.20×` 升到测试时的 `6.30×`，潜在值是 `12.61×`。这些倍数以当时的 SDR 白为参考，不是实测 nit。 [Apple 即时与潜在 EDR](https://developer.apple.com/documentation/metal/determining-support-for-edr-values)
- 输入为 512 × 256 的合成图。ISO RGB 增益图 JPEG 的 ImageIO 默认解码最亮灰块 `1.000`，显式展开 HDR 后 `4.003`。Safari 用普通 `<img>` 和 `dynamic-range-limit: no-limit`。两款应用轮流在前台分别截一次，再在 Safari 做同窗对照；预览失焦时可能不再以 HDR 显示。 [Apple HDR 截屏](https://support.apple.com/zh-cn/102646) · [预览前台 HDR 行为](https://support.apple.com/en-mide/guide/preview/prvw11470/mac) · [WebKit 焦点行为](https://bugs.webkit.org/show_bug.cgi?id=289152#c3)
- 两张单图的最亮灰块都是参考白的约 `4.00×`。同窗对照中，两个格式分别是各自第三灰块的 `2.05×`、`2.01×`。这个共同变化尚未定位，可能涉及布局、窗口状态或系统截图／合成。这里用同帧通道比判断色差，不把跨截图的亮度当成物理出光测量。

</details>

## 2. 色差在网页绘制之前已经出现 {#hdr-root-cause}

### P3 的像素值，被按 sRGB 解释了

WebKit 先按原来的 Display P3 把 SDR 基图画进 32BGRA 缓冲区。**字节写对了，承载它们的缓冲区却没带 `kCVImageBufferCGColorSpaceKey`。** WebKit 写给输出格式探测的另一份参数字典里还有 P3，但那个字典不会给输入缓冲区补标签。追到本机 ImageIO，合并时先查附件，再试着由其他附件推导，都拿不到才回退到 **sRGB**。两种色域都保留中性轴，却会用不同基色解释同一个 RGB 三元组。这样灰阶高光可以不掉，红绿却向中性偏移。 [WebKit 的底图缓冲区创建](https://github.com/WebKit/WebKit/blob/5e62f67e97ebccc9da92e1ab166cfe640767dea4/Source/WebCore/platform/graphics/cocoa/CVPixelBufferUtilities.cpp#L43-L114) · [输出参数与合并](https://github.com/WebKit/WebKit/blob/5e62f67e97ebccc9da92e1ab166cfe640767dea4/Source/WebCore/platform/graphics/cocoa/ShareableGainMap.cpp#L104-L159) · [标准色彩空间转换](https://www.w3.org/TR/css-color-4/#color-conversion-code)

独立探针把相同的 BGRA 字节、增益图和元数据交给 macOS 的 `CGImageApplyHDRGainMap`，直接读取合并后的 IOSurface。它不运行 Safari，也不绘制网页。唯一变量是底图颜色附件。

{{< codex-table compact="true" label="独立重建探针：只改变基图缓冲区的颜色附件" >}}
| 基图附件 | 最亮灰块 | 红块 G/R | 绿块 R/G |
| --- | ---: | ---: | ---: |
| 正确的 Display P3 | 3.995 | 0.176 | 0.167 |
| 无附件 | 3.995 | 0.238 | 0.324 |
| 显式写 sRGB，字节不变 | 3.995 | 0.238 | 0.324 |
{{< /codex-table >}}

无附件和显式 sRGB 的八格读数在四位小数内一致，色比接近 Safari 截图。补回 P3，色比回到原件的 HDR 解码值附近，最亮灰块不动。复制增益图、剥掉它自己的标签或让 XMP 往返，也不会改变分组。**只缺底图标签就足以重现色差。** 这不是两张图片用了不同的屏幕余量，也不必等到 CSS 或系统合成才出现。

### 两款应用从哪里分开？

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

<details>
<summary>展开 WebContent、GPU、ImageIO 和预览的完整调用链</summary>

1. **Safari 决定这次怎么解码。** `RenderImage` 把是否绘制 HDR、是否允许加速和 CSS 限幅传入。`BitmapImageSource` 可只取基图、请 ImageIO 直接解成 HDR，或保留 `BaseAndGainMap` 交给远程绘图路径。分开取增益图时，`ImageDecoderCG` 先找 ISO，找不到再查 Apple 类型。 [绘制入口](https://github.com/WebKit/WebKit/blob/5e62f67e97ebccc9da92e1ab166cfe640767dea4/Source/WebCore/rendering/RenderImage.cpp#L786-L808) · [解码分支](https://github.com/WebKit/WebKit/blob/5e62f67e97ebccc9da92e1ab166cfe640767dea4/Source/WebCore/platform/graphics/BitmapImageSource.cpp#L338-L347) · [辅助图读取](https://github.com/WebKit/WebKit/blob/5e62f67e97ebccc9da92e1ab166cfe640767dea4/Source/WebCore/platform/graphics/cg/ImageDecoderCG.cpp#L641-L668)
2. **Safari 在 GPU 进程建立图像缓存时合并。** `RemoteRenderingBackend::cacheNativeImage` 用共享位图恢复仍带色彩空间的基图，再经 `ShareableBitmap` 调到 `ShareableGainMap::applyGainMapToBaseImage`。它申请 Display P3 PQ 目标和默认 half-float 输出，经 `CGImageApplyHDRGainMap` 合并，再从 IOSurface 建 `CGImage`。远程绘制随后按资源 ID 取缓存里的 `NativeImage`，交给 `GraphicsContext`。EDR 限幅是后面的绘制环节；这个版本里显式的 `standard` 参考白映射分支不能用来解释测试页设为 `no-limit` 的色差。 [Safari 27 发布说明](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/) · [共享位图恢复](https://github.com/WebKit/WebKit/blob/5e62f67e97ebccc9da92e1ab166cfe640767dea4/Source/WebCore/platform/graphics/cg/ShareableBitmapCG.mm#L235-L258) · [增益图合并](https://github.com/WebKit/WebKit/blob/5e62f67e97ebccc9da92e1ab166cfe640767dea4/Source/WebCore/platform/graphics/cocoa/ShareableGainMap.cpp#L83-L183) · [绘制侧 EDR](https://github.com/WebKit/WebKit/blob/5e62f67e97ebccc9da92e1ab166cfe640767dea4/Source/WebCore/platform/graphics/cg/GraphicsContextCG.cpp#L397-L433)
3. **「预览」不走这段桥接。** 本机反汇编看到 `PVImageElement` 为显示用的 `CIImage` 选择 `kCIImageExpandToHDR` 或 `kCIImageToneMapHDRtoSDR`，识别 ISO 和 Apple 两种辅助图，并把首选 `high`、EDR 强度和目标交给自己的图层。`PVIKImageView2` 另有 HDR 焦点策略。WebKit 也有窗口失焦时抑制静态 HDR 的路径，不能拿一个前台窗口和另一个背景窗口做峰值对比。 [WebKit 焦点行为](https://bugs.webkit.org/show_bug.cgi?id=289152#c3)

</details>

<details>
<summary>查看本机二进制锚点和证据边界</summary>

本机为 macOS `27.2 (26B123)`，Safari / WebKit `22625.2.8.11.9`、预览 `11.0 (1147.1.10)`。用 `dyld_info` 读取 `arm64e.x1` 共享缓存里的实际指令，解析跨库 stub 的指向，并与 [WebKit-7625.2.8.11.9](https://github.com/WebKit/WebKit/releases/tag/WebKit-7625.2.8.11.9) 对照。以下是未加 ASLR slide 的虚拟地址，不是文件偏移或某次运行中的程序计数器。

{{< codex-table label="本机 arm64e.x1 静态锚点" >}}
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

静态调用链证明本机**有**这条实现，不等同于挂钩记录了每一帧。单图和同屏是实际 Safari/预览画面的取样，独立重建探针则在独立进程调用同一系统入口。三类证据不要混用。

</details>

### 把一行补丁编进 WebCore 再复测

在对应发行标签上，只改了创建底图缓冲区的调用，把已有的 `colorSpace` 传进去。用同一测试程序分别加载**系统原版 WebCore**和**实际编译出的修复版 WebCore**，调用两边同一个 `ShareableGainMap::applyGainMapToBaseImage`，而不是再次模拟这条路径。系统版的红块 G/R 和绿块 R/G 是 `0.2378`、`0.3235`，修复版是 `0.1756`、`0.1669`，两边最亮灰块都为 `3.9947`。这验证了实际引擎的重建输出；它不是修复版窗口的 HDR 截图，也没有替换系统 Safari。 [WebKit 运行开发构建](https://webkit.org/running-webkit/)

这与 WebKit 已修过的增益图输出意外降到 8-bit 不同，本次探针目标实际为 `RGhA`。结果不外推到其他 Safari 版本、Chrome、sRGB 基图、单通道增益图和其他载体。 [WebKit 的 8-bit 输出修复](https://github.com/WebKit/WebKit/commit/dfcca6f9900ac6564be76443848bf518bf8c4bf2)

## 3. 拿这个案例理解文件到屏幕的五层 {#hdr-display-pipeline}

{{< mermaid >}}
flowchart TB
    accTitle: 同一张图或同一段视频，从交付到屏幕的五道关口
    accDescr: 交付层选文件或选轨；解码层读像素和标记；恢复层解释颜色与动态范围；合成层按应用策略提交；显示层用当下的 EDR 余量输出。任一关的差异都可能改变画面。
    A["① 交付<br/>网页派生图、图库版本、HLS 轨道或本地原件"]:::client
    B["② 解码<br/>容器、编码、位深、ICC、cICP、视频颜色标签"]:::service
    C["③ 恢复<br/>解释 PQ/HLG、应用增益图、转换色域与范围"]:::engine
    D["④ 合成<br/>网页绘制或视频层、窗口焦点、HDR 限幅"]:::service
    E["⑤ 出光<br/>系统色彩管理、即时 EDR、显示器映射"]:::storage
    A --> B --> C --> D --> E
{{< /mermaid >}}

**打不开**，先查它拿到的文件、容器和编码。**高光封在参考白**，查信号恢复、合成或屏幕余量。**灰阶相似但亮彩色不同**，优先查 ICC、cICP、RGB／YCbCr 的解释和中间缓冲的色彩空间。**全屏或切到前台才变**，再查应用合成和系统状态。

{{< codex-table compact="true" label="SDR 照片、SDR 视频、HDR 照片和 HDR 视频" >}}
| 类别 | 文件通常如何表达 | 最容易误判的地方 |
| --- | --- | --- |
| **SDR 照片** | sRGB 或 Display P3，通过 ICC、cICP 等描述颜色 | 同一组 RGB 数字在 sRGB 和 P3 中可以表示不同颜色。16-bit、P3 或多帧合成不等于 HDR |
| **SDR 视频** | 常见 H.264／MP4，BT.709 primaries、transfer、matrix，8 bit、有限范围 | 不能把视频帧当 sRGB JPEG；错把有限范围当全范围会抬黑、压白，反过来则可能压黑、裁白 |
| **HDR 照片** | 直接 PQ／HLG（例如 PNG、AVIF、HEIC），或 SDR 基图加增益图和参数 | 直接 HDR 开得了未必正确映射。增益图开得了，甚至不代表辅助图被读到 |
| **HDR 视频** | PQ／HLG，常见 10-bit HEVC、AV1 或 VP9；叠加 HDR10、HDR10+、Dolby Vision 等交付规范 | 编码、容器、传递函数和动态元数据是不同层，不能从扩展名、10-bit 或能播放推断 HDR 输出 |
{{< /codex-table >}}

- **色域、动态范围和位深是独立的。** Display P3 或 16-bit 照片完全可以是 SDR。SDR 视频还要解释 YCbCr 矩阵、传递函数和有限／全范围。典型 8-bit BT.709 有限范围的黑白码值是 16 和 235，按 0–255 解会抬黑、压白，和 HDR 映射无关。 [ITU-R BT.709](https://www.itu.int/rec/R-REC-BT.709/en) · [BT.1886](https://www.itu.int/rec/R-REC-BT.1886/en)
- **PQ 和 HLG 都能直接编码 HDR，但含义不同。** PQ 对应绝对亮度，数学上限不是屏幕实际峰值。HLG 是相对系统，最终取决于目标显示和系统 gamma。HEVC、AV1、VP9 是编码，MP4、MOV、WebM 是容器，HLS 是分发。能播放、带 PQ 或是 10-bit，都不能证明播放端真的用了 Dolby Vision 或 HDR10+ 元数据。 [ITU-R BT.2100](https://www.itu.int/rec/R-REC-BT.2100-3-202502-I/en) · [Apple HDR 视频元数据](https://developer.apple.com/av-foundation/High-Dynamic-Range-Metadata-for-Apple-Devices.pdf) · [Apple HLS 规格](https://developer.apple.com/streaming/hls-authoring-specification-for-apple-devices.html)
- **增益图靠原有数据重建。** 常见文件是 SDR 基图加灰阶或 RGB 辅助图。ISO 也允许 HDR 基图，旧 Apple 增益图、Adaptive HDR、Ultra HDR JPEG 则不是同一种信令。图片服务只保留主 JPEG，仍能交付正常的 SDR 图。 [ISO 21496-1](https://www.iso.org/standard/86775.html) · [Apple Adaptive HDR](https://developer.apple.com/videos/play/wwdc2024/10177/) · [Ultra HDR 规格](https://developer.android.com/media/platform/hdr-image-format)

**EDR 不是文件位深，也不是峰值 nit。** macOS 用 1.0 表示参考白，2.0 是多一档。若此刻 SDR 白实际为 200 nit，小面积高光可到 600 nit，余量就是 3×。文件内容余量、应用的合成目标、屏幕可用余量要分记。外接屏还可能接到系统转换后的 HDR10 输出，不能只看 OSD 推断源文件是 PQ 还是 HLG。 [Apple EDR 文档](https://developer.apple.com/documentation/metal/determining-support-for-edr-values) · [Mac 的 HDR 外接显示](https://support.apple.com/en-us/102205)

## 4. 五款应用，哪些项目真的测到了？ {#mac-media-matrix}

数据来自 **2026 年 11 月 24–26 日**。Chrome 用独立 **Chrome for Testing 158.0.8127.88**，不使用个人配置。前面的截图来自实际 Safari.app 和预览.app。下方兼容性表的 WebKit 列是同机系统 **WKWebView**。ImageIO／AVFoundation 的结果只是框架证据，不能写成「照片」或 QuickTime 已完成窗口验收。 [Chrome 发布公告](https://chromereleases.googleblog.com/2026/11/stable-channel-update-for-desktop_01734282054.html) · [Safari 27.2](https://webkit.org/blog/18515/webkit-features-for-safari-27-2/)

{{< codex-table label="五款 Mac 应用的实测与文档边界" >}}
| 应用 | 这次已经验证或有文档支持 | 不能从这里推出 |
| --- | --- | --- |
| **Chrome 158** | SDR、PQ／HLG 图片解码，短片播放路径；PQ HEIC 样片不能打开 | 这份增益图的最终色彩、视频峰值 |
| **Safari 27.2** | 真实窗口证实 JPEG 和直接 PQ 的差异；系统 WKWebView 另测格式与播放 | WKWebView 视频通过不等于 Safari 窗口的 HDR 输出通过 |
| **预览 11.0** | 前台打开本地原片并取样，验证了这份 JPEG 的灰阶和颜色 | 不代测 Quick Look、视频或其他 HDR 文件 |
| **照片 12.0** | Apple 文档说明完整 HDR、Adaptive HDR 和 10-bit HLG 视频 | 未把所有样片导入图库做窗口取样；原片、编辑、导出要分开 |
| **QuickTime 10.5** | 指向本地 MP4／MOV 检查，系统框架读到测试轨道的 BT.709、PQ、HLG 标签 | 轨可读不等于 QuickTime 窗口亮度或动态元数据验收 |
{{< /codex-table >}}

### 静态图：同为 PQ，换个容器就可能不能开

PQ PNG／AVIF 在两个浏览器环境都能解码，换这批 HEIC 后 Chrome 的结果不同，不能写成「Chrome 不支持 PQ」。旧 Apple 增益图 JPEG 能打开，也不能证明辅助图用了。网页先验普通 `<img>`，再试缩略图、CDN、滤镜和 Canvas。Chromium 和 WebKit 也不必共享同一增益图绘制路径。 [Chrome JPEG XL](https://developer.chrome.com/blog/jpeg-xl-in-chrome) · [Chromium 增益图绘制](https://chromium.googlesource.com/chromium/src/+/HEAD/cc/paint/paint_op.cc) · [WebKit HDR 图片](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/#hdr-images)

<details>
<summary>静态样片的逐项结果</summary>

{{< codex-table label="SDR、PQ、HLG 与增益图静态样片" >}}
| 样片 | Chrome 158 **浏览** | 系统 WKWebView **浏览** | ImageIO **框架** |
| --- | --- | --- | --- |
| SDR JPEG；16-bit sRGB／Display P3 PNG | 都能解码 | 都能解码 | JPEG 与两种 PNG 的内容余量都为 1.00×；两份 PNG 色彩空间不同 |
| 直接 PQ PNG／AVIF | 都能解码 | 都能解码 | BT.2020 灰阶样片的内容余量为 4.93× |
| 直接 PQ HEIC | 两组样片均解码失败 | 都能解码 | 两组内容余量分别约 4.93×、4.00× |
| 直接 HLG PNG／AVIF | 都能解码 | 都能解码 | 两份都报告 ITU-R 2100 HLG，内容余量 4.93× |
| ISO 增益图 JPEG／AVIF | 都能解码 | 都能解码 | 基线两份识别 ISO 辅助图，约 2.46×；另制 RGB JPEG 默认 1.00×，请求 HDR 后 4.00× |
| 合成增益图 HEIC | 该样片解码失败 | 能解码 | 默认 1.00×，请求 HDR 后 4.00× |
| 旧 Apple 增益图 JPEG（两份） | 都能解码 | 都能解码 | 识别 Apple 辅助图，约 4.53×、8.00× |
{{< /codex-table >}}

这里的倍数是 ImageIO 报告的内容余量。重验的 HLG PNG 和 AVIF 含真实 HLG 码值，不是重贴 PQ 标签。基线还测了一张 PQ JPEG XL，两种浏览器都能解码，ImageIO 报告 1.00×，不能外推到整个格式。样本出处见 [libavif](https://github.com/AOMediaCodec/libavif/tree/main/tests/data)、[libultrahdr](https://github.com/google/libultrahdr/tree/main/tests/data) 和 [libjxl](https://github.com/libjxl/testdata/blob/main/jxl/pq_gradient.jxl)。

</details>

### 视频：可播和以 HDR 合成，不是一件事

PQ HEVC、AV1 的 MP4 在两种浏览器和系统框架基线都走通。PQ VP9／WebM 是浏览器能播、AVFoundation 基线接口却打不开。网页还可能为 Safari 和 Chrome 选不同 HLS 变体。Chromium 曾有「能解码，但某些尺寸不能进平台视频层，损失 HDR 余量」的已修复回归。**先用两端同一个本地 MP4 排除选流，再比浏览器、原生播放器和全屏。** [Chromium 的平台视频层回归](https://issues.chromium.org/issues/572225701) · [Safari 节能策略](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/) · [Apple HLS 2026 更新](https://developer.apple.com/streaming/Whats-new-HLS.pdf)

<details>
<summary>视频样片结果与原生应用的证据边界</summary>

{{< codex-table label="视频样片的播放和框架识别" >}}
| 样片 | Chrome 158 **浏览** | 系统 WKWebView **浏览** | AVFoundation **框架** |
| --- | --- | --- | --- |
| H.264／MP4 · BT.709 SDR | 可播 | 可播 | 可播，非 HDR 轨；首帧 BT.709 |
| HEVC Main10／MP4 · PQ HDR10 | 可播 | 可播 | 可播，有 HDR 轨；首帧 PQ、BT.2020 |
| HEVC Main10／MP4 · HLG | 可播 | 可播 | 可播，有 HDR 轨；首帧 HLG、BT.2020 |
| AV1 10-bit／MP4 · PQ | 可播（基线） | 可播（基线） | 基线可播，有 HDR 轨 |
| VP9 Profile 2／WebM · PQ | 可播（基线） | 可播（基线） | 基线接口打不开该文件 |
{{< /codex-table >}}

11 月 26 日用 640 × 360、2 秒的 BT.709、PQ、HLG 三个 MP4 复验。Chrome 的 totalVideoFrames 均为 4，含显示和丢弃帧。WKWebView 放进独立后台测试窗口后有尺寸、缓冲就绪和播放时钟，但 totalVideoFrames 为 0，只记兼容性通过。AVAssetReader 实际取帧并核对了缓冲区颜色附件，PQ 轨也查到了母版与内容亮度信息。 [播放质量计数定义](https://w3c.github.io/media-playback-quality/#videoplaybackquality)

同机静态导入显示，QuickTime 和「照片」都链接 AVFoundation／AVKit，并导入 AVPlayer 和 AVPlayerItem。「照片」额外带图库请求入口，如 PHImageManager。静态依赖不能证明两个 App 用相同映射。本次也没测两款原生应用的窗口亮度、Dolby Vision 动态元数据、HDR10+、付费流媒体或全屏。 [QuickTime 影片检查器](https://support.apple.com/guide/quicktime-player/view-information-about-a-movie-file-qtp65619118c/mac) · [照片的 HLG 视频说明](https://support.apple.com/en-ie/guide/photos/phte8a1fcd79/mac) · [AVKit 动态范围设置](https://developer.apple.com/documentation/avkit/avplayerview/preferreddisplaydynamicrange)

</details>

## 5. 遇到自己的素材有差距，先做这四步 {#hdr-reproduction}

1. **锁住实际字节。** 比本地原件与网页的 `img.currentSrc`、响应 MIME 和哈希。视频记实际 HLS／MSE 变体。图库请导出「未修改的原片」，不拿缩略图或共享副本当对照。 [Apple 照片导出说明](https://support.apple.com/guide/photos/export-photos-videos-slideshows-and-memories-pht6e157c5f/mac)
2. **固定屏幕、页面和窗口。** 同一显示模式、亮度、背景和缩放，先让两个窗口分别在前台。图像先用普通 `<img>`，再叠 CDN、Canvas 或组件。视频先放同一个本地文件，再切全屏和流媒体。媒体查询只报告能力，不证明当前帧在 HDR 显示。
3. **同时放灰阶和彩色高光。** 留一块 SDR 白、几个高光灰阶和亮红绿。灰阶回答是否封顶，颜色回答色彩解释是否正确。系统 HDR 截图能测合成信号，要量物理 nit 还需要仪器。
4. **按实测选交付。** 图文先保住颜色正确的 SDR。需要一份文件兼容两种屏，再验证增益图有没有穿过 CDN，重要素材可加直接 PQ 对照。视频留一份经检查的 BT.709 SDR，HDR 变体另验选轨、解码与输出。

<details>
<summary>复验命令与完整素材</summary>

~~~bash
shasum -a 256 example.mp4
ffprobe -v error -select_streams v:0 -show_streams -of json example.mp4
ffprobe -v error -select_streams v:0 -read_intervals '%+1' -show_frames -of json example.mp4
~~~

视频里分别看 primaries、transfer、matrix、range 和帧级 side data。网页则查看 `currentSrc`、`matchMedia('(dynamic-range: high)')` 和计算后的 `dynamic-range-limit`，再做画面取样。

- [格式与播放复验包](mac-media-gap-lab.zip)，含 SDR／HLG／PQ 样片、视频及生成和探测脚本。
- [Safari／预览逆向实验包](safari-hdr-lab.zip)，含增益图、直接 PQ、同窗对照页、静态锚点和七组重建记录。
- [HDR 截图裁片](safari-hdr-capture-crops.zip)，含四条 16-bit PQ 裁片、导出规则与重复取样数据。没有桌面原截图。

</details>

同样的像素可以因为丢一处标签，变成屏幕上不同的颜色。这次能定位，不是因为把五个 App 从亮到暗排了一遍，而是每轮都知道**哪份字节没变、哪一个条件被换了**。
