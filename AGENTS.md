# Bobox for Browser

Chromium 浏览器扩展（MV3），Bobox 工具箱的浏览器端兄弟项目。WXT + React 19 + Tailwind v4 + TypeScript。UI 以中文为主。

## Commands

```bash
pnpm install        # 安装依赖（postinstall 会跑 wxt prepare）
pnpm dev            # wxt dev（开发）
pnpm build          # 构建到 dist/chrome-mv3（Chrome「加载已解压的扩展程序」选这个目录）
pnpm zip            # 构建并打成 zip：dist/bobox-for-browser-<版本>-chrome.zip
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest 单元测试
pnpm verify:x       # 构建 + 对真实 x.com 跑端到端验证
# 前置：pnpm exec playwright install chromium；脚本会故意打开可见的 Chromium 窗口（x.com 拒绝无头浏览器）
```

## Structure

- `src/entrypoints/` — WXT 入口：`popup/`（弹窗 UI）、`x-autoplay-main.content.ts`（MAIN world 拦截器）、`x-autoplay-bridge.content.ts`（ISOLATED world，读写 storage 并转发开关状态）
- `src/tools/registry.ts` — 工具清单（无 React 依赖）；`src/tools/<id>/` 放各工具的 constants/settings/逻辑/测试
- `src/components/`、`src/hooks/` — popup 复用组件（如 `useStorageItem`）
- `public/icon/` — 扩展图标
- `scripts/verify-x-autoplay.mjs` — 真实 x.com 的验证脚本，X 改版后重跑它

## 新增一个工具

1. `src/tools/<id>/settings.ts` 里用 `storage.defineItem` 定义开关（`local:tools.<id>.enabled`，fallback 自定）。
2. 在 `src/tools/registry.ts` 的 `tools` 数组加一项（`sites` 用于 popup 展示）。
3. 需要页面能力时写 content script 入口；popup 里的工具图标按 `id` 映射，registry 不引 React。

## X 视频拦截工具的设计要点

- 目标：x.com 的视频/GIF 不自动加载也不自动播放，点击后正常播放，省流量。
- 只拦截 `play()` 没用：X 的 hls.js 在 `video.play()` 被拒后仍会把整个视频缓冲完（实测一条 90 秒视频约 12MB 照下）。真正有效的是**推迟 `video.src` 赋值**——hls.js 把 MediaSource blob URL 设到 `src` 时先扣住，hls.js 只会预取一个分片；用户点击后再补设。
- 解锁条件：`pointerdown/pointerup` 坐标落在该 video 的 rect 内，或 `Enter`/空格的焦点元素的 rect 完整落在该 video 的 rect 内（2px 容差，1 秒手势窗口）。防 X 的 j/k 键盘导航或点到别处误解锁。
- 扣住 `src` 时，在播放器上覆盖“点击加载并播放”按钮，避免 X 一直显示加载中。真实点击或 Enter/空格直接补设 `src` 并调用原生 `play()`，不依赖 X 再调用 `play()`；首次播放动作由扩展消费，防止 X 的点击处理器把刚开始的视频又暂停。
- MAIN world 脚本在 `document_start` 同步打补丁（`HTMLVideoElement.prototype` 上 shadow `src`/`play`/`setAttribute`/`removeAttribute`）；ISOLATED 的 bridge 读 storage，用 `CustomEvent` 握手（main 发 request、bridge 发 state，先后加载都覆盖）。
- 另一安全网：捕获阶段监听 `play` 事件，无手势就 `pause()`（覆盖 `autoplay` 属性和原生控件路径）。
- `pnpm verify:x` 打真实 x.com（未登录态）：HLS 视频 blocked 场景应 ≤4 个 `.m4s` / <512KB，关闭后恢复 X 默认（≥10 个 / >2MB）；另含 GIF 场景（`tweet_video` 直链 mp4，blocked 时 0 请求，点击后加载播放），URL 可用 `X_VERIFY_URL` / `X_VERIFY_GIF_URL` 覆盖。
- 依赖安全：`pnpm-workspace.yaml` 设 `minimumReleaseAge: 10080`，只装发布满 7 天的版本，加依赖时注意别被卡到旧版。
