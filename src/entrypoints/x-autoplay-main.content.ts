import { defineContentScript } from 'wxt/utils/define-content-script';
import { X_MATCHES, REQUEST_EVENT, STATE_EVENT } from '../tools/x-autoplay/constants';
import { installAutoplayBlocker } from '../tools/x-autoplay/blocker';

export default defineContentScript({
  matches: X_MATCHES,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const blocker = installAutoplayBlocker(window);
    window.addEventListener(STATE_EVENT, (e) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === 'boolean') blocker.setEnabled(detail);
    });
    window.dispatchEvent(new CustomEvent(REQUEST_EVENT));
  },
});
