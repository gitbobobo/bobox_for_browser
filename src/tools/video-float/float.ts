// Floating window for page videos. Prefers Document Picture-in-Picture with
// controls drawn into the pip document; falls back to the browser's native
// video PiP when the document variant is missing. All styling goes through
// CSSOM so strict page CSP (no style-src 'unsafe-inline') cannot break it.

type Win = Window & typeof globalThis;

// Document PiP is not in the TS DOM lib yet.
interface DocumentPictureInPicture {
  readonly window: Window | null;
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
// Below this size a video is more likely a preview/ad than real content.
const MIN_RECT_W = 240;
const MIN_RECT_H = 135;
const CONTROLS_HIDE_MS = 2500;
const TOAST_MS = 2000;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

type IconPart = readonly [d: string, stroke?: boolean];
const ICON_PLAY: IconPart[] = [['M7 4.5v15l12-7.5z']];
const ICON_PAUSE: IconPart[] = [['M6 4h4v16H6zM14 4h4v16h-4z']];
const SPEAKER = 'M4 9.5v5h3.5L12 19V5L7.5 9.5H4z';
const ICON_VOLUME: IconPart[] = [
  [SPEAKER],
  ['M15.5 9a4.2 4.2 0 0 1 0 6', true],
];
const ICON_MUTED: IconPart[] = [
  [SPEAKER],
  ['M16 9.5l5 5M21 9.5l-5 5', true],
];
const ICON_CLOSE: IconPart[] = [['M6 6l12 12M18 6L6 18', true]];

interface PipSession {
  video: HTMLVideoElement;
  pipWin: Window;
  placeholder: HTMLElement;
  parent: Node | null;
  nextSibling: Node | null;
  inlineStyle: string | null;
  hadControls: boolean;
  restored: boolean;
  dispose: (() => void)[];
}

const inRect = (r: DOMRect, x: number, y: number) =>
  x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

const fmtTime = (t: number) => {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const s = Math.floor(t % 60);
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

function makeIcon(doc: Document, parts: IconPart[], size = 16): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [d, stroke] of parts) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    if (stroke) {
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
    } else {
      path.setAttribute('fill', 'currentColor');
    }
    svg.append(path);
  }
  return svg;
}

export function installVideoFloat(win: Win) {
  const doc = win.document;
  const rawDocPip = (win as { documentPictureInPicture?: DocumentPictureInPicture })
    .documentPictureInPicture;
  const docPip = typeof rawDocPip?.requestWindow === 'function' ? rawDocPip : undefined;
  const nativePipSupported =
    typeof win.HTMLVideoElement.prototype.requestPictureInPicture === 'function' &&
    doc.pictureInPictureEnabled !== false;
  const supported = docPip !== undefined || nativePipSupported;

  const videos = new Set<HTMLVideoElement>();
  let enabled = false;
  let destroyed = false;
  let observing = false;
  let lastPoint: { x: number; y: number } | null = null;
  let hoverVideo: HTMLVideoElement | null = null;
  let button: HTMLButtonElement | null = null;
  let toastEl: HTMLElement | null = null;
  let session: PipSession | null = null;
  // Bumped by every open/close so an in-flight requestWindow resolving late
  // can tell its window is already superseded.
  let openSeq = 0;

  // Players like bilibili cover <video> with an overlay so hit-testing via
  // event targets never reaches it; geometry against live rects does.
  const floatable = (v: HTMLVideoElement) =>
    v.ownerDocument === doc &&
    v.isConnected &&
    v !== session?.video &&
    v !== doc.pictureInPictureElement &&
    (docPip !== undefined || !v.disablePictureInPicture);

  const videoAt = (x: number, y: number): HTMLVideoElement | null => {
    for (const v of videos) {
      if (!v.isConnected || v.ownerDocument !== doc) {
        videos.delete(v);
        continue;
      }
      if (!floatable(v)) continue;
      const r = v.getBoundingClientRect();
      if (r.width < MIN_RECT_W || r.height < MIN_RECT_H) continue;
      if (inRect(r, x, y)) return v;
    }
    return null;
  };

  // Players can hide <video> inside open shadow roots; querySelectorAll does
  // not descend into them, so every discovered root gets scanned and observed
  // on its own. Closed roots stay out of reach by design.
  const watchRoot = (root: ParentNode) => {
    if (observing) observer.observe(root, { childList: true, subtree: true });
    for (const v of root.querySelectorAll('video')) videos.add(v);
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) watchRoot(el.shadowRoot);
    }
  };
  const addVideos = (node: Node) => {
    if (node instanceof win.HTMLVideoElement) videos.add(node);
    else if (node instanceof win.Element) {
      for (const v of node.querySelectorAll('video')) videos.add(v);
      if (node.shadowRoot) watchRoot(node.shadowRoot);
      for (const el of node.querySelectorAll('*')) {
        if (el.shadowRoot) watchRoot(el.shadowRoot);
      }
    }
  };
  const dropVideos = (node: Node) => {
    if (node instanceof win.HTMLVideoElement) videos.delete(node);
    else if (node instanceof win.Element) {
      for (const v of node.querySelectorAll('video')) videos.delete(v);
    }
  };
  const observer = new win.MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) addVideos(n);
      for (const n of r.removedNodes) dropVideos(n);
    }
  });
  const startObserving = () => {
    if (observing) return;
    observing = true;
    watchRoot(doc);
  };
  const stopObserving = () => {
    observer.disconnect();
    observing = false;
    videos.clear();
  };

  const hideButton = () => {
    if (button) button.style.display = 'none';
    hoverVideo = null;
  };

  const onButtonClick = (e: MouseEvent) => {
    e.stopPropagation();
    const v = (lastPoint && videoAt(lastPoint.x, lastPoint.y)) ?? hoverVideo;
    if (v) void openFloat(v);
  };

  const ensureButton = () => {
    if (button) return button;
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.testid = 'bobox-video-float';
    b.setAttribute('aria-label', '悬浮窗');
    b.title = '悬浮窗';
    const icon = makeIcon(
      doc,
      [
        ['M4 5.5h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z', true],
        ['M13 12.8h6.2v4.4H13z'],
      ],
      14,
    );
    const label = doc.createElement('span');
    label.textContent = '悬浮窗';
    b.append(icon, label);
    Object.assign(b.style, {
      position: 'fixed',
      zIndex: '2147483647',
      display: 'none',
      alignItems: 'center',
      gap: '5px',
      padding: '6px 11px',
      border: '0',
      borderRadius: '999px',
      background: 'rgba(24,24,27,.82)',
      color: '#fff',
      font: '12px/1.4 system-ui, sans-serif',
      cursor: 'pointer',
      boxShadow: '0 2px 10px rgba(0,0,0,.35)',
    });
    b.addEventListener('click', onButtonClick);
    doc.body.append(b);
    button = b;
    return b;
  };

  const updateButton = () => {
    const pt = lastPoint;
    let v = enabled && supported && pt ? videoAt(pt.x, pt.y) : null;
    // The button overlaps the video's top-right corner; keep it alive while the
    // pointer is on it even when that spot is outside the video rect.
    if (!v && pt && button && hoverVideo && floatable(hoverVideo)) {
      if (inRect(button.getBoundingClientRect(), pt.x, pt.y)) v = hoverVideo;
    }
    hoverVideo = v;
    if (!v || !enabled || !supported) {
      if (button) button.style.display = 'none';
      return;
    }
    const b = ensureButton();
    const r = v.getBoundingClientRect();
    b.style.top = `${Math.max(r.top, 0) + 8}px`;
    b.style.right = `${Math.max(win.innerWidth - r.right, 0) + 8}px`;
    b.style.display = 'flex';
  };

  const showToast = (video: HTMLVideoElement) => {
    toastEl?.remove();
    const el = doc.createElement('div');
    el.dataset.boboxVideoFloatToast = '';
    el.textContent = '无法开启悬浮窗';
    const r = video.getBoundingClientRect();
    Object.assign(el.style, {
      position: 'fixed',
      zIndex: '2147483647',
      pointerEvents: 'none',
      left: `${r.left + r.width / 2}px`,
      top: `${r.top + r.height / 2}px`,
      transform: 'translate(-50%,-50%)',
      padding: '8px 14px',
      borderRadius: '8px',
      background: 'rgba(0,0,0,.85)',
      color: '#fff',
      font: '13px system-ui, sans-serif',
    });
    doc.body.append(el);
    toastEl = el;
    win.setTimeout(() => {
      el.remove();
      if (toastEl === el) toastEl = null;
    }, TOAST_MS);
  };

  // Puts the moved-out video back where it was. Idempotent: also called from
  // the pip window's pagehide, which fires when the user closes it themselves.
  const finishSession = (s: PipSession) => {
    if (session === s) session = null;
    if (s.restored) return;
    s.restored = true;
    for (const d of s.dispose) d();
    // Players rebuild their subtree (quality switch, episode change) and drop
    // the placeholder; fall back to the recorded parent so the video returns
    // to the page document instead of dying with the closed pip window.
    if (s.placeholder.isConnected) s.placeholder.replaceWith(s.video);
    else if (s.parent?.isConnected) {
      s.parent.insertBefore(
        s.video,
        s.nextSibling?.parentNode === s.parent ? s.nextSibling : null,
      );
    }
    if (s.inlineStyle === null) s.video.removeAttribute('style');
    else s.video.style.cssText = s.inlineStyle;
    s.video.controls = s.hadControls;
  };

  // Only closes sessions this tool opened. Toggle-off/destroy must not kill a
  // PiP window the page or the user opened on their own.
  const closeCurrent = () => {
    openSeq += 1;
    const s = session;
    session = null;
    if (s) {
      finishSession(s);
      try {
        s.pipWin.close();
      } catch {}
    }
  };

  function buildPipWindow(video: HTMLVideoElement, pipWin: Window): PipSession {
    const pipDoc = pipWin.document;
    const dispose: (() => void)[] = [];
    pipDoc.title = 'Bobox 悬浮窗';
    Object.assign(pipDoc.documentElement.style, { height: '100%' });
    Object.assign(pipDoc.body.style, {
      margin: '0',
      height: '100%',
      background: '#000',
      overflow: 'hidden',
    });

    // Placeholder keeps the layout slot while the video lives in the pip doc.
    const rect = video.getBoundingClientRect();
    const placeholder = doc.createElement('div');
    placeholder.dataset.boboxPipPlaceholder = '';
    placeholder.textContent = '视频正在悬浮窗播放';
    Object.assign(placeholder.style, {
      boxSizing: 'border-box',
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#000',
      color: 'rgba(255,255,255,.7)',
      font: '13px system-ui, sans-serif',
    });
    const inlineStyle = video.getAttribute('style');
    const hadControls = video.controls;
    const parent = video.parentNode;
    const nextSibling = video.nextSibling;
    parent?.insertBefore(placeholder, video);

    video.controls = false;
    video.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:block';

    const mkBtn = (label: string, ctrl: string) => {
      const b = pipDoc.createElement('button');
      b.type = 'button';
      b.dataset.boboxCtrl = ctrl;
      b.setAttribute('aria-label', label);
      b.title = label;
      Object.assign(b.style, {
        padding: '4px',
        border: '0',
        background: 'transparent',
        color: '#fff',
        cursor: 'pointer',
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
      });
      return b;
    };
    const setIcon = (b: HTMLButtonElement, parts: IconPart[]) => {
      b.replaceChildren(makeIcon(pipDoc, parts));
    };

    const playBtn = mkBtn('播放', 'toggle');
    const tcur = pipDoc.createElement('span');
    const tdur = pipDoc.createElement('span');
    for (const t of [tcur, tdur]) {
      Object.assign(t.style, {
        color: '#fff',
        font: '12px/1 system-ui, sans-serif',
        fontVariantNumeric: 'tabular-nums',
        minWidth: '36px',
        textAlign: 'center',
        flex: 'none',
      });
    }
    const seek = pipDoc.createElement('input');
    seek.type = 'range';
    seek.min = '0';
    seek.max = '0';
    seek.step = '0.1';
    seek.value = '0';
    seek.dataset.boboxCtrl = 'seek';
    seek.setAttribute('aria-label', '播放进度');
    Object.assign(seek.style, {
      flex: '1',
      minWidth: '0',
      accentColor: '#fff',
      cursor: 'pointer',
    });
    const muteBtn = mkBtn('静音', 'mute');
    const vol = pipDoc.createElement('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '1';
    vol.step = '0.05';
    vol.value = '1';
    vol.dataset.boboxCtrl = 'volume';
    vol.setAttribute('aria-label', '音量');
    Object.assign(vol.style, {
      width: '64px',
      accentColor: '#fff',
      cursor: 'pointer',
      flex: 'none',
    });
    const rate = pipDoc.createElement('select');
    rate.dataset.boboxCtrl = 'rate';
    rate.setAttribute('aria-label', '倍速');
    for (const r of RATES) {
      const o = pipDoc.createElement('option');
      o.value = String(r);
      o.textContent = `${r}x`;
      rate.append(o);
    }
    rate.value = '1';
    Object.assign(rate.style, {
      background: 'rgba(255,255,255,.14)',
      color: '#fff',
      border: '0',
      borderRadius: '4px',
      padding: '2px 4px',
      font: '12px system-ui, sans-serif',
      flex: 'none',
    });
    const closeBtn = mkBtn('关闭悬浮窗', 'close');

    const bar = pipDoc.createElement('div');
    Object.assign(bar.style, {
      position: 'fixed',
      left: '0',
      right: '0',
      bottom: '0',
      zIndex: '1',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '10px 12px 8px',
      background: 'linear-gradient(rgba(0,0,0,0), rgba(0,0,0,.85) 45%)',
      transition: 'opacity .2s',
      opacity: '1',
    });
    bar.append(playBtn, tcur, seek, tdur, muteBtn, vol, rate, closeBtn);

    const syncPlay = () => {
      setIcon(playBtn, video.paused ? ICON_PLAY : ICON_PAUSE);
      const label = video.paused ? '播放' : '暂停';
      playBtn.setAttribute('aria-label', label);
      playBtn.title = label;
    };
    let seeking = false;
    const syncTime = () => {
      tcur.textContent = fmtTime(video.currentTime);
      tdur.textContent = fmtTime(video.duration);
      if (Number.isFinite(video.duration)) seek.max = String(video.duration);
      if (!seeking) seek.value = String(video.currentTime);
    };
    const syncVolume = () => {
      setIcon(muteBtn, video.muted || video.volume === 0 ? ICON_MUTED : ICON_VOLUME);
      vol.value = String(video.muted ? 0 : video.volume);
    };
    const syncRate = () => {
      const v = String(video.playbackRate);
      // Sites can set odd rates (1.33x); keep the select honest.
      if (![...rate.options].some((o) => o.value === v)) {
        const o = pipDoc.createElement('option');
        o.value = v;
        o.textContent = `${video.playbackRate}x`;
        rate.append(o);
      }
      rate.value = v;
    };

    playBtn.addEventListener('click', () => {
      if (video.paused) {
        try {
          void video.play()?.catch(() => {});
        } catch {}
      } else {
        video.pause();
      }
    });
    seek.addEventListener('input', () => {
      video.currentTime = Number(seek.value);
    });
    seek.addEventListener('pointerdown', () => {
      seeking = true;
    });
    const releaseSeek = () => {
      seeking = false;
    };
    pipWin.addEventListener('pointerup', releaseSeek);
    dispose.push(() => pipWin.removeEventListener('pointerup', releaseSeek));
    muteBtn.addEventListener('click', () => {
      video.muted = !video.muted;
    });
    vol.addEventListener('input', () => {
      video.volume = Number(vol.value);
      if (video.volume > 0) video.muted = false;
    });
    rate.addEventListener('change', () => {
      video.playbackRate = Number(rate.value);
    });
    closeBtn.addEventListener('click', () => pipWin.close());

    const on = <K extends keyof HTMLMediaElementEventMap>(
      type: K,
      fn: (e: HTMLMediaElementEventMap[K]) => void,
    ) => {
      video.addEventListener(type, fn);
      dispose.push(() => video.removeEventListener(type, fn));
    };
    on('play', syncPlay);
    on('pause', syncPlay);
    on('timeupdate', syncTime);
    on('durationchange', syncTime);
    on('loadedmetadata', syncTime);
    on('volumechange', syncVolume);
    on('ratechange', syncRate);
    syncPlay();
    syncTime();
    syncVolume();
    syncRate();

    // Controls fade after a few idle seconds; any pointer move brings them back.
    let hideTimer = 0;
    const showBar = () => {
      bar.style.opacity = '1';
      bar.style.pointerEvents = 'auto';
      pipWin.clearTimeout(hideTimer);
      hideTimer = pipWin.setTimeout(() => {
        bar.style.opacity = '0';
        bar.style.pointerEvents = 'none';
      }, CONTROLS_HIDE_MS);
    };
    pipWin.addEventListener('pointermove', showBar);
    dispose.push(() => {
      pipWin.clearTimeout(hideTimer);
      pipWin.removeEventListener('pointermove', showBar);
    });
    showBar();

    pipDoc.body.append(video, bar);
    return {
      video, pipWin, placeholder, parent, nextSibling,
      inlineStyle, hadControls, restored: false, dispose,
    };
  }

  const openFloat = async (video: HTMLVideoElement) => {
    if (!enabled || !supported || !floatable(video)) return;
    closeCurrent();
    const seq = openSeq;
    hideButton();
    // A foreign PiP window still blocks the request below; the user just asked
    // to float this video, so taking over the slot matches their intent.
    try {
      docPip?.window?.close();
    } catch {}
    try {
      void doc.exitPictureInPicture?.().catch(() => {});
    } catch {}
    if (docPip) {
      const r = video.getBoundingClientRect();
      const aspect =
        video.videoWidth > 0 && video.videoHeight > 0
          ? video.videoWidth / video.videoHeight
          : r.height > 0
            ? r.width / r.height
            : 16 / 9;
      const width = Math.round(Math.min(640, Math.max(360, r.width || 480)));
      try {
        const pipWin = await docPip.requestWindow({
          width,
          height: Math.round(width / aspect),
        });
        if (!enabled || destroyed || seq !== openSeq) {
          pipWin.close();
          return;
        }
        const s = buildPipWindow(video, pipWin);
        session = s;
        pipWin.addEventListener('pagehide', () => finishSession(s), { once: true });
      } catch {
        showToast(video);
      }
      return;
    }
    try {
      await video.requestPictureInPicture();
      if (seq !== openSeq) void doc.exitPictureInPicture?.().catch(() => {});
    } catch {
      showToast(video);
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!enabled || !supported) return;
    lastPoint = { x: e.clientX, y: e.clientY };
    updateButton();
  };
  const onScroll = () => updateButton();
  const onLeaveDoc = () => {
    lastPoint = null;
    updateButton();
  };

  win.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  win.addEventListener('scroll', onScroll, { capture: true, passive: true });
  win.addEventListener('resize', onScroll, { passive: true });
  doc.documentElement.addEventListener('mouseleave', onLeaveDoc);

  return {
    setEnabled(value: boolean) {
      enabled = value;
      if (enabled) {
        startObserving();
      } else {
        stopObserving();
        lastPoint = null;
        hideButton();
        closeCurrent();
      }
    },
    destroy() {
      destroyed = true;
      enabled = false;
      stopObserving();
      closeCurrent();
      toastEl?.remove();
      toastEl = null;
      button?.remove();
      button = null;
      hoverVideo = null;
      win.removeEventListener('pointermove', onPointerMove, true);
      win.removeEventListener('scroll', onScroll, true);
      win.removeEventListener('resize', onScroll);
      doc.documentElement.removeEventListener('mouseleave', onLeaveDoc);
    },
  };
}
