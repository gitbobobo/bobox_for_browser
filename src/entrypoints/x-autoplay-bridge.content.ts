import { defineContentScript } from 'wxt/utils/define-content-script';
import { X_MATCHES, REQUEST_EVENT, STATE_EVENT } from '../tools/x-autoplay/constants';
import { xAutoplayEnabled } from '../tools/x-autoplay/settings';
import { subscribeStorageItem } from '../utils/subscribe-storage-item';

export default defineContentScript({
  matches: X_MATCHES,
  runAt: 'document_start',
  main(ctx) {
    // MAIN world blocks by default until the first state event arrives.
    let enabled: boolean | undefined;
    const publish = () => {
      if (enabled === undefined) return;
      window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: enabled }));
    };
    window.addEventListener(REQUEST_EVENT, publish);
    const unsubscribe = subscribeStorageItem(xAutoplayEnabled, (v) => {
      enabled = v;
      publish();
    });
    ctx.onInvalidated(() => {
      unsubscribe();
      window.removeEventListener(REQUEST_EVENT, publish);
    });
  },
});
