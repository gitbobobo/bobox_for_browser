import { defineContentScript } from 'wxt/utils/define-content-script';
import { githubPrImagePreviewEnabled } from '../tools/github-pr-image-preview/settings';
import { installPrImagePreview } from '../tools/github-pr-image-preview/preview';

export default defineContentScript({
  // Include other GitHub routes so client-side navigation into a PR also works.
  matches: ['https://github.com/*'],
  main(ctx) {
    const preview = installPrImagePreview(window);
    let receivedUpdate = false;
    const unwatch = githubPrImagePreviewEnabled.watch((value) => {
      receivedUpdate = true;
      preview.setEnabled(value ?? false);
    });
    void githubPrImagePreviewEnabled.getValue().then((value) => {
      if (!receivedUpdate && !ctx.isInvalid) preview.setEnabled(value);
    });
    ctx.onInvalidated(() => {
      unwatch();
      preview.destroy();
    });
  },
});
