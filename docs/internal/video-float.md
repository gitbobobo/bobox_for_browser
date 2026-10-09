# 视频悬浮窗（video-float）

## 交互模型

悬浮窗不是自动开关：popup 开关只控制「悬停按钮」入口的出现与否（默认关），悬浮窗本身永远由用户点击视频上的「悬浮窗」按钮触发。点击是真实用户手势，天然满足 PiP 的 transient activation 要求——从 popup 或快捷键经消息通道触发拿不到 activation，所以入口只能放在页面里。

## API 选择

- 优先 `window.documentPictureInPicture`（Chrome 116+）：置顶窗口内容由扩展自绘，才能提供播放/暂停、进度、音量、倍速控制条。
- 回退 `video.requestPictureInPicture()`：原生画中画，控制由浏览器提供（也满足"悬浮在其他应用上面"）。
- 两者都没有则不显示按钮。

## 已知的真实限制

- **pip 文档继承页面 CSP**：页面无 `style-src 'unsafe-inline'` 时 `<style>` 会被拦，所以悬浮窗内全部样式走 CSSOM（`el.style` 赋值），与 `x-autoplay/play-overlay.ts` 一致。
- **播放器遮罩层**：B 站等在 `<video>` 上盖了多层 overlay，pointer 事件 target 打不到 video。悬停检测用几何法：`pointermove` 取坐标，对候选 video 的 `getBoundingClientRect` 做包含测试。
- **video 跨 document 移动**：播放状态保留（监听器挂在元素上），原页面插入 `data-bobox-pip-placeholder` 占位防布局塌陷；pip `pagehide` 时 `placeholder.replaceWith(video)` 还原。播放器重建子树（切清晰度、换 P）会把占位一起删掉——此时退回打开时记下的 `parent`/`nextSibling` 插回去，保证视频回到页面文档而不是随悬浮窗销毁。
- **doc-PiP 单例**：浏览器只允许一个 doc-PiP 窗口；对另一个视频开悬浮窗前先关旧会话。
- **范围**：content script 匹配 `*://*/*` 但只在顶层框架跑，iframe 内视频不支持。
- **悬浮窗生命周期绑定 opener**：源标签页关闭/导航时悬浮窗随之关闭。

## 验证

- `pnpm verify:float`（`scripts/verify-video-float.mjs`）：headed Chromium + `dist/chrome-mv3`，真实 bilibili.com。B 站拒绝 HeadlessChrome 且 doc-PiP 需要真实窗口管理器，必须 headed。
- PiP 窗口截图：它是独立 OS 窗口，Playwright 里通过 `context.pages()` 按 title「Bobox 悬浮窗」找到后可 screenshot；全屏 `screencapture` 会拍到用户其他窗口，不要用。
