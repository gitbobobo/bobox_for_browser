import { createPlayOverlay } from './play-overlay';

export const GESTURE_WINDOW_MS = 1000;

export interface AutoplayBlockerOptions {
  isTrustedGesture?: (e: Event) => boolean;
}

export interface AutoplayBlocker {
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;
}

type Gesture =
  | { kind: 'pointer'; x: number; y: number; at: number }
  | { kind: 'key'; target: EventTarget | null; at: number };

const INSTALLED = Symbol.for('bobox.x-autoplay.blocker');

export function installAutoplayBlocker(
  win: Window & typeof globalThis,
  options?: AutoplayBlockerOptions,
): AutoplayBlocker {
  const existing = (win as unknown as Record<symbol, AutoplayBlocker>)[INSTALLED];
  if (existing) return existing;

  const isTrustedGesture = options?.isTrustedGesture ?? ((e: Event) => e.isTrusted);
  const videoProto = win.HTMLVideoElement.prototype;
  const mediaProto = win.HTMLMediaElement.prototype;
  const elementProto = win.Element.prototype;
  const origPlay = mediaProto.play;
  const origPause = mediaProto.pause;
  const srcDesc = Object.getOwnPropertyDescriptor(mediaProto, 'src')!;
  const origSetAttribute = elementProto.setAttribute;
  const origRemoveAttribute = elementProto.removeAttribute;
  const origGetAttribute = elementProto.getAttribute;

  const pending = new WeakMap<HTMLVideoElement, string>();
  const activated = new WeakSet<HTMLVideoElement>();
  const overlays = new WeakMap<HTMLVideoElement, HTMLButtonElement>();
  let enabled = true;
  let lastGesture: Gesture | null = null;

  const shouldDefer = (v: HTMLVideoElement) => enabled && !activated.has(v);
  const removeOverlay = (v: HTMLVideoElement) => {
    overlays.get(v)?.remove();
    overlays.delete(v);
  };
  const showOverlay = (v: HTMLVideoElement) => {
    if (!v.isConnected || !shouldDefer(v) || !pending.has(v)) return;
    const host = v.closest('[data-testid="videoComponent"]') ?? v.parentElement;
    if (!host || overlays.get(v)?.parentElement === host) return;
    removeOverlay(v);
    const button = createPlayOverlay(v);
    overlays.set(v, button);
    host.append(button);
  };
  const defer = (v: HTMLVideoElement, value: string) => {
    pending.set(v, value);
    showOverlay(v);
  };
  const flush = (v: HTMLVideoElement) => {
    removeOverlay(v);
    const value = pending.get(v);
    if (value === undefined) return;
    pending.delete(v);
    Reflect.apply(srcDesc.set!, v, [value]);
  };

  const onGesture = (e: Event) => {
    if (!isTrustedGesture(e)) return;
    const at = win.performance.now();
    if (e.type === 'pointerdown' || e.type === 'pointerup') {
      const p = e as PointerEvent;
      lastGesture = { kind: 'pointer', x: p.clientX, y: p.clientY, at };
    } else if (e.type === 'keydown') {
      const k = e as KeyboardEvent;
      if (k.key !== 'Enter' && k.key !== ' ') return;
      lastGesture = { kind: 'key', target: k.target, at };
      // Start directly, even if X waits for loadedmetadata before calling play().
      activateFromGesture(e);
    }
  };
  for (const type of ['pointerdown', 'pointerup', 'keydown']) {
    win.addEventListener(type, onGesture, { capture: true, passive: type !== 'keydown' });
  }

  const pointInRect = (r: DOMRect, x: number, y: number) =>
    r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

  const gestureMatches = (v: HTMLVideoElement) => {
    if (!lastGesture) return false;
    if (win.performance.now() - lastGesture.at > GESTURE_WINDOW_MS) return false;
    const r = v.getBoundingClientRect();
    if (lastGesture.kind === 'pointer') return pointInRect(r, lastGesture.x, lastGesture.y);
    const t = lastGesture.target;
    // Key gestures must land inside the video itself; Enter on body while
    // X's j/k navigation has focus elsewhere must not unlock autoplay.
    if (!(t instanceof win.Element) || t === win.document.body || t === win.document.documentElement) {
      return false;
    }
    if (t === v) return true;
    const tr = t.getBoundingClientRect();
    return (
      tr.left >= r.left - 2 && tr.right <= r.right + 2 && tr.top >= r.top - 2 && tr.bottom <= r.bottom + 2
    );
  };

  const activateFromGesture = (e: Event) => {
    if (!enabled || !isTrustedGesture(e)) return;
    for (const v of win.document.querySelectorAll('video')) {
      if (!shouldDefer(v) || !pending.has(v)) continue;
      const ownsTarget = e.target instanceof win.Node && overlays.get(v)?.contains(e.target);
      if (!ownsTarget && !gestureMatches(v)) continue;
      // Consume the first play action so X cannot toggle the newly started
      // video back to paused in its own click handler.
      e.preventDefault();
      e.stopImmediatePropagation();
      activated.add(v);
      flush(v);
      void Reflect.apply(origPlay, v, []).catch(() => {
        // X may replace the source during loading, aborting this play request.
        // The video remains authorized for its subsequent play attempts.
      });
      break;
    }
  };
  win.addEventListener('click', (e) => {
    if (e.button === 0) activateFromGesture(e);
  }, { capture: true });

  Reflect.defineProperty(videoProto, 'src', {
    configurable: true,
    enumerable: srcDesc.enumerable,
    get(this: HTMLVideoElement) {
      const value = pending.get(this);
      return value !== undefined ? value : Reflect.apply(srcDesc.get!, this, []);
    },
    set(this: HTMLVideoElement, v: string) {
      if (v && shouldDefer(this)) {
        defer(this, String(v));
        return;
      }
      pending.delete(this);
      removeOverlay(this);
      Reflect.apply(srcDesc.set!, this, [v]);
    },
  });

  const defineOverride = (name: 'play' | 'setAttribute' | 'removeAttribute', value: unknown) =>
    Object.defineProperty(videoProto, name, {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    });

  defineOverride('setAttribute', function (this: HTMLVideoElement, name: string, value: string) {
    const lower = String(name).toLowerCase();
    if (lower === 'src' && value && shouldDefer(this)) {
      defer(this, String(value));
      return;
    }
    if (lower === 'src') {
      pending.delete(this);
      removeOverlay(this);
    }
    return Reflect.apply(origSetAttribute, this, [name, value]);
  });

  defineOverride('removeAttribute', function (this: HTMLVideoElement, name: string) {
    if (String(name).toLowerCase() === 'src') {
      pending.delete(this);
      removeOverlay(this);
    }
    return Reflect.apply(origRemoveAttribute, this, [name]);
  });

  defineOverride('play', function (this: HTMLVideoElement, ...args: unknown[]) {
    if (gestureMatches(this)) activated.add(this);
    if (shouldDefer(this)) {
      return Promise.reject(new win.DOMException('Autoplay blocked by Bobox', 'NotAllowedError'));
    }
    flush(this);
    return Reflect.apply(origPlay, this, args);
  });

  // src written into the HTML markup bypasses every JS setter; pull it into
  // pending before the media load task picks it up.
  const stripMarkupSrc = (v: HTMLVideoElement) => {
    if (!shouldDefer(v)) return;
    const value = Reflect.apply(origGetAttribute, v, ['src']);
    if (!value) return;
    defer(v, value);
    Reflect.apply(origRemoveAttribute, v, ['src']);
  };
  const scan = (node: Node) => {
    if (node instanceof win.HTMLVideoElement) {
      stripMarkupSrc(node);
      showOverlay(node);
    } else if (node instanceof win.Element) {
      for (const v of node.querySelectorAll('video')) {
        stripMarkupSrc(v);
        showOverlay(v);
      }
    }
  };
  new win.MutationObserver((records) => {
    if (!enabled) return;
    for (const r of records) {
      for (const n of r.removedNodes) {
        if (n instanceof win.HTMLVideoElement) removeOverlay(n);
        else if (n instanceof win.Element) {
          for (const v of n.querySelectorAll('video')) removeOverlay(v);
        }
      }
      for (const n of r.addedNodes) scan(n);
    }
  }).observe(win.document, { childList: true, subtree: true });

  // Covers autoplay through the `autoplay` attribute or native controls,
  // where play() may never reach our wrapper.
  win.addEventListener(
    'play',
    (e) => {
      const t = e.target;
      if (!(t instanceof win.HTMLVideoElement)) return;
      if (gestureMatches(t)) {
        activated.add(t);
        flush(t);
      } else if (shouldDefer(t)) {
        Reflect.apply(origPause, t, []);
      }
    },
    { capture: true, passive: true },
  );

  const blocker: AutoplayBlocker = {
    get enabled() {
      return enabled;
    },
    setEnabled(next: boolean) {
      if (enabled === next) return;
      enabled = next;
      for (const v of win.document.querySelectorAll('video')) {
        if (next) {
          if (!activated.has(v) && !v.paused) Reflect.apply(origPause, v, []);
        } else {
          flush(v);
        }
      }
    },
  };
  Object.defineProperty(win, INSTALLED, { value: blocker });
  return blocker;
}
