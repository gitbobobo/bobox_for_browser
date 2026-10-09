import { defineContentScript } from 'wxt/utils/define-content-script';
import { githubPrImagePreviewEnabled } from '../tools/github-pr-image-preview/settings';
import { installPrImagePreview } from '../tools/github-pr-image-preview/preview';
import { subscribeStorageItem } from '../utils/subscribe-storage-item';

export default defineContentScript({
  // Include other GitHub routes so client-side navigation into a PR also works.
  matches: ['https://github.com/*'],
  main(ctx) {
    const preview = installPrImagePreview(window);
    const unsubscribe = subscribeStorageItem(githubPrImagePreviewEnabled, (v) => {
      preview.setEnabled(v);
    });
    ctx.onInvalidated(() => {
      unsubscribe();
      preview.destroy();
    });
  },
});
