import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { me as fetchMe, logout as apiLogout } from '../api/auth';
import type { MenuItem, UserInfo } from '../types';

interface AuthCtxValue {
  user: UserInfo | null;
  menus: MenuItem[];
  permissions: string[];
  loading: boolean;
  hasPerm: (code: string) => boolean;
  setAuth: (user: UserInfo, menus: MenuItem[]) => void;
  clearAuth: () => void;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthCtxValue>({
  user: null,
  menus: [],
  permissions: [],
  loading: true,
  hasPerm: () => false,
  setAuth: () => {},
  clearAuth: () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthCtx);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 启动时若有 token 则恢复登录态
  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      setLoading(false);
      return;
    }
    fetchMe()
      .then((res) => {
        setUser(res.user);
        setMenus(res.menus);
      })
      .catch(() => {
        localStorage.removeItem('admin_token');
      })
      .finally(() => setLoading(false));
  }, []);

  const permissions = useMemo(() => user?.permissions ?? [], [user]);

  const hasPerm = useCallback(
    (code: string) => permissions.includes('*') || permissions.includes(code),
    [permissions]
  );

  const setAuth = useCallback((u: UserInfo, m: MenuItem[]) => {
    setUser(u);
    setMenus(m);
    setLoading(false);
  }, []);

  const clearAuth = useCallback(() => {
    localStorage.removeItem('admin_token');
    setUser(null);
    setMenus([]);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // 忽略登出接口错误
    }
    clearAuth();
  }, [clearAuth]);

  const value = useMemo(
    () => ({ user, menus, permissions, loading, hasPerm, setAuth, clearAuth, logout }),
    [user, menus, permissions, loading, hasPerm, setAuth, clearAuth, logout]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
