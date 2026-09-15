import { Navigate, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { useAuth } from '../context/AuthContext';

// 403 无权限
export function Forbidden() {
  return (
    <Box sx={{ py: 10, textAlign: 'center' }}>
      <Typography variant="h2" sx={{ fontWeight: 800 }} color="primary">
        403
      </Typography>
      <Typography variant="h6" sx={{ mt: 1, mb: 3 }}>
        抱歉，您没有权限访问该页面
      </Typography>
      <Button variant="contained" onClick={() => (window.location.hash = '#/')}>
        返回首页
      </Button>
    </Box>
  );
}

// 404 页面不存在
export function NotFound() {
  return (
    <Box sx={{ py: 10, textAlign: 'center' }}>
      <Typography variant="h2" sx={{ fontWeight: 800 }} color="primary">
        404
      </Typography>
      <Typography variant="h6" sx={{ mt: 1, mb: 3 }}>
        页面不存在
      </Typography>
      <Button variant="contained" onClick={() => (window.location.hash = '#/')}>
        返回首页
      </Button>
    </Box>
  );
}

// 路由守卫：未登录 -> /login
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography color="text.secondary">加载中…</Typography>
      </Box>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

// 权限守卫：无菜单权限 -> /403
export function PermRoute({ code, children }: { code: string; children: React.ReactNode }) {
  const { hasPerm, loading } = useAuth();
  if (loading) return null;
  if (!hasPerm(code)) return <Navigate to="/403" replace />;
  return <>{children}</>;
}
