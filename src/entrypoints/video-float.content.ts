import { defineContentScript } from 'wxt/utils/define-content-script';
import { videoFloatEnabled } from '../tools/video-float/settings';
import { installVideoFloat } from '../tools/video-float/float';
import { subscribeStorageItem } from '../utils/subscribe-storage-item';

export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_idle',
  main(ctx) {
    const floater = installVideoFloat(window);
    const unsubscribe = subscribeStorageItem(videoFloatEnabled, (v) => {
      floater.setEnabled(v);
    });
    ctx.onInvalidated(() => {
      unsubscribe();
      floater.destroy();
    });
  },
});
