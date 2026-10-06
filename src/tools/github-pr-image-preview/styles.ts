export const previewStyles = `
  :host { all: initial; }
  dialog {
    position: fixed; inset: 0; box-sizing: border-box;
    width: 100vw; height: 100dvh; max-width: none; max-height: none;
    margin: 0; padding: 64px 24px 24px; border: 0;
    background: transparent; color: #fff;
    font: 14px system-ui, sans-serif;
    overflow: auto; overscroll-behavior: contain;
  }
  dialog::backdrop { background: rgba(0, 0, 0, .88); }
  .image-area { min-height: 100%; display: grid; place-items: center; }
  img { display: block; max-width: 100%; max-height: calc(100dvh - 88px); object-fit: contain; }
  .close-button {
    position: fixed; top: 12px; right: 16px;
    width: 40px; height: 40px; display: grid; place-items: center;
    border: 1px solid #666; border-radius: 50%; padding: 0;
    background: #242424; color: #fff; font: inherit; cursor: pointer;
  }
  .close-button:hover { background: #444; }
  .close-button:focus-visible { outline: 2px solid #79b8ff; outline-offset: 3px; }
  .error { text-align: center; }
  [hidden] { display: none !important; }
`;
