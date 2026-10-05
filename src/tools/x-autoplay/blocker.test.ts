import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { GESTURE_WINDOW_MS, installAutoplayBlocker } from './blocker';

type Win = Window & typeof globalThis;

function makeWindow() {
  const dom = new JSDOM('', { url: 'https://x.com/' });
  const win = dom.window as unknown as Win;
  const playCalls: HTMLVideoElement[] = [];
  const srcAtPlay: (string | null)[] = [];
  const pauseCalls: HTMLVideoElement[] = [];
  win.HTMLMediaElement.prototype.play = function (this: HTMLVideoElement) {
    playCalls.push(this);
    srcAtPlay.push(this.getAttribute('src'));
    return Promise.resolve();
  };
  win.HTMLMediaElement.prototype.pause = function (this: HTMLVideoElement) {
    pauseCalls.push(this);
  };
  return { win, dom, playCalls, srcAtPlay, pauseCalls };
}

function makeVideo(win: Win) {
  const v = win.document.createElement('video');
  win.document.body.appendChild(v);
  return v;
}

function setRect(el: Element, r: { left: number; top: number; right: number; bottom: number }) {
  const rect = {
    ...r,
    width: r.right - r.left,
    height: r.bottom - r.top,
    x: r.left,
    y: r.top,
    toJSON: () => ({}),
  } as DOMRect;
  el.getBoundingClientRect = () => rect;
}

const VIDEO_RECT = { left: 0, top: 0, right: 300, bottom: 200 };

function pointer(win: Win, x: number, y: number) {
  const e = new win.PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true });
  win.dispatchEvent(e);
}

function click(win: Win, target: Element, x = 100, y = 100) {
  for (const type of ['pointerdown', 'pointerup']) {
    target.dispatchEvent(new win.PointerEvent(type, { clientX: x, clientY: y, bubbles: true }));
  }
  target.dispatchEvent(new win.MouseEvent('click', {
    clientX: x, clientY: y, bubbles: true, cancelable: true,
  }));
}

function key(win: Win, keyName: string, target: Element) {
  const e = new win.KeyboardEvent('keydown', { key: keyName, bubbles: true });
  target.dispatchEvent(e);
}

const trust = () => true;
const opts = { isTrustedGesture: trust };

let nowValue = 0;
function stubNow(win: Win) {
  nowValue = 0;
  vi.spyOn(win.performance, 'now').mockImplementation(() => nowValue);
}

describe('installAutoplayBlocker', () => {
  it('defers property src (attr null, getter returns value)', () => {
    const { win } = makeWindow();
    installAutoplayBlocker(win, opts);
    const v = makeVideo(win);
    v.src = 'blob:https://x.com/abc';
    expect(v.getAttribute('src')).toBeNull();
    expect(v.src).toBe('blob:https://x.com/abc');
  });

  it('defers setAttribute src', () => {
    const { win } = makeWindow();
    installAutoplayBlocker(win, opts);
    const v = makeVideo(win);
    v.setAttribute('src', 'https://x.com/a.mp4');
    expect(v.getAttribute('src')).toBeNull();
    expect(v.src).toBe('https://x.com/a.mp4');
  });

  it('removeAttribute clears pending', () => {
    const { win } = makeWindow();
    installAutoplayBlocker(win, opts);
    const v = makeVideo(win);
    v.src = 'blob:x';
    v.removeAttribute('src');
    expect(v.src).toBe('');
    expect(v.getAttribute('src')).toBeNull();
  });

  it('play without gesture rejects NotAllowedError, original not called', async () => {
    const { win, playCalls } = makeWindow();
    installAutoplayBlocker(win, opts);
    const v = makeVideo(win);
    setRect(v, VIDEO_RECT);
    await expect(v.play()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(playCalls).toHaveLength(0);
  });

  it('pointer inside rect applies pending src before original play, then passes through', async () => {
    const { win, playCalls, srcAtPlay } = makeWindow();
    installAutoplayBlocker(win, opts);
    const v = makeVideo(win);
    setRect(v, VIDEO_RECT);
    v.src = 'blob:deferred';
    pointer(win, 100, 100);
    await v.play();
    // deferred src must be applied to the element before the original play runs
    expect(srcAtPlay[0]).toBe('blob:deferred');
    expect(playCalls).toContain(v);
    // afterwards: no gesture needed
    await v.play();
    v.src = 'blob:next';
    expect(v.getAttribute('src')).toBe('blob:next');
    await v.play();
    expect(playCalls.filter((c) => c === v)).toHaveLength(3);
  });

  it('pointer outside rect blocked', async () => {
    const { win, playCalls } = makeWindow();
    installAutoplayBlocker(win, opts);
    const v = makeVideo(win);
    setRect(v, VIDEO_RECT);
    pointer(win, 400, 400);
    await expect(v.play()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(playCalls).toHaveLength(0);
  });

  it('a click starts deferred media without any play call from X and consumes the toggle', async () => {
    const { win, playCalls, srcAtPlay } = makeWindow();
    stubNow(win);
    installAutoplayBlocker(win, opts);
    const v = makeVideo(win);
    setRect(v, VIDEO_RECT);
    v.src = 'blob:deferred';
    const button = win.document.querySelector<HTMLButtonElement>('[data-testid="bobox-play-video"]')!;
    expect(button.textContent).toContain('点击加载并播放');
    const siteClick = vi.fn();
    button.addEventListener('click', siteClick);
    click(win, button);
    expect(srcAtPlay).toEqual(['blob:deferred']);
    expect(playCalls).toEqual([v]);
    expect(siteClick).not.toHaveBeenCalled();
    expect(button.isConnected).toBe(false);
    // Loading can take longer than the gesture window; the actual click
    // permanently authorizes this element's later playback.
    nowValue += GESTURE_WINDOW_MS + 1;
    await v.play();
    expect(playCalls).toEqual([v, v]);
  });

  it('clicking a loading mask also starts only the video under the pointer', () => {
    const { win, playCalls } = makeWindow();
    installAutoplayBlocker(win, opts);
    const first = makeVideo(win);
    const second = makeVideo(win);
    setRect(first, VIDEO_RECT);
    setRect(second, { left: 400, top: 0, right: 700, bottom: 200 });
    first.src = 'blob:first';
    second.src = 'blob:second';
    // The event target can be X's overlay rather than the video or our button.
    const mask = win.document.createElement('div');
    win.document.body.append(mask);
    click(win, mask);
    expect(playCalls).toEqual([first]);
    expect(second.getAttribute('src')).toBeNull();
  });

  it('clicks elsewhere and untrusted clicks cannot release a source', () => {
    const { win, playCalls } = makeWindow();
    installAutoplayBlocker(win);
    const v = makeVideo(win);
    setRect(v, VIDEO_RECT);
    v.src = 'blob:held';
    const button = win.document.querySelector('[data-testid="bobox-play-video"]')!;
    click(win, button);
    expect(playCalls).toEqual([]);
    expect(v.getAttribute('src')).toBeNull();

    const other = makeWindow();
    installAutoplayBlocker(other.win, opts);
    const v2 = makeVideo(other.win);
    setRect(v2, VIDEO_RECT);
    v2.src = 'blob:held';
    click(other.win, other.win.document.body, 500, 500);
    expect(other.playCalls).toEqual([]);
    expect(v2.getAttribute('src')).toBeNull();
  });

  it.each(['Enter', ' '])('%s starts via the overlay without X calling play', (keyName) => {
    const { win, playCalls } = makeWindow();
    installAutoplayBlocker(win, opts);
    const v = makeVideo(win);
    setRect(v, VIDEO_RECT);
    v.src = 'https://video.twimg.com/tweet_video/test.mp4';
    const button = win.document.querySelector('[data-testid="bobox-play-video"]')!;
    key(win, keyName, button);
    expect(playCalls).toEqual([v]);
    expect(v.getAttribute('src')).toContain('test.mp4');
    expect(button.isConnected).toBe(false);
  });

  it('mounts the overlay for a detached video on insertion and cleans up on removal', async () => {
    const { win } = makeWindow();
    installAutoplayBlocker(win, opts);
    const host = win.document.createElement('div');
    host.dataset.testid = 'videoComponent';
    win.document.body.append(host);
    const v = win.document.createElement('video');
    v.src = 'blob:held';
    host.append(v);
    await new Promise((r) => setTimeout(r, 0));
    expect(host.querySelector('[data-testid="bobox-play-video"]')).not.toBeNull();
    v.remove();
    await new Promise((r) => setTimeout(r, 0));
    expect(host.querySelector('[data-testid="bobox-play-video"]')).toBeNull();
  });

  it('removes the overlay on source removal and when disabled', () => {
    const { win } = makeWindow();
    const blocker = installAutoplayBlocker(win, opts);
    const v = makeVideo(win);
    v.src = 'blob:held';
    v.removeAttribute('src');
    expect(win.document.querySelector('[data-testid="bobox-play-video"]')).toBeNull();
    v.src = 'blob:next';
    blocker.setEnabled(false);
    expect(win.document.querySelector('[data-testid="bobox-play-video"]')).toBeNull();
    expect(v.getAttribute('src')).toBe('blob:next');
  });

  it('gesture older than GESTURE_WINDOW_MS blocked', async () => {
    const { win, playCalls } = makeWindow();
    stubNow(win);
    installAutoplayBlocker(win, opts);
    const v = makeVideo(win);
    setRect(v, VIDEO_RECT);
    pointer(win, 100, 100);
    nowValue += GESTURE_WINDOW_MS + 1;
    await expect(v.play()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(playCalls).toHaveLength(0);
  });

  it('Enter on element inside rect allowed; body target and other keys blocked', async () => {
    const { win, playCalls } = makeWindow();
    installAutoplayBlocker(win, opts);
    const v = makeVideo(win);
    setRect(v, VIDEO_RECT);
    const inner = win.document.createElement('button');
    setRect(inner, { left: 10, top: 10, right: 50, bottom: 40 });
    v.appendChild(inner);
    key(win, 'Enter', inner);
    await v.play();
    expect(playCalls).toContain(v);

    const v2 = makeVideo(win);
    setRect(v2, VIDEO_RECT);
    key(win, 'Enter', win.document.body);
    await expect(v2.play()).rejects.toMatchObject({ name: 'NotAllowedError' });

    key(win, 'j', v2);
    await expect(v2.play()).rejects.toMatchObject({ name: 'NotAllowedError' });
  });

  it('untrusted events do not count with default options', async () => {
    const { win, playCalls } = makeWindow();
    installAutoplayBlocker(win); // default isTrustedGesture: e.isTrusted (false in jsdom)
    const v = makeVideo(win);
    setRect(v, VIDEO_RECT);
    pointer(win, 100, 100);
    await expect(v.play()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(playCalls).toHaveLength(0);
  });

  it('setEnabled(false) flushes pending and lets src/play through', async () => {
    const { win, playCalls } = makeWindow();
    const b = installAutoplayBlocker(win, opts);
    const v = makeVideo(win);
    setRect(v, VIDEO_RECT);
    v.src = 'blob:held';
    expect(v.getAttribute('src')).toBeNull();
    b.setEnabled(false);
    expect(v.getAttribute('src')).toBe('blob:held');
    v.src = 'blob:two';
    expect(v.getAttribute('src')).toBe('blob:two');
    await v.play();
    expect(playCalls).toContain(v);
  });

  it('setEnabled(true) pauses playing non-activated videos only', async () => {
    const { win, pauseCalls } = makeWindow();
    const b = installAutoplayBlocker(win, opts);
    const v1 = makeVideo(win);
    const v2 = makeVideo(win);
    setRect(v1, VIDEO_RECT);
    setRect(v2, VIDEO_RECT);
    // activate v1 via gesture, then disable so src passes and "plays"
    pointer(win, 50, 50);
    await v1.play();
    b.setEnabled(false);
    Object.defineProperty(v1, 'paused', { value: false, configurable: true });
    Object.defineProperty(v2, 'paused', { value: false, configurable: true });
    b.setEnabled(true);
    expect(pauseCalls).toEqual([v2]);
  });

  it('audio elements untouched', async () => {
    const { win } = makeWindow();
    installAutoplayBlocker(win, opts);
    const a = win.document.createElement('audio');
    win.document.body.appendChild(a);
    a.src = 'https://x.com/a.mp3';
    expect(a.getAttribute('src')).toBe('https://x.com/a.mp3');
    // audio.play is not wrapped on HTMLAudioElement
    expect(Object.getOwnPropertyDescriptor(win.HTMLAudioElement.prototype, 'play')).toBeUndefined();
  });

  it('double install does not double-wrap', () => {
    const { win } = makeWindow();
    const b1 = installAutoplayBlocker(win, opts);
    const playAfter1 = win.HTMLVideoElement.prototype.play;
    const b2 = installAutoplayBlocker(win, opts);
    expect(b2).toBe(b1);
    expect(win.HTMLVideoElement.prototype.play).toBe(playAfter1);
    // overrides must look like native methods (non-enumerable)
    for (const name of ['play', 'setAttribute', 'removeAttribute'] as const) {
      expect(win.HTMLVideoElement.prototype.propertyIsEnumerable(name)).toBe(false);
    }
  });

  it('strips parser-inserted markup src into pending', async () => {
    const { win } = makeWindow();
    installAutoplayBlocker(win, opts);
    const host = win.document.createElement('div');
    win.document.body.appendChild(host);
    host.innerHTML = '<video src="https://video.twimg.com/tweet_video/x.mp4" preload="metadata"></video>';
    await new Promise((r) => setTimeout(r, 0)); // MutationObserver delivery
    const v = host.querySelector('video')!;
    expect(v.getAttribute('src')).toBeNull();
    expect(v.src).toBe('https://video.twimg.com/tweet_video/x.mp4');
  });

  it('play event safety net pauses non-activated, gesture activates and flushes', async () => {
    const { win, pauseCalls } = makeWindow();
    installAutoplayBlocker(win, opts);
    const v = makeVideo(win);
    setRect(v, VIDEO_RECT);
    v.src = 'blob:held';
    v.dispatchEvent(new win.Event('play', { bubbles: true }));
    expect(pauseCalls).toContain(v);
    expect(v.getAttribute('src')).toBeNull();

    pauseCalls.length = 0;
    pointer(win, 50, 50);
    v.dispatchEvent(new win.Event('play', { bubbles: true }));
    expect(pauseCalls).toHaveLength(0);
    expect(v.getAttribute('src')).toBe('blob:held');
    await v.play(); // activated now, no gesture needed
  });
});
