import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { installVideoFloat } from './float';

const doms: JSDOM[] = [];
afterEach(() => doms.splice(0).forEach((d) => d.window.close()));

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeRect(x: number, y: number, w: number, h: number): DOMRect {
  return {
    x, y, width: w, height: h,
    top: y, left: x, right: x + w, bottom: y + h,
    toJSON: () => ({}),
  } as DOMRect;
}

interface SetupOptions {
  docPip?: boolean;
  nativePip?: boolean;
  videoStyle?: string;
}

function setup(opts: SetupOptions = {}) {
  const { docPip = true, nativePip = false, videoStyle = '' } = opts;
  const dom = new JSDOM(
    `<div id="player"><video id="v"${videoStyle ? ` style="${videoStyle}"` : ''} controls></video></div>`,
    { url: 'https://example.com/' },
  );
  doms.push(dom);
  const win = dom.window as unknown as Window & typeof globalThis;
  const doc = win.document;
  const video = doc.querySelector('video')!;
  vi.spyOn(video, 'getBoundingClientRect').mockReturnValue(fakeRect(100, 100, 640, 360));

  let docPipMock:
    | { requestWindow: ReturnType<typeof vi.fn>; window: Window | null }
    | undefined;
  if (docPip) {
    docPipMock = {
      window: null,
      requestWindow: vi.fn(async () => {
        const pd = new JSDOM('', { url: 'about:blank' });
        doms.push(pd);
        const pw = pd.window as unknown as Window;
        docPipMock!.window = pw;
        pw.addEventListener('pagehide', () => {
          docPipMock!.window = null;
        });
        return pw;
      }),
    };
    Object.defineProperty(win, 'documentPictureInPicture', {
      value: docPipMock,
      configurable: true,
    });
  }
  if (nativePip) {
    Object.defineProperty(win.HTMLVideoElement.prototype, 'requestPictureInPicture', {
      value: vi.fn(async () => ({})),
      configurable: true,
    });
  }

  const floater = installVideoFloat(win);
  const move = (x: number, y: number) => {
    doc.body.dispatchEvent(
      new win.MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }),
    );
  };
  return {
    win,
    doc,
    video,
    floater,
    move,
    docPip: docPipMock,
    button: () => doc.querySelector<HTMLButtonElement>('[data-testid="bobox-video-float"]'),
    toast: () => doc.querySelector<HTMLElement>('[data-bobox-video-float-toast]'),
    placeholder: () => doc.querySelector<HTMLElement>('[data-bobox-pip-placeholder]'),
  };
}

describe('video float', () => {
  it('shows the hover button only over large videos and hides it elsewhere', () => {
    const t = setup();
    t.floater.setEnabled(true);
    t.move(400, 280);
    expect(t.button()!.style.display).toBe('flex');
    expect(t.button()!.textContent).toContain('悬浮窗');
    t.move(10, 10);
    expect(t.button()!.style.display).toBe('none');
  });

  it('never shows the button while disabled', () => {
    const t = setup();
    t.move(400, 280);
    expect(t.button()).toBeNull();
    t.floater.setEnabled(true);
    t.move(400, 280);
    expect(t.button()!.style.display).toBe('flex');
    t.floater.setEnabled(false);
    expect(t.button()!.style.display).toBe('none');
    t.move(400, 280);
    expect(t.button()!.style.display).toBe('none');
  });

  it('never shows the button when neither PiP API exists', () => {
    const t = setup({ docPip: false });
    t.floater.setEnabled(true);
    t.move(400, 280);
    expect(t.button()).toBeNull();
  });

  it('ignores videos below the minimum size', () => {
    const t = setup();
    vi.spyOn(t.video, 'getBoundingClientRect').mockReturnValue(fakeRect(100, 100, 200, 100));
    t.floater.setEnabled(true);
    t.move(200, 150);
    expect(t.button()).toBeNull();
  });

  it('moves the video into a doc-pip window with controls and restores on pagehide', async () => {
    const t = setup({ videoStyle: 'outline: 2px solid red' });
    t.floater.setEnabled(true);
    t.move(400, 280);
    t.button()!.click();
    await flush();

    expect(t.docPip!.requestWindow).toHaveBeenCalledOnce();
    const pipWin = t.docPip!.window!;
    const pipDoc = pipWin.document;
    expect(pipDoc.title).toBe('Bobox 悬浮窗');
    expect(t.video.ownerDocument).toBe(pipDoc);
    expect(t.placeholder()!.textContent).toBe('视频正在悬浮窗播放');

    // Controls: toggle, seek, volume, rate, close.
    const toggle = pipDoc.querySelector<HTMLButtonElement>('[data-bobox-ctrl="toggle"]')!;
    // jsdom media stubs keep paused=true; pretend playback is running.
    Object.defineProperty(t.video, 'paused', { value: false, configurable: true });
    const pauseSpy = vi.spyOn(t.video, 'pause').mockImplementation(() => {});
    toggle.click();
    expect(pauseSpy).toHaveBeenCalled();
    expect(pipDoc.querySelector('[data-bobox-ctrl="seek"]')).not.toBeNull();
    expect(pipDoc.querySelector('[data-bobox-ctrl="mute"]')).not.toBeNull();
    expect(pipDoc.querySelector('[data-bobox-ctrl="volume"]')).not.toBeNull();
    expect(pipDoc.querySelector<HTMLSelectElement>('[data-bobox-ctrl="rate"]')).not.toBeNull();
    expect(pipDoc.querySelector('[data-bobox-ctrl="close"]')).not.toBeNull();

    pipWin.dispatchEvent(new t.win.Event('pagehide'));
    expect(t.video.ownerDocument).toBe(t.doc);
    expect(t.video.isConnected).toBe(true);
    expect(t.placeholder()).toBeNull();
    expect(t.video.getAttribute('style')).toContain('outline: 2px solid red');
    expect(t.video.controls).toBe(true);
  });

  it('restores the video via the recorded parent when the placeholder is gone', async () => {
    const t = setup();
    t.floater.setEnabled(true);
    t.move(400, 280);
    t.button()!.click();
    await flush();
    const pipWin = t.docPip!.window!;
    // The player rebuilt its subtree while the video floated.
    t.placeholder()!.remove();
    pipWin.dispatchEvent(new t.win.Event('pagehide'));
    expect(t.video.ownerDocument).toBe(t.doc);
    expect(t.video.parentElement?.id).toBe('player');
  });

  it('closes the previous pip window before floating another video', async () => {
    const t = setup();
    const video2 = t.doc.createElement('video');
    t.doc.body.append(video2);
    vi.spyOn(video2, 'getBoundingClientRect').mockReturnValue(fakeRect(0, 600, 640, 360));
    await flush(); // let the mutation observer see video2

    t.floater.setEnabled(true);
    t.move(400, 280);
    t.button()!.click();
    await flush();
    const firstWin = t.docPip!.window!;
    expect(t.video.ownerDocument).toBe(firstWin.document);

    t.move(320, 780);
    t.button()!.click();
    await flush();
    expect(t.docPip!.requestWindow).toHaveBeenCalledTimes(2);
    expect(t.video.ownerDocument).toBe(t.doc); // restored
    expect(t.video.isConnected).toBe(true);
    expect(video2.ownerDocument).toBe(t.docPip!.window!.document);
    expect(t.doc.querySelectorAll('[data-bobox-pip-placeholder]')).toHaveLength(1);
  });

  it('shows a toast and keeps the video in place when requestWindow fails', async () => {
    const t = setup();
    t.docPip!.requestWindow.mockRejectedValueOnce(new Error('denied'));
    t.floater.setEnabled(true);
    t.move(400, 280);
    t.button()!.click();
    await flush();
    expect(t.toast()!.textContent).toBe('无法开启悬浮窗');
    expect(t.video.ownerDocument).toBe(t.doc);
    expect(t.placeholder()).toBeNull();
  });

  it('falls back to native picture-in-picture without doc-pip', async () => {
    const t = setup({ docPip: false, nativePip: true });
    const requestPip = t.win.HTMLVideoElement.prototype.requestPictureInPicture;
    t.floater.setEnabled(true);
    t.move(400, 280);
    t.button()!.click();
    await flush();
    expect(requestPip).toHaveBeenCalledOnce();
  });

  it('skips disablePictureInPicture videos on the native-pip path', () => {
    const t = setup({ docPip: false, nativePip: true });
    t.video.disablePictureInPicture = true;
    t.floater.setEnabled(true);
    t.move(400, 280);
    expect(t.button()).toBeNull();
  });

  it('discovers videos inside open shadow roots', async () => {
    const t = setup();
    t.floater.setEnabled(true);
    t.video.remove();
    await flush();
    const host = t.doc.createElement('div');
    t.doc.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const sv = t.doc.createElement('video');
    shadow.append(sv);
    vi.spyOn(sv, 'getBoundingClientRect').mockReturnValue(fakeRect(100, 100, 640, 360));
    await flush();
    t.move(400, 280);
    expect(t.button()!.style.display).toBe('flex');
  });

  it('discovers shadow roots attached lazily to existing hosts', async () => {
    const t = setup();
    t.floater.setEnabled(true);
    t.video.remove();
    await flush();
    const host = t.doc.createElement('div');
    t.doc.body.append(host);
    await flush();
    // attachShadow on an already-attached host emits no childList mutation;
    // only the hover-triggered rescan can find the root.
    const shadow = host.attachShadow({ mode: 'open' });
    const sv = t.doc.createElement('video');
    shadow.append(sv);
    vi.spyOn(sv, 'getBoundingClientRect').mockReturnValue(fakeRect(100, 100, 640, 360));
    await flush();
    t.move(400, 280);
    expect(t.button()!.style.display).toBe('flex');
  });

  it('picks the frontmost video when candidates overlap', async () => {
    const t = setup();
    const bg = t.doc.createElement('video');
    t.doc.body.append(bg);
    await flush();
    vi.spyOn(bg, 'getBoundingClientRect').mockReturnValue(fakeRect(100, 100, 640, 360));
    // Both rects contain the point; bg paints on top.
    Object.defineProperty(t.doc, 'elementsFromPoint', {
      value: () => [bg],
      configurable: true,
    });
    t.floater.setEnabled(true);
    t.move(400, 280);
    t.button()!.click();
    await flush();
    expect(bg.ownerDocument).toBe(t.docPip!.window!.document);
    expect(t.video.ownerDocument).toBe(t.doc);
  });

  it('re-discovers a shadow root pruned while its host was detached', async () => {
    const t = setup();
    t.floater.setEnabled(true);
    t.video.remove();
    await flush();
    const host = t.doc.createElement('div');
    t.doc.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const sv = t.doc.createElement('video');
    shadow.append(sv);
    vi.spyOn(sv, 'getBoundingClientRect').mockReturnValue(fakeRect(100, 100, 640, 360));
    await flush();
    host.remove();
    await flush();
    t.move(10, 10); // hover miss: rescan prunes the detached root
    t.doc.body.append(host);
    await flush();
    t.move(400, 280);
    expect(t.button()!.style.display).toBe('flex');
  });

  it('discovers a lazy shadow root layered over a tracked video', async () => {
    const t = setup();
    t.floater.setEnabled(true);
    const host = t.doc.createElement('div');
    t.doc.body.append(host);
    await flush();
    // Host already in the DOM; attachShadow emits no mutation, and the
    // pointer still hits the tracked video, so only the throttled rescan
    // finds the new root.
    const shadow = host.attachShadow({ mode: 'open' });
    const sv = t.doc.createElement('video');
    shadow.append(sv);
    vi.spyOn(sv, 'getBoundingClientRect').mockReturnValue(fakeRect(100, 100, 640, 360));
    // A real document-level hit test surfaces the shadow host, not the
    // inner video — the host chain is what ties sv to the painted stack.
    Object.defineProperty(t.doc, 'elementsFromPoint', {
      value: () => [host],
      configurable: true,
    });
    await flush();
    t.move(400, 280);
    t.button()!.click();
    await flush();
    expect(sv.ownerDocument).toBe(t.docPip!.window!.document);
    expect(t.video.ownerDocument).toBe(t.doc);
  });

  it('does not close a picture-in-picture window it does not own', () => {
    const t = setup();
    t.floater.setEnabled(true);
    const foreign = { close: vi.fn() };
    t.docPip!.window = foreign as unknown as Window;
    t.floater.setEnabled(false);
    t.floater.destroy();
    expect(foreign.close).not.toHaveBeenCalled();
  });

  it('destroy closes the session, removes the button and stops reacting', async () => {
    const t = setup();
    t.floater.setEnabled(true);
    t.move(400, 280);
    t.button()!.click();
    await flush();
    t.floater.destroy();
    expect(t.button()).toBeNull();
    expect(t.video.ownerDocument).toBe(t.doc);
    expect(t.placeholder()).toBeNull();
    t.move(400, 280);
    expect(t.button()).toBeNull();
  });
});
