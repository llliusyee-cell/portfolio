# CharacterWidget v1.0

首页角色的“五层眼睛”组件：固定眼白 + 独立虹膜 + 眼部阴影 + 去眼角色底图 + 眨眼覆盖帧。
素材来自 `eys.psd` 的 2730×1536 导出层，逻辑沿用 V30（15ms 帧、50ms 闭眼停留、120ms 平滑、15% 双眨眼）。

## 图层顺序（不可调）

| # | 文件 | 作用 |
|---|---|---|
| 1 | `assets/eye-white.webp` | 固定眼白 |
| 2 | `assets/iris-left.webp` + `assets/iris-right.webp` | 左右虹膜，整层同步平移，保留各自初始位置 |
| 3 | `assets/eye-shadow.webp` | 固定眼部阴影，覆盖虹膜 |
| 4 | `assets/character-clean.webp` | 去掉眼睛的角色底图（眼睛处透明） |
| 5 | `assets/blink-01.webp` … `blink-04.webp` | 眨眼覆盖，始终最上层；全隐藏 = 睁眼 |

> 文档里说的“5 层”是 5 个功能层；第 2 层有左右两张图，第 5 层有 4 张关键帧，所以 DOM 里一共 9 张 `<img>`。

## 文件

```
character-widget/
├── CharacterWidget.js
├── CharacterWidget.css
├── demo.html
├── README.md
└── assets/
    ├── character-clean.webp
    ├── eye-white.webp
    ├── iris-left.webp
    ├── iris-right.webp
    ├── eye-shadow.webp
    └── blink-01.webp … blink-04.webp
```

## 接入

```html
<link rel="stylesheet" href="character-widget/CharacterWidget.css">

<div class="hero-media">
  <div class="cw-root" data-character-widget data-cw-video="#hv" data-cw-track="#s0" aria-hidden="true">
    <img class="cw-layer" data-cw="white" src="character-widget/assets/eye-white.webp" alt="" draggable="false">
    <img class="cw-layer cw-iris" data-cw="iris-left" src="character-widget/assets/iris-left.webp" alt="" draggable="false">
    <img class="cw-layer cw-iris" data-cw="iris-right" src="character-widget/assets/iris-right.webp" alt="" draggable="false">
    <img class="cw-layer" data-cw="shadow" src="character-widget/assets/eye-shadow.webp" alt="" draggable="false">
    <img class="cw-layer" data-cw="character" src="character-widget/assets/character-clean.webp" alt="" draggable="false">
    <img class="cw-layer cw-blink" data-cw="blink-1" src="character-widget/assets/blink-01.webp" alt="" draggable="false" hidden>
    <img class="cw-layer cw-blink" data-cw="blink-2" src="character-widget/assets/blink-02.webp" alt="" draggable="false" hidden>
    <img class="cw-layer cw-blink" data-cw="blink-3" src="character-widget/assets/blink-03.webp" alt="" draggable="false" hidden>
    <img class="cw-layer cw-blink" data-cw="blink-4" src="character-widget/assets/blink-04.webp" alt="" draggable="false" hidden>
  </div>
  <video class="hv" id="hv" ...></video>
</div>

<script src="character-widget/CharacterWidget.js"></script>
```

- `data-cw-video`：可选。传入后，视频 `playing` 时组件暂停，`ended`/`error` 时恢复并回到睁眼。
- `data-cw-track`：可选。鼠标/触摸监听范围，默认取最近的 `section`；首页传 `#s0`，这样指针在文字/按钮上也能追踪。
- 组件在 `DOMContentLoaded` 自动初始化；重复初始化会被 `root.__cw` 拦住。

## 选项

```js
new CharacterWidget(root, {
  autoBlink: true,
  gazeTracking: true,
  idleGaze: true,
  blinkSpeed: 15,          // 单帧 ms，闭眼帧固定停留 50ms
  doubleBlinkChance: 0.15,
  maxX: 7, maxY: 5,        // 2048 参考坐标，内部换算到 2730
  idleX: 1.05, idleY: 0.6,
  smoothing: 120,          // ms
  interval: 6000,          // 随机眨眼上限；实际 2.8–6s
  video: null,             // <video> 或选择器
  trackRoot: null,         // 监听范围
  clickToBlink: true,
  respectReducedMotion: true
});
```

## 行为

- 眨眼：`[1,2,3,4,3,2,1,0]`，15ms/帧，第 4 帧停留 50ms；双眨眼间隔 130ms。
- 视线：指针在 `trackRoot` 内的位置归一化到 ±1，乘 7/5（2048 坐标）；`requestAnimationFrame` + 时间常数 120ms，帧率无关。
- 眨眼期间冻结眼球位置；睁开后平滑追向当前目标。
- 闲置：指针停止 2.2s 后，每 1.45–3.75s 出现 ±1.05/±0.6 的微偏移；指针一动立即恢复。
- 页面隐藏、组件离开视口、视频播放中都会暂停；恢复时回到睁眼。
- `prefers-reduced-motion: reduce` 时关闭自动眨眼/闲置微视线，保留鼠标驱动的视线。

## 性能 / 约束

- 无依赖、无 iframe、CSS 全部限定在 `.cw-root` 下，不改全局样式。
- 9 张 2730×1536 WebP，合计约 1.3MB；眨眼帧只切换 `hidden`，不重新下载。
- 只做 `transform`，不触发布局；容器尺寸变化由 `ResizeObserver` 重算缩放。
- 角色底图的眼洞必须由下面四层填住；不要把它直接叠在带眼睛的原图上。
- 素材不可重新生成、不可改眼型/高光；只允许换编码/裁切，且保持 2730 坐标对齐。

## 销毁

```js
root.__cw.destroy();
```

移除指针/可见性/视频监听，取消 rAF 和定时器，断开观察器。
