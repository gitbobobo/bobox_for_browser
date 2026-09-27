import { useCallback, useEffect, useState } from 'react';
import type { WxtStorageItem } from 'wxt/utils/storage';

export function useStorageItem(
  item: WxtStorageItem<boolean, Record<string, never>>,
): [boolean | undefined, (value: boolean) => void] {
  const [value, setValue] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    void item.getValue().then((v) => {
      if (mounted) setValue(v);
    });
    const unwatch = item.watch((v) => setValue(v ?? undefined));
    return () => {
      mounted = false;
      unwatch();
    };
  }, [item]);

  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      void item.setValue(v);
    },
    [item],
  );

  return [value, set];
}
