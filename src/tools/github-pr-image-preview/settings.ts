import { storage } from 'wxt/utils/storage';

export const githubPrImagePreviewEnabled = storage.defineItem<boolean>(
  'local:tools.github-pr-image-preview.enabled',
  { fallback: false },
);
