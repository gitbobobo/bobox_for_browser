import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { installPrImagePreview } from './preview';

const windows: JSDOM[] = [];
afterEach(() => windows.splice(0).forEach((dom) => dom.window.close()));

function setup() {
  const dom = new JSDOM(`
    <div id="issue-123"><div id="pullrequest-456"><div class="markdown-body">
      <a id="image-link" href="https://camo.githubusercontent.com/example" target="_blank">
        <img id="image" src="https://camo.githubusercontent.com/example" alt="截图">
      </a>
    </div></div></div>
    <div id="issuecomment-789"><div class="markdown-body"><img id="comment-image" src="https://example.com/comment.png"></div></div>
    <img id="avatar" src="https://example.com/avatar.png">
  `, { url: 'https://github.com/gitbobobo/musiver/pull/315' });
  windows.push(dom);
  const win = dom.window as unknown as Window & typeof globalThis;
  const doc = win.document;
  let shadow: ShadowRoot;
  const attachShadow = win.HTMLElement.prototype.attachShadow;
  vi.spyOn(win.HTMLElement.prototype, 'attachShadow').mockImplementation(function (this: HTMLElement, init) {
    shadow = attachShadow.call(this, init);
    return shadow;
  });
  win.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  win.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new win.Event('close'));
  };
  const preview = installPrImagePreview(win);
  const click = (selector = '#image', init: MouseEventInit = {}) => {
    const event = new win.MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    doc.querySelector(selector)!.dispatchEvent(event);
    return event;
  };
  return {
    win, doc, preview, click,
    host: () => doc.querySelector('[data-bobox-pr-image-preview]'),
    dialog: () => shadow.querySelector('dialog')!,
    contents: () => shadow,
  };
}

describe('GitHub PR image preview', () => {
  it('leaves clicks alone until enabled', () => {
    const t = setup();
    expect(t.click().defaultPrevented).toBe(false);
    expect(t.host()).toBeNull();
  });

  it('previews linked screenshots and consumes the navigation event', () => {
    const t = setup();
    t.preview.setEnabled(true);
    const pageClick = vi.fn();
    t.doc.addEventListener('click', pageClick);
    expect(t.click().defaultPrevented).toBe(true);
    expect(pageClick).not.toHaveBeenCalled();
    expect(t.dialog().open).toBe(true);
    expect(t.contents().querySelector('img')?.src).toBe('https://camo.githubusercontent.com/example');
    expect(t.contents().querySelector('img')?.alt).toBe('截图');
    expect(t.host()?.shadowRoot).toBeNull();
  });

  it('handles Enter-generated clicks on the wrapping image link', () => {
    const t = setup();
    t.preview.setEnabled(true);
    expect(t.click('#image-link', { detail: 0 }).defaultPrevented).toBe(true);
  });

  it.each(['ctrlKey', 'metaKey', 'shiftKey', 'altKey'] as const)('preserves %s clicks', (modifier) => {
    const t = setup();
    t.preview.setEnabled(true);
    expect(t.click('#image', { [modifier]: true }).defaultPrevented).toBe(false);
    expect(t.host()).toBeNull();
  });

  it('ignores middle clicks, avatars, comments and images linked to other pages', () => {
    const t = setup();
    t.preview.setEnabled(true);
    expect(t.click('#image', { button: 1 }).defaultPrevented).toBe(false);
    expect(t.click('#avatar').defaultPrevented).toBe(false);
    expect(t.click('#comment-image').defaultPrevented).toBe(false);
    t.doc.querySelector<HTMLAnchorElement>('#image-link')!.href = 'https://example.com/article';
    expect(t.click().defaultPrevented).toBe(false);
    expect(t.host()).toBeNull();
  });

  it('supports images added later and navigation into a PR without reinstalling', () => {
    const t = setup();
    t.preview.setEnabled(true);
    t.win.history.replaceState({}, '', '/gitbobobo/musiver/issues/315');
    expect(t.click().defaultPrevented).toBe(false);
    t.win.history.replaceState({}, '', '/gitbobobo/musiver/pull/316');
    const image = t.doc.createElement('img');
    image.id = 'new-image';
    image.src = 'https://example.com/new.png';
    t.doc.querySelector('.markdown-body')!.append(image);
    expect(t.click('#new-image').defaultPrevented).toBe(true);
  });

  it('ignores non-HTTP image URLs and PR subpages', () => {
    const t = setup();
    t.preview.setEnabled(true);
    t.doc.querySelector<HTMLImageElement>('#image')!.src = 'data:image/png;base64,AA==';
    expect(t.click().defaultPrevented).toBe(false);
    t.doc.querySelector<HTMLImageElement>('#image')!.src = 'https://camo.githubusercontent.com/example';
    t.win.history.replaceState({}, '', '/gitbobobo/musiver/pull/315/files');
    expect(t.click().defaultPrevented).toBe(false);
  });

  it.each(['button', 'background', 'escape', 'toggle', 'navigation', 'destroy'])('closes via %s and restores focus', (method) => {
    const t = setup();
    t.preview.setEnabled(true);
    const link = t.doc.querySelector<HTMLAnchorElement>('#image-link')!;
    t.doc.documentElement.style.setProperty('overflow', 'auto');
    link.focus();
    t.click();
    expect(t.doc.documentElement.style.overflow).toBe('hidden');
    if (method === 'button') t.contents().querySelector<HTMLButtonElement>('[aria-label="关闭图片预览"]')!.click();
    if (method === 'background') t.dialog().click();
    if (method === 'escape') t.dialog().dispatchEvent(new t.win.Event('cancel', { cancelable: true }));
    if (method === 'toggle') t.preview.setEnabled(false);
    if (method === 'navigation') t.doc.dispatchEvent(new t.win.Event('turbo:before-render'));
    if (method === 'destroy') t.preview.destroy();
    expect(t.host()).toBeNull();
    expect(t.doc.activeElement).toBe(link);
    expect(t.doc.documentElement.style.overflow).toBe('auto');
    if (method === 'toggle' || method === 'destroy') expect(t.click().defaultPrevented).toBe(false);
  });

  it('does not close when the image is clicked', () => {
    const t = setup();
    t.preview.setEnabled(true);
    t.click();
    t.contents().querySelector('img')!.click();
    expect(t.host()).not.toBeNull();
  });

  it('shows a recoverable error on a failed image load', () => {
    const t = setup();
    t.preview.setEnabled(true);
    t.click();
    t.contents().querySelector('img')!.dispatchEvent(new t.win.Event('error'));
    expect(t.contents().querySelector<HTMLElement>('[role="status"]')!.hidden).toBe(false);
  });

  it('preserves normal navigation if the browser cannot show the dialog', () => {
    const t = setup();
    t.preview.setEnabled(true);
    t.win.HTMLDialogElement.prototype.showModal = () => { throw new Error('unavailable'); };
    expect(t.click().defaultPrevented).toBe(false);
    expect(t.host()).toBeNull();
  });
});
