import { storage } from 'wxt/utils/storage';

export const xAutoplayEnabled = storage.defineItem<boolean>('local:tools.x-autoplay.enabled', {
  fallback: true,
});
