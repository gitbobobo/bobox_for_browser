import type { WxtStorageItem } from 'wxt/utils/storage';

/**
 * Subscribes to a storage item's current value and later updates.
 *
 * The watch is registered before the initial read so no change slips
 * through between them; once an update arrives, a late stale initial
 * value is dropped. The returned function ends the subscription: the
 * watch is removed and a still-pending initial read never fires.
 */
export function subscribeStorageItem<TValue, TMetadata extends Record<string, unknown>>(
  item: WxtStorageItem<TValue, TMetadata>,
  onValue: (value: TValue) => void,
): () => void {
  let active = true;
  let receivedUpdate = false;
  const unwatch = item.watch((value) => {
    receivedUpdate = true;
    onValue(value);
  });
  void item.getValue().then((value) => {
    if (active && !receivedUpdate) onValue(value);
  });
  return () => {
    active = false;
    unwatch();
  };
}
