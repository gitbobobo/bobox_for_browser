import { storage } from 'wxt/utils/storage';

export const videoFloatEnabled = storage.defineItem<boolean>('local:tools.video-float.enabled', {
  fallback: false,
});
