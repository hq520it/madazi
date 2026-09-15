import { useCallback, useEffect, useRef, useState } from 'react';
import { getPreference, savePreference } from '../api/biz';

// 页面配置（搜索条件显隐 / 表格列显隐顺序）跟着用户走：
// 首次加载合并服务端偏好与默认值，变更即 PUT 持久化（按 user_id + page_code 存储）
export interface PageConfig {
  searchFields?: string[];
  columns?: string[];
}

export function usePageConfig(pageCode: string, defaults: PageConfig) {
  const [config, setConfig] = useState<PageConfig>(defaults);
  const [ready, setReady] = useState(false);
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  useEffect(() => {
    let alive = true;
    getPreference(pageCode)
      .then((saved) => {
        if (alive && saved) {
          setConfig({
            searchFields: Array.isArray(saved.searchFields)
              ? (saved.searchFields as string[])
              : defaultsRef.current.searchFields,
            columns: Array.isArray(saved.columns)
              ? (saved.columns as string[])
              : defaultsRef.current.columns,
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [pageCode]);

  const save = useCallback(
    (next: PageConfig) => {
      setConfig(next);
      savePreference(pageCode, next).catch(() => {});
    },
    [pageCode]
  );

  return { config, ready, save };
}
