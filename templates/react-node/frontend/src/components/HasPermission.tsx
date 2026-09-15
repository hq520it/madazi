import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';

// 按钮级权限：无权限时渲染 fallback（默认不渲染）
export function HasPermission({
  code,
  children,
  fallback = null,
}: {
  code: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { hasPerm } = useAuth();
  return <>{hasPerm(code) ? children : fallback}</>;
}
