// Cover X's loading spinner while the media source is intentionally withheld.
export function createPlayOverlay(video: HTMLVideoElement): HTMLButtonElement {
  const doc = video.ownerDocument;
  const button = doc.createElement('button');
  button.type = 'button';
  button.dataset.testid = 'bobox-play-video';
  button.setAttribute('aria-label', '点击加载并播放');
  Object.assign(button.style, {
    position: 'absolute', inset: '0', zIndex: '2147483647',
    width: '100%', height: '100%', padding: '0', border: '0',
    background: '#000', color: '#fff', cursor: 'pointer',
    display: 'grid', placeItems: 'center',
  });
  if (video.poster) {
    const poster = doc.createElement('img');
    poster.src = video.poster;
    poster.alt = '';
    poster.draggable = false;
    Object.assign(poster.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain',
    });
    button.append(poster);
  }
  const label = doc.createElement('span');
  label.textContent = '▶ 点击加载并播放';
  Object.assign(label.style, {
    position: 'relative', padding: '12px 18px', borderRadius: '24px',
    background: 'rgba(0, 0, 0, 0.75)', font: '600 14px system-ui, sans-serif',
  });
  button.append(label);
  return button;
}
