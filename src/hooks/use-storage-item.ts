import { useCallback, useEffect, useState } from 'react';
import type { WxtStorageItem } from 'wxt/utils/storage';
import { subscribeStorageItem } from '../utils/subscribe-storage-item';

export function useStorageItem(
  item: WxtStorageItem<boolean, Record<string, never>>,
): [boolean | undefined, (value: boolean) => void] {
  const [value, setValue] = useState<boolean | undefined>(undefined);

  useEffect(() => subscribeStorageItem(item, setValue), [item]);

  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      void item.setValue(v);
    },
    [item],
  );

  return [value, set];
}
