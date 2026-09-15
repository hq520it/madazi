import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Skeleton from '@mui/material/Skeleton';
import PeopleIcon from '@mui/icons-material/People';
import SecurityIcon from '@mui/icons-material/Security';
import BookIcon from '@mui/icons-material/Book';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import { dashboardStats } from '../api/biz';
import { useAuth } from '../context/AuthContext';
import type { DashboardStats } from '../types';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    dashboardStats()
      .then(setStats)
      .catch(() => {});
  }, []);

  const cards = [
    { label: '用户数', value: stats?.userCount, icon: <PeopleIcon />, color: '#3370ff' },
    { label: '角色数', value: stats?.roleCount, icon: <SecurityIcon />, color: '#00b42a' },
    { label: '字典类型', value: stats?.dictCount, icon: <BookIcon />, color: '#ff8800' },
    { label: '物品数', value: stats?.itemCount, icon: <Inventory2Icon />, color: '#7f3bf5' },
  ];

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700 }} gutterBottom>
        你好，{user?.nickname || user?.username} 👋
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        欢迎使用标准后台管理系统模板
      </Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {cards.map((c) => (
          <Grid key={c.label} size={{ xs: 6, md: 3 }}>
            <Card variant="outlined">
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2.5, '&:last-child': { pb: 2.5 } }}>
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    bgcolor: c.color,
                    flexShrink: 0,
                  }}
                >
                  {c.icon}
                </Box>
                <Box>
                  {c.value === undefined ? (
                    <Skeleton width={48} height={32} />
                  ) : (
                    <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                      {c.value}
                    </Typography>
                  )}
                  <Typography variant="body2" color="text.secondary">
                    {c.label}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
            最近添加的物品
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>名称</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>描述</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>创建时间</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {stats === null ? (
                <TableRow>
                  <TableCell colSpan={3}>
                    <Skeleton height={24} />
                  </TableCell>
                </TableRow>
              ) : stats.recentItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    暂无数据
                  </TableCell>
                </TableRow>
              ) : (
                stats.recentItems.map((it) => (
                  <TableRow key={it.id} hover>
                    <TableCell>{it.name}</TableCell>
                    <TableCell>{it.description ?? '-'}</TableCell>
                    <TableCell>{it.created_at ? new Date(it.created_at).toLocaleString() : '-'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Box>
  );
}
