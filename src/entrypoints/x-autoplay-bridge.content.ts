import { defineContentScript } from 'wxt/utils/define-content-script';
import { X_MATCHES, REQUEST_EVENT, STATE_EVENT } from '../tools/x-autoplay/constants';
import { xAutoplayEnabled } from '../tools/x-autoplay/settings';

export default defineContentScript({
  matches: X_MATCHES,
  runAt: 'document_start',
  async main() {
    let enabled: boolean | undefined;
    const publish = () => {
      if (enabled === undefined) return;
      window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: enabled }));
    };
    window.addEventListener(REQUEST_EVENT, publish);
    xAutoplayEnabled.watch((v) => {
      enabled = v ?? true;
      publish();
    });
    const initial = await xAutoplayEnabled.getValue();
    if (enabled === undefined) enabled = initial;
    publish();
  },
});
