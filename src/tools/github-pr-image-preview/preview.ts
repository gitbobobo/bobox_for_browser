import { previewStyles } from './styles';

type Win = Window & typeof globalThis;

function imageSource(image: HTMLImageElement): string | undefined {
  const source = image.currentSrc || image.src;
  // Do not interpret custom image links as navigable URLs or use HTML from the page.
  try {
    const url = new URL(source);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch {}
}

export function installPrImagePreview(win: Win) {
  const doc = win.document;
  let enabled = false;
  let active: { dialog: HTMLDialogElement; close: () => void } | undefined;

  const close = () => active?.close();

  function open(image: HTMLImageElement, source: string): boolean {
    close();
    const previousFocus = doc.activeElement;
    const pageStyle = doc.documentElement.style;
    const overflow = pageStyle.getPropertyValue('overflow');
    const overflowPriority = pageStyle.getPropertyPriority('overflow');
    const host = doc.createElement('div');
    host.dataset.boboxPrImagePreview = '';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = previewStyles;
    const dialog = doc.createElement('dialog');
    dialog.setAttribute('aria-label', 'GitHub PR 图片预览');
    const dismiss = doc.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'close-button';
    dismiss.setAttribute('aria-label', '关闭图片预览');
    dismiss.title = '关闭图片预览';
    dismiss.autofocus = true;
    const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('width', '22');
    icon.setAttribute('height', '22');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    const cross = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    cross.setAttribute('d', 'M6 6l12 12M18 6 6 18');
    cross.setAttribute('stroke', 'currentColor');
    cross.setAttribute('stroke-width', '2');
    cross.setAttribute('stroke-linecap', 'round');
    icon.append(cross);
    dismiss.append(icon);
    const area = doc.createElement('div');
    area.className = 'image-area';
    const largeImage = doc.createElement('img');
    largeImage.alt = image.alt || 'PR 描述图片';
    const error = doc.createElement('p');
    error.className = 'error';
    error.setAttribute('role', 'status');
    error.textContent = '图片加载失败，请关闭后重试。';
    error.hidden = true;
    largeImage.addEventListener('error', () => {
      largeImage.hidden = true;
      error.hidden = false;
    });
    largeImage.src = source;
    area.append(largeImage, error);
    dialog.append(dismiss, area);
    shadow.append(style, dialog);
    doc.body.append(host);

    const finish = () => {
      if (active?.dialog !== dialog) return;
      active = undefined;
      if (dialog.open) dialog.close();
      host.remove();
      if (overflow) pageStyle.setProperty('overflow', overflow, overflowPriority);
      else pageStyle.removeProperty('overflow');
      if (previousFocus instanceof win.HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
    active = { dialog, close: finish };
    dismiss.addEventListener('click', finish);
    dialog.addEventListener('close', finish);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog || event.target === area) finish();
    });
    try {
      // Native modal supplies top-layer rendering, focus trapping and an inert page.
      dialog.showModal();
      pageStyle.setProperty('overflow', 'hidden');
      return true;
    } catch {
      finish();
      return false;
    }
  }

  const onClick = (event: MouseEvent) => {
    if (!enabled || event.defaultPrevented || event.button !== 0 ||
      event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
      !/^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(win.location.pathname)) return;
    if (!(event.target instanceof win.Element)) return;
    // The description is inside issue-/pullrequest-; review and timeline comments are separate.
    const body = doc.querySelector('[id^="issue-"] .markdown-body, [id^="pullrequest-"] .markdown-body');
    const link = event.target.closest('a');
    const image = event.target instanceof win.HTMLImageElement
      ? event.target
      : link?.querySelector('img');
    if (!image || !body?.contains(image)) return;
    const source = imageSource(image);
    if (!source) return;
    if (link && ![source, image.src, image.dataset.canonicalSrc].includes(link.href)) return;
    if (!open(image, source)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  win.addEventListener('click', onClick, true);
  doc.addEventListener('turbo:before-render', close);
  win.addEventListener('popstate', close);

  return {
    setEnabled(value: boolean) {
      enabled = value;
      if (!enabled) close();
    },
    destroy() {
      enabled = false;
      close();
      win.removeEventListener('click', onClick, true);
      doc.removeEventListener('turbo:before-render', close);
      win.removeEventListener('popstate', close);
    },
  };
}
