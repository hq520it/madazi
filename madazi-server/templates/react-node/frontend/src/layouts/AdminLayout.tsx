import { useMemo, useState } from 'react';
import { Outlet, Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Collapse from '@mui/material/Collapse';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Avatar from '@mui/material/Avatar';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import { useMediaQuery, useTheme } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LogoutIcon from '@mui/icons-material/Logout';
import DashboardIcon from '@mui/icons-material/Dashboard';
import SettingsIcon from '@mui/icons-material/Settings';
import PeopleIcon from '@mui/icons-material/People';
import SecurityIcon from '@mui/icons-material/Security';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import BookIcon from '@mui/icons-material/Book';
import LayersIcon from '@mui/icons-material/Layers';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import CircleIcon from '@mui/icons-material/Circle';
import { useAuth } from '../context/AuthContext';
import { useThemeMode } from '../context/ThemeContext';
import type { MenuItem as MenuNodeType } from '../types';

const DRAWER_WIDTH = 240;

// 菜单图标映射（菜单表 icon 字段存 MUI 图标名）
const ICONS: Record<string, React.ComponentType> = {
  Dashboard: DashboardIcon,
  Settings: SettingsIcon,
  People: PeopleIcon,
  Security: SecurityIcon,
  MenuBook: MenuBookIcon,
  Book: BookIcon,
  Layers: LayersIcon,
  Inventory2: Inventory2Icon,
};

function findMenuChain(nodes: MenuNodeType[], path: string, acc: MenuNodeType[] = []): MenuNodeType[] | null {
  for (const n of nodes) {
    const next = [...acc, n];
    if (n.path === path) return next;
    if (n.children?.length) {
      const found = findMenuChain(n.children, path, next);
      if (found) return found;
    }
  }
  return null;
}

// 侧边栏菜单项（支持折叠子级）
function SidebarItem({ item, nested, onNavigate }: { item: MenuNodeType; nested?: boolean; onNavigate?: () => void }) {
  const location = useLocation();
  const [open, setOpen] = useState(true);
  const hasChildren = Boolean(item.children?.length);
  const active = item.path
    ? item.path === '/'
      ? location.pathname === '/'
      : location.pathname === item.path
    : false;
  const Icon = ICONS[item.icon ?? ''] ?? CircleIcon;

  if (hasChildren) {
    return (
      <>
        <ListItemButton onClick={() => setOpen((o) => !o)} sx={{ py: 1.25 }}>
          <ListItemIcon sx={{ minWidth: 36 }}>
            <Icon />
          </ListItemIcon>
          <ListItemText primary={item.name} slotProps={{ primary: { sx: { fontSize: 14 } } }} />
          {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
        </ListItemButton>
        <Collapse in={open} timeout="auto" unmountOnExit>
          <List disablePadding>
            {item.children!.map((c) => (
              <SidebarItem key={c.id} item={c} nested onNavigate={onNavigate} />
            ))}
          </List>
        </Collapse>
      </>
    );
  }
  return (
    <ListItemButton
      component={RouterLink}
      to={item.path ?? '#'}
      onClick={onNavigate}
      selected={active}
      sx={{ py: 1.25, pl: nested ? 4 : 2.25 }}
    >
      <ListItemIcon sx={{ minWidth: 36 }}>
        <Icon />
      </ListItemIcon>
      <ListItemText primary={item.name} slotProps={{ primary: { sx: { fontSize: 14 } } }} />
    </ListItemButton>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { menus } = useAuth();
  return (
    <>
      <Toolbar sx={{ px: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
          🧩 Admin 管理系统
        </Typography>
      </Toolbar>
      <Divider />
      <List sx={{ px: 1, py: 1 }}>
        {menus.map((m) => (
          <SidebarItem key={m.id} item={m} onNavigate={onNavigate} />
        ))}
      </List>
    </>
  );
}

export default function AdminLayout() {
  const { user, menus, logout } = useAuth();
  const { mode, toggle } = useThemeMode();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const chain = useMemo(
    () => findMenuChain(menus, location.pathname) ?? [],
    [menus, location.pathname]
  );

  const handleLogout = async () => {
    setUserMenuAnchor(null);
    await logout();
    navigate('/login');
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <CssBaseline />
      {/* 顶栏 */}
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          zIndex: (t) => t.zIndex.drawer + 1,
          borderBottom: 1,
          borderColor: 'divider',
          backdropFilter: 'blur(6px)',
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          {!isDesktop && (
            <IconButton edge="start" onClick={() => setMobileOpen(true)} aria-label="打开菜单">
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="subtitle1" noWrap component="div" sx={{ flexGrow: 1, fontWeight: 600 }}>
            标准后台管理系统
          </Typography>
          <IconButton onClick={toggle} aria-label="切换主题" color="inherit">
            {mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
          </IconButton>
          <IconButton onClick={(e) => setUserMenuAnchor(e.currentTarget)} aria-label="用户菜单" color="inherit" sx={{ p: 0.5 }}>
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>
              {(user?.nickname || user?.username || '?').slice(0, 1).toUpperCase()}
            </Avatar>
          </IconButton>
          <Menu anchorEl={userMenuAnchor} open={Boolean(userMenuAnchor)} onClose={() => setUserMenuAnchor(null)}>
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="subtitle2">{user?.nickname || user?.username}</Typography>
              <Typography variant="caption" color="text.secondary">
                {user?.roles?.map((r) => r.name).join('、') || '普通用户'}
              </Typography>
            </Box>
            <Divider />
            <MenuItem onClick={handleLogout}>
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              退出登录
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* 桌面/Pad 侧栏 */}
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          display: { xs: 'none', md: 'block' },
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
        open
      >
        <SidebarContent />
      </Drawer>

      {/* 手机抽屉 */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <SidebarContent onNavigate={() => setMobileOpen(false)} />
      </Drawer>

      {/* 主内容区 */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          p: { xs: 1.5, md: 3 },
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
        }}
      >
        <Toolbar />
        {chain.length > 0 && (
          <Breadcrumbs sx={{ mb: 2, '& .MuiBreadcrumbs-separator': { mx: 0.5 } }}>
            {chain.map((m, i) => (
              <Typography
                key={m.id}
                variant="body2"
                color={i === chain.length - 1 ? 'text.primary' : 'text.secondary'}
                sx={{ fontWeight: i === chain.length - 1 ? 600 : 400 }}
              >
                {m.name}
              </Typography>
            ))}
          </Breadcrumbs>
        )}
        <Outlet />
      </Box>
    </Box>
  );
}
