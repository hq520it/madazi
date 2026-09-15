import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { allDicts } from '../api/dicts';
import { useAuth } from './AuthContext';
import type { DictEntry, DictTypeWithItems } from '../types';

interface DictCtxValue {
  dicts: DictTypeWithItems[];
  getDict: (code: string) => DictEntry[];
  getDictLabel: (code: string, value?: string | null) => string;
  reload: () => Promise<void>;
}

const DictCtx = createContext<DictCtxValue>({
  dicts: [],
  getDict: () => [],
  getDictLabel: () => '-',
  reload: async () => {},
});

export function useDict() {
  return useContext(DictCtx);
}

export function DictProvider({ children }: { children: React.ReactNode }) {
  const [dicts, setDicts] = useState<DictTypeWithItems[]>([]);
  const { user } = useAuth();

  const reload = useCallback(async () => {
    try {
      const data = await allDicts();
      setDicts(data);
    } catch {
      // 未登录等场景忽略
    }
  }, []);

  // 登录态变化（登录/切换账号）后重新拉取
  const userId = user?.id;
  useEffect(() => {
    if (userId) reload();
    else setDicts([]);
  }, [userId, reload]);

  const getDict = useCallback(
    (code: string) => dicts.find((d) => d.code === code)?.items ?? [],
    [dicts]
  );

  const getDictLabel = useCallback(
    (code: string, value?: string | null) => {
      if (value === undefined || value === null || value === '') return '-';
      const item = getDict(code).find((i) => i.value === value);
      return item ? item.label : String(value);
    },
    [getDict]
  );

  const value = useMemo(
    () => ({ dicts, getDict, getDictLabel, reload }),
    [dicts, getDict, getDictLabel, reload]
  );

  return <DictCtx.Provider value={value}>{children}</DictCtx.Provider>;
}
