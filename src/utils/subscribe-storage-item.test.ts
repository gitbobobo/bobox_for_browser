import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchCallback, WxtStorageItem } from 'wxt/utils/storage';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { subscribeStorageItem } from './subscribe-storage-item';

// wxt/utils/storage resolves the browser object when the module is first
// evaluated, so the real storage items must be imported after the fake is
// installed on globalThis.
Object.assign(globalThis, { browser: fakeBrowser });
const { xAutoplayEnabled } = await import('../tools/x-autoplay/settings');
const { githubPrImagePreviewEnabled } = await import('../tools/github-pr-image-preview/settings');

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// A storage item whose initial read resolves and watch updates fire only
// when the test says so, making race orderings deterministic.
function manualItem(initial: boolean) {
  const listeners = new Set<WatchCallback<boolean>>();
  let resolveGet!: (value: boolean) => void;
  const item = {
    key: 'local:test.flag',
    fallback: initial,
    getValue: vi.fn(() => new Promise<boolean>((resolve) => (resolveGet = resolve))),
    watch: vi.fn((cb: WatchCallback<boolean>) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
  } as unknown as WxtStorageItem<boolean, Record<string, never>>;
  return {
    item,
    resolveGet: (v: boolean) => resolveGet(v),
    update: (v: boolean) => [...listeners].forEach((cb) => cb(v, !v)),
    listenerCount: () => listeners.size,
  };
}

describe('subscribeStorageItem', () => {
  it('delivers the initial value, then applies later updates', async () => {
    const f = manualItem(false);
    const seen: boolean[] = [];
    subscribeStorageItem(f.item, (v) => seen.push(v));
    f.resolveGet(false);
    await flush();
    f.update(true);
    expect(seen).toEqual([false, true]);
  });

  it.each([true, false])(
    'ignores a stale initial read arriving after a watch update (update=%s)',
    async (update) => {
      const f = manualItem(!update);
      const seen: boolean[] = [];
      subscribeStorageItem(f.item, (v) => seen.push(v));
      f.update(update);
      f.resolveGet(!update);
      await flush();
      expect(seen).toEqual([update]);
    },
  );

  it('stops all callbacks after unsubscribe, including the pending initial read', async () => {
    const f = manualItem(true);
    const seen: boolean[] = [];
    const unsubscribe = subscribeStorageItem(f.item, (v) => seen.push(v));
    unsubscribe();
    expect(f.listenerCount()).toBe(0);
    f.update(true);
    f.resolveGet(true);
    await flush();
    expect(seen).toEqual([]);
  });

  describe('with real WxtStorageItem', () => {
    beforeEach(() => fakeBrowser.storage.local.resetState());

    it('reads x-autoplay as true and github preview as false when nothing is stored', async () => {
      const seenX: boolean[] = [];
      const seenGh: boolean[] = [];
      const unX = subscribeStorageItem(xAutoplayEnabled, (v) => seenX.push(v));
      const unGh = subscribeStorageItem(githubPrImagePreviewEnabled, (v) => seenGh.push(v));
      await flush();
      expect(seenX).toEqual([true]);
      expect(seenGh).toEqual([false]);
      unX();
      unGh();
    });

    it('ends on the live update value', async () => {
      const seen: boolean[] = [];
      const unsubscribe = subscribeStorageItem(githubPrImagePreviewEnabled, (v) => seen.push(v));
      await githubPrImagePreviewEnabled.setValue(true);
      await flush();
      expect(seen.at(-1)).toBe(true);
      unsubscribe();
    });

    it('falls back again when the stored value is removed', async () => {
      const seenX: boolean[] = [];
      const seenGh: boolean[] = [];
      subscribeStorageItem(xAutoplayEnabled, (v) => seenX.push(v));
      subscribeStorageItem(githubPrImagePreviewEnabled, (v) => seenGh.push(v));
      await flush();
      await xAutoplayEnabled.setValue(false);
      await xAutoplayEnabled.removeValue();
      await githubPrImagePreviewEnabled.setValue(true);
      await githubPrImagePreviewEnabled.removeValue();
      await flush();
      expect(seenX).toEqual([true, false, true]);
      expect(seenGh).toEqual([false, true, false]);
    });

    it('removes the watch listener on unsubscribe', async () => {
      const seen: boolean[] = [];
      const unsubscribe = subscribeStorageItem(xAutoplayEnabled, (v) => seen.push(v));
      await flush();
      unsubscribe();
      await xAutoplayEnabled.setValue(false);
      await flush();
      expect(seen).toEqual([true]);
    });
  });
});
