+++
date = '2026-11-24T21:10:00+08:00'
draft = false
title = 'Mac 上的 SDR 与 HDR 显示差距：Chrome、Safari、照片、预览和 QuickTime'
description = '用合成样片、实际 HDR 截图、WebKit 反汇编及单变量重建实验，比较 Mac 上 SDR 照片、SDR 视频、PQ 与 HLG，以及增益图的显示路径。'
summary = 'Safari 和预览可以保留同样的 4× 灰阶高光，却画出不同的颜色。本文从这处可复现的差异出发，拆解五个 Mac 应用的 SDR/HDR 兼容性与显示差距。'
categories = ['影像画质']
tags = ['SDR', 'HDR', 'macOS', '色彩管理', 'PQ', 'HLG', '增益图']
isCJKLanguage = true
contentLanguage = 'zh-CN'
+++

同一个增益图 JPEG，在 Safari 和「预览」里都保留了约 **4× SDR 白**的灰阶高光，但 Safari 里的亮绿色却更淡。同一个 Safari 窗口换成由相同色值制作的直接 PQ PNG，红绿比例又回到接近「预览」的位置。**这不是 HDR 没打开，而是这条 HDR 路径保住了亮度，却没有保住颜色。**

反过来，PQ 视频在两种浏览器里都能播，换一个容器，macOS 的本地文件接口却可能打不开。还有一类更常见的错觉：一张 Display P3 照片颜色很艳，但高光和网页白底一样亮，它完全可以是 SDR。这三种现象不该用一个「支不支持 HDR」来解释。

<!--more-->

本文的核心结论有三个。

1. **SDR 照片和 SDR 视频也会有色差。** 前者先查 ICC、cICP 和图片派生版本，后者先查 BT.709 的矩阵、传递函数、有限范围以及播放时拿到的帧。P3 并不意味着 HDR，视频标签也不能从截图反推。
2. **直接 HDR 和增益图要分开验收。** PQ／HLG 直接编码的文件要正确解释信号，再映射到目标显示。带 SDR 基图的增益图可以在辅助数据完全没用上的情况下仍然打开。Safari 27.2 的实测案例还说明，**增益图用了、灰阶也亮了，重建的颜色仍可能错。**
3. **五个应用不是五条等价路径。** Chrome / Safari 要再区分网页交付、图像绘制和视频合成。「预览」适合核对原始静态文件，QuickTime 适合核对本地 MP4／MOV，「照片」适合核对真实图库体验。图库和独立播放器不能互相代测，更不能用静态图的结果推断视频。

> **核验于 2026 年 11 月 26 日，macOS 27.2（26B123）**。Google 公告的 Mac 桌面稳定更新是 **158.0.8127.88/.89**，本文跑的是官方独立 **Chrome for Testing 158.0.8127.88**，不是用机器原有的 Chrome 配置。Safari **27.2** 分两个证据来源：实际 Safari.app 的前台图片取样，以及同机系统 WKWebView 的格式兼容性测试。点名的原生应用版本为「预览」**11.0**、「照片」**12.0**、QuickTime Player **10.5**。 [Chrome 桌面公告](https://chromereleases.googleblog.com/2026/11/stable-channel-update-for-desktop_01734282054.html) · [Chrome for Testing 稳定渠道](https://googlechromelabs.github.io/chrome-for-testing/) · [Safari 27.2 发布说明](https://webkit.org/blog/18515/webkit-features-for-safari-27-2/)

## 1. 先区分五道关口

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

显示差距（下文简称 gap）至少有四种可观察的结果。**打不开**先查交付与解码；**看得到但高光在参考白封顶**先查基图回退、信号恢复、合成或屏幕余量；**灰阶相似但彩色高光不同**优先查色彩空间和重建；**只有全屏、焦点或窗口大小变化时才变**再查具体合成路径、系统状态与显示器。不同层会产生相似症状，不能仅凭肉眼就定因。

文章里把证据分四种，不把它们折成一个「支持」勾号。

{{< codex-table compact="true" label="理解后文证据标记" >}}
| 标记 | 实际验证了什么 | 没有验证什么 |
| --- | --- | --- |
| **画面** | 真正的应用前台窗口，系统 HDR HEIC 取样 | 屏幕物理亮度、其他样片、其他应用 |
| **浏览** | 指定浏览器或系统 WebKit 成功解码图片；视频有尺寸且时间前进 | HDR 合成、应用是否应用增益图、峰值亮度 |
| **框架** | ImageIO 解码或 AVFoundation 读轨／解码帧，并报告各自的元数据 | 使用该框架的应用一定用同一入口、同一设置 |
| **文档／实现** | 厂商描述的能力或源码／反汇编存在的分支 | 该样片、该窗口一定走了这个分支 |
{{< /codex-table >}}

**实验有两条主线。** 11 月 24 日先跑解码及播放基线，外接屏当时的 EDR 即时和潜在值均为 1.0。11 月 26 日开启 HDR 后，由实际 Safari / 预览逐个前台显示，做增益图和直接 PQ 的 HDR 截图对照。同日另用新样片复查 Chrome、WKWebView 和系统框架，补齐 SDR P3 与 HLG 静态图；这组复查不是五个应用的屏幕测量。涉及用户原始照片的网页差异并未取得原件，因此下文归因的是合成样片。可用文末的附件独立复测。

## 2. 四类媒体，最容易弄错的是哪一项

{{< codex-table compact="true" label="SDR 照片、SDR 视频、HDR 照片和 HDR 视频" >}}
| 类别 | 文件通常如何表达 | 最容易误判的地方 |
| --- | --- | --- |
| **SDR 照片** | sRGB 或 Display P3，通过 ICC、cICP 等描述颜色 | 同一组 RGB 数字在 sRGB 和 P3 中可以表示不同颜色。16-bit、P3 或多帧合成不等于 HDR |
| **SDR 视频** | 常见 H.264／MP4，BT.709 primaries、transfer、matrix，8 bit、有限范围 | 不能把视频帧当 sRGB JPEG；错把有限范围当全范围会抬黑、压白，反过来则可能压黑、裁白 |
| **HDR 照片** | 直接 PQ／HLG（例如 PNG、AVIF、HEIC），或 SDR 基图加增益图和参数 | 直接 HDR 开得了未必正确映射。增益图开得了，甚至不代表辅助图被读到 |
| **HDR 视频** | PQ／HLG，常见 10-bit HEVC、AV1 或 VP9；叠加 HDR10、HDR10+、Dolby Vision 等交付规范 | 编码、容器、传递函数和动态元数据是不同层，不能从扩展名、10-bit 或能播放推断 HDR 输出 |
{{< /codex-table >}}

**SDR、宽色域和位深是三根轴。** SDR 白是参考上限，不是固定的屏幕 nit。传统 SDR 视频参考监看常用约 100 nit 的白。BT.709 的信号特性、BT.1886 的参考显示和 sRGB 的传递曲线不可直接互换，即使 Rec.709 和 sRGB 的基色坐标相同。HDR 也不要求整幅图更亮。云、白墙或 UI 保持在参考白附近，真正拉开的可以只是一处太阳或反光。

**PQ 是绝对式；HLG 是相对式。** PQ（SMPTE ST 2084）把码值映射到绝对亮度，标称范围可到 10,000 nit，与样片峰值、母版监看和屏幕能力是三回事。HLG 的码值表达相对场景信号，显示端结合系统 gamma、目标峰值与观看环境处理。HLG 不是可以随意删标签当 SDR 的「自带兼容」。我们给 HLG 灰阶用 1000 nit 参考显示和 1.2 的系统 gamma 反推码值，是为了建立可复查的输入，不是要求每台 Mac 以 1000 nit 输出。 [ITU-R BT.2100-3](https://www.itu.int/rec/R-REC-BT.2100-3-202502-I/en) · [ITU-R BT.2408-9](https://www.itu.int/pub/R-REP-BT.2408-9-2026) · [W3C 色彩空间定义](https://www.w3.org/TR/css-color-4/#predefined)

**增益图是像素级的静态图重建数据，不是视频动态元数据。** 常见交付是 SDR 基图 + 较小的灰阶或 RGB 增益图 + 参数。解码端在线性工作域还原高光，并可按当前显示余量调整增益。ISO 21496-1 也允许以 HDR 为基图。Apple Adaptive HDR、旧 Apple 增益图、Ultra HDR JPEG 并非完全相同的信令。Ultra HDR JPEG 可以同时写入其传统 XMP 和 ISO 元数据。只保留主 JPEG 的 CDN 或编辑器可以产出一张完全正常的 SDR 照片，却已经丢了 HDR。 [ISO 21496-1](https://www.iso.org/standard/86775.html) · [ISO 22028-5](https://www.iso.org/standard/87778.html) · [Apple Adaptive HDR](https://developer.apple.com/videos/play/wwdc2024/10177/) · [Android Ultra HDR 文件规格](https://developer.android.com/media/platform/hdr-image-format)

**带 PQ 也不等于 HDR10，更不等于 Dolby Vision。** HDR10 常用 BT.2020 信号、10-bit PQ 和静态母版／内容亮度信息。HDR10+ 另有动态元数据。Dolby Vision 要分 Profile，8.1 有 HDR10 兼容基础层，8.4 有 HLG 兼容基础层，不能把所有 Profile 都当成可回退。收到 HLS 的 PQ 变体，或者播出了兼容基础层，都不能证明播放器使用了动态元数据。原生 HLS、网页 MSE、同名 MP4 文件也不是同一条路径。 [Apple HDR 视频元数据](https://developer.apple.com/av-foundation/High-Dynamic-Range-Metadata-for-Apple-Devices.pdf) · [Dolby Vision 与 AVFoundation](https://developer.apple.com/av-foundation/Incorporating-HDR-video-with-Dolby-Vision-into-your-apps.pdf) · [Apple HLS Authoring Specification](https://developer.apple.com/streaming/hls-authoring-specification-for-apple-devices.html)

### EDR 为什么不是「屏幕峰值」

macOS 把 SDR 白归一到线性 EDR 的 1.0。2× 是相对 SDR 白多一档，4× 多两档。假设此刻 SDR 白实际为 200 nit，而小块高光可到 600 nit，余量就是 3×。**内容余量、应用选择的目标及屏幕即时余量是三个不同的量。** 屏幕的最大潜在余量也不是此刻的可用值。亮度、显示模式、前后台、外接链路、同屏内容都可能影响最终结果。Apple 还注明，接其他兼容的 HDR10 外接屏时，Dolby Vision 和 HLG 会转换为 HDR10 输出，不能靠显示器 OSD 上的「HDR10」反推源素材是 PQ。 [Apple EDR 余量](https://developer.apple.com/documentation/metal/determining-support-for-edr-values) · [macOS HDR 视频及外接显示](https://support.apple.com/en-us/102205)

## 3. 照片 gap：SDR、直接 PQ／HLG、增益图分别看

### 同一批样片走到了哪一步

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

数据来自 11 月 24 日格式基线与 11 月 26 日合成样片复验。表中的倍数是 ImageIO 图像对象报告的**内容余量**，不是浏览器、原生窗口或屏幕的峰值。新 HLG 对照是实际编码的 HLG 码值，其中 PNG 用 cICP 标记，AVIF 为 10-bit。PNG 和 AVIF 同时能打开的含义仅限解码；能不能显出比 SDR 白更亮的高光仍需从 HDR 合成窗口取样。基线外部样片见 [libavif](https://github.com/AOMediaCodec/libavif/tree/main/tests/data) 和 [libultrahdr](https://github.com/google/libultrahdr/tree/main/tests/data)。

其中有两种特别容易读错的结果。**旧 Apple 增益图 JPEG 能在浏览器里打开，不证明旧式辅助图被应用。** **PQ HEIC 是载体差别的好例子**，同属 PQ 的 PNG 和 AVIF 可以解码，换成这份 HEIC，Chrome 的结果不同。两者不应混写为「Chrome 不支持 PQ」或「JPEG 全部 HDR」。早期基线的 PQ JPEG XL 在两种浏览器都打开了，ImageIO 请求 HDR 得到的内容余量却为 1.00×。这只说明这个样片、这个报告值，不能用来给整个 JPEG XL 格式划线。 [Chrome 的 JPEG XL 解码说明](https://developer.chrome.com/blog/jpeg-xl-in-chrome) · [libjxl 测试图](https://github.com/libjxl/testdata/blob/main/jxl/pq_gradient.jxl)

### 五个应用的静态图差距

{{< codex-table label="静态图的应用差距，应用和框架分开" >}}
| 应用 | SDR 照片 | 直接 PQ／HLG | 增益图 |
| --- | --- | --- | --- |
| **Chrome 158** | sRGB、Display P3 对照图**浏览**成功；未测屏幕色准 | 多种 PNG／AVIF **浏览**成功，本报告两组 PQ HEIC 不能解码；HDR 合成未测 | JPEG／AVIF 有可打开的样片；Chromium 有增益图绘制分支，未取样验证该 JPEG 的 Chrome 重建 |
| **Safari 27.2** | 同机 **WebKit** 对照图可解码；不能从中推断 Safari 的显示色差 | 多种载体在 **WebKit** 可解码；实际 **Safari** 同帧证实直接 PQ PNG 的红绿比例接近对照，HLG 未做窗口取样 | 实际 **Safari** 保留测试 JPEG 的灰阶高光，红绿比值偏移；详见逆向 |
| **照片 12.0** | **文档**确认图库照片查看；核对时要分单图、编辑渲染和导出的原片 | Apple **文档**支持 HDR 图片；这几份直接 PQ／HLG 未逐一导入、取样 | Apple **文档**有 Adaptive HDR 路径；旧式 Apple、ISO JPEG／AVIF 的逐文件图库行为与色差未测 |
| **预览 11.0** | **原生查看器**，底层 ImageIO 对 SDR 对照报告 1.00×；未比较五端 SDR 色准 | ImageIO **框架**结果不等于预览窗口实测，前台与失焦需分开 | 实际 **画面**中测试 JPEG 灰阶约 4×，红绿比例接近原件；沿哪条 native 路径见后文 |
| **QuickTime Player 10.5** | 不是通用照片查看基准 | 不以它的可打开行为判断静态 HDR 支持 | 不适用 |
{{< /codex-table >}}

**SDR 照片的第一反应应是找字节和色彩标记，而非开 HDR 开关。** 本地原图有 Display P3 ICC，网页若派生为未标记 JPEG 或把 P3 数值直接按 sRGB 写出，饱和色会先发生变化。两份 EXIF、裁剪和分辨率都相同的图仍可能有不同的 profile。对网页需核对实际响应，不能只看 HTML 里的初始 src。先用纯图和同一中灰背景，再试缩略图、编辑后渲染、浏览器 Canvas 或输出文件。Canvas 每次拷贝、默认缓冲区和导出的编码都是新路径。透明蒙层和显示背景会改变主观亮度，不能把它当像素颜色差异。

**直接 HDR 的对照要固定曲线与容器两条轴。** 用同一个源做 PQ 16-bit PNG、PQ AVIF、PQ HEIC，能定位「是 PQ」还是「这个载体」。再分别用 HLG 输入，不能把 PQ 码值重贴 HLG 标签进行比较。如果只是检查高光而非格式兼容，尽量拿同一母版、正确转码、匹配参考白的两份图。对 HLG 尤其不能要求它在不同目标显示上和 PQ 有一模一样的峰值及中间调。

**网页重建还有应用策略。** Chromium 的公开绘制路径在有增益图数据时调用 Skia 的增益图绘制，并把有效 headroom 传进去；另一分支可以对直接 HDR 图做 tone mapping。Safari 27 的公开变化则是把增益图重建移入 GPU 加速路径，两边不必共享同一个实现。CSS 的 “no-limit” 不限制到 SDR 白，但不承诺任何具体峰值；“standard” 会限到参考白，策略还可从祖先元素继承。应用同时有窗口焦点、缓存和是否使用中间位图等变量。**这些解释了可能出现差异的地方，不是 Chrome 对基图附件问题必然免疫的证据。** [Chromium 绘制代码](https://chromium.googlesource.com/chromium/src/+/HEAD/cc/paint/paint_op.cc) · [WebKit HDR 图片](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/#hdr-images) · [WebKit Safari 27](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/) · [W3C CSS HDR 限幅](https://www.w3.org/TR/css-color-hdr-1/#dynamic-range-limit)

### 原片、预览和图库不是同一件事

「预览」从文件直接进入查看路径，Finder 空格的 Quick Look 是另一应用入口。Apple 对「预览」明确提醒：当它和另一应用同时打开同一 HDR 图时，只有前台才会显示为 HDR。可靠的对照是**先后切到前台各取一次**，不是把两个窗口并排后读一个 SDR 截图。「照片」则从图库项进入，显示设置、单张或网格、原件或编辑版要各记一次。对测试可用独立图库、明确开启完整 HDR 显示，并导出「未修改的原片」核对哈希；普通导出或分享得到的副本不充当文件原件。本文没有修改任何个人图库。 [Apple 预览文档](https://support.apple.com/en-mide/guide/preview/prvw11470/mac) · [Apple 照片 HDR 能力](https://developer.apple.com/videos/play/wwdc2024/10177/?time=1104) · [Apple 照片导出指南](https://support.apple.com/guide/photos/export-photos-videos-slideshows-and-memories-pht6e157c5f/mac)

## 4. 视频 gap：BT.709、PQ 和 HLG 分开验，容器和输出也分开

{{< codex-table label="视频样片的播放和框架识别" >}}
| 样片 | Chrome 158 **浏览** | 系统 WKWebView **浏览** | AVFoundation **框架** |
| --- | --- | --- | --- |
| H.264／MP4 · BT.709 SDR | 可播 | 可播 | 可播，非 HDR 轨；首帧 BT.709 |
| HEVC Main10／MP4 · PQ HDR10 | 可播 | 可播 | 可播，有 HDR 轨；首帧 PQ、BT.2020 |
| HEVC Main10／MP4 · HLG | 可播 | 可播 | 可播，有 HDR 轨；首帧 HLG、BT.2020 |
| AV1 10-bit／MP4 · PQ | 可播（基线） | 可播（基线） | 基线可播，有 HDR 轨 |
| VP9 Profile 2／WebM · PQ | 可播（基线） | 可播（基线） | 基线接口打不开该文件 |
{{< /codex-table >}}

对前三个 MP4，11 月 26 日用同一套 640 × 360、2 秒的合成文件复验。Chrome 有有效画面尺寸，totalVideoFrames 计数均为 4。该计数包括显示和丢弃的帧。无窗口 WKWebView 未开始播放，按基线方法挂进独立后台测试窗口后，三份视频都有画面尺寸、缓冲就绪、播放时钟前进，但 totalVideoFrames 仍为 0。因此只将它记为兼容性通过，不作画面验收。AVAssetReader 实际取出一帧，像素缓冲附件里的原色、传递函数、YCbCr 矩阵和轨道描述一致。SDR 源仍是 8-bit，探针统一请求 10-bit YUV 输出只是为了检查附件，不会把 SDR 变成 HDR。PQ 文件另用 ffprobe 确认首帧带有母版与内容亮度信息，不能由此推出播放器用了这些元数据。 [W3C 播放质量计数定义](https://w3c.github.io/media-playback-quality/#videoplaybackquality)

**兼容性结果最有价值的对照不是「HDR vs SDR」，而是「同为 PQ，换个视频编码或容器」。** PQ HEVC、PQ AV1 在同机浏览器和 AVFoundation 基线都走通，PQ VP9／WebM 则是浏览器能播、系统文件接口未打开。QuickTime 不能播的根因可能在容器、编码或应用导入；不应从这个框架失败写成「该应用不支持所有 VP9」。「预览」不是影片播放基准。如果 Finder 空格能播那段素材，测到的是 Quick Look，不能填进「预览」列。

{{< codex-table label="视频的应用差距，区分播放与 HDR 显示" >}}
| 应用 | SDR BT.709 | PQ/HDR10、HLG HDR | 主要 gap |
| --- | --- | --- | --- |
| **Chrome 158** | H.264 MP4 **可播** | 这两份 HEVC MP4 **可播**。PQ AV1／VP9 基线也可播；未测实际亮度或动态元数据 | 网站选轨、MSE／直连、硬解和浏览器合成分支先于实际屏幕输出 |
| **Safari 27.2** | 系统 **WKWebView** 可播；未在 Safari 窗口重测视频 | 系统 **WKWebView** 可播 PQ／HLG，Safari 有通用 HDR 视频的 **文档** | Apple HLS 选轨、电源策略、全屏、AVFoundation/平台层等；不能把图片回归套到视频 |
| **QuickTime Player 10.5** | 用原片和影片检查器核对，**框架**读出 BT.709 帧 | **框架**实测两份 HEVC 有 HDR 轨并读出相应标签；未做 QuickTime 窗口 EDR 测量 | 文件直开，先验容器及轨道。检查器的 HDR 字样或位深不是屏幕读数 |
| **照片 12.0** | 用图库原片核对，Apple **文档**提供播放与编辑 | Apple **文档**明确可查看、播放和编辑 10-bit HLG；该组 PQ 和 HLG 未做图库窗口取样，不能判 PQ 不支持 | 导入与实际打开、预览与编辑、导出与原片是不同状态 |
| **预览 11.0** | 不作视频播放器验收 | 不适用 | Finder Quick Look 或其他播放器的能力不要归给「预览」 |
{{< /codex-table >}}

### SDR 视频，也会在哪些步骤变样

一份标准 BT.709 有限范围视频，看起来发灰，不宜第一步就改 gamma。确认文件里的 transfer、primaries、matrix 和 range 分别是什么；再确认解码后的像素缓冲及附件还在。以 8-bit 为例，有限范围 luma 的黑白典型码值为 16／235。若按全范围 0／255 解释，黑会被抬高、白不会到顶；反过来可能裁掉两端。中段偏差但黑白端点都对时，再考虑传递曲线、播放器映射、显示模式或母版。用已知有限范围的黑白阶和肤色／彩条检查，比比较两个来源不明的画面是否「更灰」可定位得多。不能直接拿编码域中的 Y′ 值当线性发光强度。 [Apple 文件色彩标记说明](https://developer.apple.com/av-foundation/High-Dynamic-Range-Metadata-for-Apple-Devices.pdf) · [ITU-R BT.709](https://www.itu.int/rec/R-REC-BT.709/en) · [ITU-R BT.1886](https://www.itu.int/rec/R-REC-BT.1886/en)

### PQ／HLG 视频真正拉开差距的地方

- **Chrome** 的 VideoToolbox 解码是一个阶段，像素最后是否进平台视频层以及以何种 headroom 合成是另一个阶段。Chromium 有过实录：部分帧尺寸的裁剪矩形不能通过严格比较，视频未提升到 AVSampleBufferDisplayLayer，于是能播却损失 HDR 余量。修复在 M158 开发构建得到验证，不是说本文稳定版必然仍受影响。排查时留存 chrome://media-internals 的播放器、解码器等信息，再比正常窗口、全屏与带覆层的同一帧。 [Chromium VideoToolbox 实现](https://chromium.googlesource.com/chromium/src/+/HEAD/media/gpu/mac/video_toolbox_video_decoder.cc) · [尺寸相关回归及修复](https://issues.chromium.org/issues/572225701) · [macOS 合成 headroom 实现变更](https://chromium.googlesource.com/chromium/src/+/b2dfc1900d044d6f9036d4a99eaad957aeb05106) · [Media Internals](https://www.chromium.org/audio-video/media-internals/)
- **Safari** 的站点体验首先受服务变体控制。HLS 推送给 Safari 和给 Chrome 的编码、色彩标记、码率、DRM 及 PQ／HLG 轨可能不同；有的服务在节能状态下还可能换到 SDR。Apple 新增 Dolby Vision 8.1 支持描述的是平台/HLS 能力，不是本文对站点、其他 Profile 或逐帧动态元数据应用的验证。先用两端同一个本地 HTTP MP4 排除选轨，再比较在线播放。 [Safari 14 HDR 视频](https://webkit.org/blog/11340/new-webkit-features-in-safari-14/) · [Safari 媒体节能策略](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/) · [Apple HLS 2026 更新](https://developer.apple.com/streaming/Whats-new-HLS.pdf)
- **QuickTime 与照片** 都可以利用 Apple 的媒体框架，但播放策略不必一致。AVFoundation 公布了 PQ/HLG 支持，AVKit 又有独立的首选显示动态范围 API，这正是「同一个解码帧，两个应用不必选同一个显示目标」的接口证据，不是对两个应用内部策略相同或不同的断言。QuickTime 是文件播放与检查基准，照片是导入、播放和编辑体验基准。遇到 iPhone HLG／杜比视界素材，先比较原片、编辑和导出，再分别核对兼容基础层和真正的显示输出。 [AVFoundation HDR 视频](https://developer.apple.com/videos/play/wwdc2020/10009/) · [AVKit 动态范围偏好](https://developer.apple.com/documentation/avkit/avplayerview/preferreddisplaydynamicrange) · [QuickTime 影片检查器](https://support.apple.com/guide/quicktime-player/view-information-about-a-movie-file-qtp65619118c/mac) · [照片对 HLG 视频的说明](https://support.apple.com/en-ie/guide/photos/phte8a1fcd79/mac)

<details>
<summary>查看「照片」和 QuickTime 的本机静态证据</summary>

同机应用执行文件的动态导入显示，QuickTime 链接 AVFoundation、AVKit、CoreMedia，导入 AVURLAsset、AVPlayer、AVPlayerItem、AVPlayerLayer 和 AVPlayerView。照片也链接 AVFoundation／AVKit 并导入 AVPlayer、AVPlayerItem、AVURLAsset，同时链接 PhotoLibraryServices 和 PhotosImagingFoundation，并导入 PHImageManager、PHVideoRequestOptions。这能解释为何「原文件播放器」和「图库请求」值得分成两条验收路径，但只是静态依赖，不告诉我们某个资源经过哪个内部方法，也不提供 PQ／HLG 的映射曲线。

</details>

## 5. 逆向实测：为什么 Safari 的 HDR 高光有亮度，颜色却更淡？ {#safari-hdr-gain-map-gap}

开启外接屏 HDR 后，macOS 报告的即时 EDR 从最初的 `1.20×` 升到测试时的 `6.30×`，潜在值是 `12.61×`。这次屏幕有余量，Safari 的 `(dynamic-range: high)` 也为真。接下来用六格中性灰和两个高亮红绿色块做对照，避免把「高光不够亮」和「高光颜色不够纯」混为一谈。 [Apple 对即时与潜在 EDR 的定义](https://developer.apple.com/documentation/metal/determining-support-for-edr-values)

### 先在真实窗口里把差异复现出来

同一张 **512 × 256 的 ISO RGB 增益图 JPEG**，默认 ImageIO 解码只用 SDR 基图，最亮灰块为 `1.000`；显式请求 HDR 后升到 `4.003`。同机 Core Image 显式展开也得到约 `4.00`。把原文件在 Safari 用普通 `<img>`、`dynamic-range-limit: no-limit` 显示，在「预览」直接打开。两边轮流到前台，用 macOS 原生 HDR HEIC 截图，在扩展线性 Display P3 中采样。**单独显示时，最亮灰块在两边都是 `4.003`，但 Safari 的红绿高光更接近中性。** 例如，绿块的 RGB 从「预览」的 `(0.263, 1.497, 0.450)` 变成 Safari 的 `(0.472, 1.464, 0.527)`。这不是 JPEG 只显示了 SDR 基图。 [Apple HDR 截屏说明](https://support.apple.com/zh-cn/102646) · [为什么要让「预览」在前台](https://support.apple.com/en-mide/guide/preview/prvw11470/mac)

再把这张 JPEG 和由**同一组色值**制作的直编码 Display P3 PQ PNG 放在 Safari 同一页、同一尺寸、同一背景，两排一起截。用次通道除以主通道描述这两个色块向中性偏移的程度，数值越大，说明该次通道的相对占比越高。这不是通用的感知饱和度或色差指标。这样比拿不同截图的整图亮度直接相减更可靠。

{{< codex-table label="系统 HDR 截图的线性颜色取样" >}}
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

这不是对 Safari 做过修补后再运行的验证，也不是所有 HDR 图片都会偏色的结论。这份原件是 P3 SDR 基图加 ISO RGB 增益图；目前没有批量测过 sRGB 基图、单通道增益图、HEIC／AVIF、其他 WebKit 构建和 Chrome 的同一输出。它也不同于 WebKit 曾修过的 RGB 增益图合并输出意外降到 8 位的问题。这里的目标缓冲区实测为 `RGhA`，只补基图附件即可在探针里恢复色彩。浏览器侧值得验证的修复是把原色彩空间传给基图缓冲区的创建函数，再用高亮 RGB 色块做回归，而不是只测灰阶。 [WebKit 的 8 位输出修复](https://github.com/WebKit/WebKit/commit/dfcca6f9900ac6564be76443848bf518bf8c4bf2)

[下载合成样本、同屏对照页、探针与原始取样数据](safari-hdr-lab.zip)。压缩包只含合成文件、代码和数值，没有桌面原截图。

## 6. 用相同输入复验，而不是凭「看起来更亮」

开始前先决定要回答哪一类问题。做格式验收时，能打开和时间前进就足够。确认合成阶段的 HDR，至少在扩展线性空间取同帧参考白与高光。要回答峰值或应用 A 比 B 亮多少 nit，就需要校准好的显示和仪器。系统 HDR 截图保留了合成结果中的颜色／亮度信息，但不是物理出光仪。建议这样排。

1. **锁源文件与路径。** 本地用 SHA-256。网页图片核对 currentSrc、网络响应和 MIME。视频记下实际变体、容器、codec／Profile、DRM、位深。别拿网页缩略图与本地原片比。图库应导出未修改原片，再做哈希与标签检查。
2. **文件先验，影片再看解码结果。** 图片看 ICC／cICP、基图与辅助图；遇到显示过白或偏色，再查看应用是否使用了这些数据。视频用 ffprobe 分别读 primaries、transfer、matrix、range 及帧级 side data。QuickTime 的 ⌘I 是速查，不是 HDR 显示计。
3. **把 HDR 打开后，记录屏幕和应用的状态。** 同一物理屏、同一模式、同一亮度、同一输入端口和背景。把外接 HDR 与节能状态记下来，分别记 EDR 即时值和潜在值。用前台单窗口做主复测，后续才改变焦点、窗口大小、缩放和全屏。不要把前后台结果拼成五端峰值排名。
4. **同一帧放三个参照。** 一块受控 SDR 白、多个中性高光阶，再加红绿等彩色高光和自然肤色。记录高光／白块比、是否剪切、彩色通道比例。灰阶有余量不代表颜色正确，换颜色后不要只看单个主通道的数。测物理亮度时再固定色块面积、显示时长和测量几何。
5. **每轮只换一个因素。** 照片先比较同一 P3 SDR 基图的有／无增益图，再加直接 PQ 对照；网页按普通 img、图片 CDN、Canvas 和复杂组件逐层跑。视频先直连同一 MP4，再试全屏、平台视频层、HLS/MSE、滤镜和字幕覆层。先搞清是解码、颜色解释还是合成发生变化，再做产品决策。

<details>
<summary>查看命令、可复现样片和证据缺口</summary>

检查 MP4/MOV 的轨道标签和前一秒内的帧级元数据。某些元数据并非每帧都有，诊断动态元数据时要扩大范围，不能一次没读到就断言不存在。

```bash
shasum -a 256 example.mp4
ffprobe -v error -select_streams v:0 -show_streams -of json example.mp4
ffprobe -v error -select_streams v:0 -read_intervals '%+1' \
  -show_frames -of json example.mp4
```

浏览器的媒体查询只反映测试环境报告的能力，不探测选中的素材是否成功按 HDR 渲染。扩展线性取样与 CSS 限幅需要另外观察。下面的探测也不能代替屏幕测量。

```js
({
  displayHdr: matchMedia('(dynamic-range: high)').matches,
  videoHdr: matchMedia('(video-dynamic-range: high)').matches,
  p3: matchMedia('(color-gamut: p3)').matches,
  cssLimit: CSS.supports('dynamic-range-limit', 'no-limit'),
})
```

- [格式与播放复验包](mac-media-gap-lab.zip)包含合成照片、合成 MP4、独立浏览器页、生成及探测脚本、系统和浏览器读数。这里的 HLG 图片不是重贴 PQ 标签，视频包括 BT.709、PQ HDR10 和 HLG 三份可独立验收的轨道。
- [Safari／预览逆向实验包](safari-hdr-lab.zip)包含 ISO RGB 增益图 JPEG、直接 PQ PNG、同窗对照页、窗口取样数据、静态调用锚点和重建探针。两个包都不含私人桌面截图、照片或图库。
- **缺口仍在。** 没做 Chrome 的 HDR 窗口取样，没有把每份图和视频都导入照片图库，也没测 QuickTime 的窗口亮度或 Safari 的真实窗口视频。没测杜比视界动态元数据、HDR10+、付费流媒体、完整 HLS 变体、全屏对同帧亮度的影响，以及不同硬件和显示模式的物理出光。不要把文档或框架通过写成这些项目已经通过。

</details>

## 7. 交付时怎么选

**图文网页**先保住一张色彩管理正确的 SDR 图。确实需要一份文件兼顾普通屏和 HDR 屏，再用经本地和 CDN 验证的 SDR 基图增益图 JPEG。验收至少要有灰阶和亮彩色两类。已知 Safari 27.2 在这份 RGB 增益图有色差，可把直接 PQ PNG 保留为小型技术对照；对生产照片，再按体积、受众浏览器和测得的输出选择直接 PQ AVIF 或单独的 SDR 版本。不要默认 HEIC 是通用网页交付格式，也不要用浏览器识别到 HDR 屏来证明增益图一定被正确应用。

**网页视频**保留一份独立校验过的 BT.709 SDR 交付，再准备经实测的 HDR 变体。基线可以先验 HEVC MP4 的 PQ HDR10 与 HLG，再根据分发站点和硬件选 AV1 或其他轨。分别校验真实选轨、硬件／软件解码、浏览器合成和系统显示。只要「能播」就放行，容易漏掉最难看出的错误：色度被稀释、高光被封在白底下，或者 Dolby Vision 只播出了兼容基础层。

**本地查看**用「预览」核对原始图片，用 QuickTime 核对原始 MP4/MOV，用「照片」核对导入、单图／播放、编辑和导出的真实使用体验。三个入口各有参考价值，没有任何一个能单独作为另两个的色彩真值。

回到最初那张图，最值得保留的结果不是 Safari 和「预览」谁更讨喜，而是我们用**同一原件、同帧对照、静态链路和单变量实验**把问题缩到一处颜色附件。以后遇到类似 gap，先确认在哪一层分开，再谈哪个应用画得对。
