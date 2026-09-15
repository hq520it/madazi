import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TablePagination from '@mui/material/TablePagination';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Checkbox from '@mui/material/Checkbox';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import { useMediaQuery, useTheme } from '@mui/material';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useSnackbar } from '../context/SnackbarContext';

// 统一表格组件：分页 + loading + 列设置（显隐/顺序，跟随用户偏好持久化）+ 手机卡片模式
export interface ColumnDef<T = Record<string, unknown>> {
  key: string;
  title: string;
  width?: number | string;
  align?: 'left' | 'right' | 'center';
  render?: (row: T) => React.ReactNode;
  /** 是否参与列设置（操作列等固定列设为 false） */
  configurable?: boolean;
  /** 手机卡片中隐藏 */
  hideOnMobileCard?: boolean;
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  total: number;
  page: number;
  size: number;
  onPageChange: (page: number) => void;
  onSizeChange: (size: number) => void;
  /** 工具栏左侧内容（标题 + 操作按钮） */
  toolbar?: React.ReactNode;
  /** 列设置（跟着用户走） */
  columnSetting?: {
    visibleKeys: string[];
    onChange: (keys: string[]) => void;
  };
  /** 手机端卡片自定义渲染 */
  mobileCard?: (row: T) => React.ReactNode;
  /** 隐藏分页（树形表格等场景） */
  hidePagination?: boolean;
  emptyText?: string;
}

export default function DataTable<T>(props: DataTableProps<T>) {
  const {
    columns,
    rows,
    rowKey,
    loading = false,
    total,
    page,
    size,
    onPageChange,
    onSizeChange,
    toolbar,
    columnSetting,
    mobileCard,
    hidePagination = false,
    emptyText = '暂无数据',
  } = props;

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { notify } = useSnackbar();

  // 列设置弹层
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  // 实际渲染的列：可配置列按 visibleKeys 顺序过滤，固定列追加在末尾
  const finalColumns = useMemo(() => {
    if (!columnSetting) return columns;
    const configurable = columns.filter((c) => c.configurable !== false);
    const fixed = columns.filter((c) => c.configurable === false);
    const byKey = new Map(configurable.map((c) => [c.key, c]));
    const visible = columnSetting.visibleKeys
      .map((k) => byKey.get(k))
      .filter((c): c is ColumnDef<T> => Boolean(c));
    return [...visible, ...fixed];
  }, [columns, columnSetting]);

  // 弹层里展示的列：可见列在前（按 visibleKeys 顺序），隐藏列在后
  const settingList = useMemo(() => {
    if (!columnSetting) return [];
    const configurable = columns.filter((c) => c.configurable !== false);
    const visibleSet = new Set(columnSetting.visibleKeys);
    const visible = columnSetting.visibleKeys
      .map((k) => configurable.find((c) => c.key === k))
      .filter((c): c is ColumnDef<T> => Boolean(c));
    const hidden = configurable.filter((c) => !visibleSet.has(c.key));
    return [...visible, ...hidden];
  }, [columns, columnSetting]);

  const handleToggleVisible = (key: string, checked: boolean) => {
    if (!columnSetting) return;
    if (checked) {
      columnSetting.onChange([...columnSetting.visibleKeys, key]);
    } else {
      if (columnSetting.visibleKeys.length <= 1) {
        notify('至少保留一列', 'warning');
        return;
      }
      columnSetting.onChange(columnSetting.visibleKeys.filter((k) => k !== key));
    }
  };

  const handleMove = (key: string, dir: -1 | 1) => {
    if (!columnSetting) return;
    const keys = [...columnSetting.visibleKeys];
    const idx = keys.indexOf(key);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= keys.length) return;
    [keys[idx], keys[target]] = [keys[target], keys[idx]];
    columnSetting.onChange(keys);
  };

  // 手机卡片渲染（默认：键值对列表）
  const renderMobileCard = (row: T) => {
    if (mobileCard) return mobileCard(row);
    return (
      <Box>
        {finalColumns
          .filter((c) => !c.hideOnMobileCard)
          .map((c, i) => (
            <Box key={c.key} sx={{ display: 'flex', gap: 1, py: 0.5, ...(i > 0 ? {} : {}) }}>
              <Typography variant="body2" color="text.secondary" sx={{ minWidth: 84, flexShrink: 0 }}>
                {c.title}
              </Typography>
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '-')}
              </Typography>
            </Box>
          ))}
      </Box>
    );
  };

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      {/* 工具栏 */}
      {(toolbar || columnSetting) && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            px: 2,
            py: 1.5,
            flexWrap: 'wrap',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>{toolbar}</Box>
          {columnSetting && (
            <Tooltip title="列设置">
              <IconButton size="small" onClick={(e) => setAnchorEl(e.currentTarget)} aria-label="列设置">
                <ViewColumnIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      )}
      {toolbar && columnSetting ? <Divider /> : null}

      {/* 表格 / 卡片 */}
      {isMobile ? (
        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {loading
            ? [0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={120} />)
            : rows.length === 0
              ? <Typography color="text.secondary" align="center" sx={{ py: 4 }}>{emptyText}</Typography>
              : rows.map((row) => (
                  <Card key={rowKey(row)} variant="outlined">
                    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>{renderMobileCard(row)}</CardContent>
                  </Card>
                ))}
        </Box>
      ) : (
        <TableContainer sx={{ maxHeight: 'calc(100vh - 260px)' }}>
          <Table stickyHeader size="small" aria-label="data table">
            <TableHead>
              <TableRow>
                {finalColumns.map((c) => (
                  <TableCell
                    key={c.key}
                    align={c.align ?? 'left'}
                    sx={{ width: c.width, fontWeight: 600, whiteSpace: 'nowrap' }}
                  >
                    {c.title}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      {finalColumns.map((c) => (
                        <TableCell key={c.key}>
                          <Skeleton height={22} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : rows.length === 0
                  ? (
                      <TableRow>
                        <TableCell colSpan={finalColumns.length} align="center" sx={{ py: 5 }}>
                          <Typography color="text.secondary">{emptyText}</Typography>
                        </TableCell>
                      </TableRow>
                    )
                  : rows.map((row) => (
                      <TableRow key={rowKey(row)} hover>
                        {finalColumns.map((c) => (
                          <TableCell key={c.key} align={c.align ?? 'left'}>
                            {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '-')}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* 分页 */}
      {!hidePagination && (
        <TablePagination
          component="div"
          count={total}
          page={page}
          rowsPerPage={size}
          rowsPerPageOptions={[10, 20, 50]}
          onPageChange={(_, p) => onPageChange(p)}
          onRowsPerPageChange={(e) => onSizeChange(parseInt(e.target.value, 10))}
          labelRowsPerPage="每页"
          labelDisplayedRows={({ from, to, count }) => `${from}-${to} / 共 ${count} 条`}
        />
      )}

      {/* 列设置弹层 */}
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 300, p: 1 } } }}
      >
        <Typography variant="subtitle2" sx={{ px: 1, py: 0.5, color: 'text.secondary' }}>
          列显示与顺序（自动保存）
        </Typography>
        {settingList.map((c) => {
          const visible = columnSetting!.visibleKeys.includes(c.key);
          const idx = columnSetting!.visibleKeys.indexOf(c.key);
          return (
            <Box
              key={c.key}
              sx={{ display: 'flex', alignItems: 'center', pr: 0.5, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
            >
              <Checkbox
                size="small"
                checked={visible}
                onChange={(e) => handleToggleVisible(c.key, e.target.checked)}
              />
              <Typography variant="body2" sx={{ flexGrow: 1 }}>
                {c.title}
              </Typography>
              {visible && (
                <>
                  <IconButton size="small" disabled={idx === 0} onClick={() => handleMove(c.key, -1)} aria-label="上移">
                    <ArrowUpwardIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    disabled={idx === columnSetting!.visibleKeys.length - 1}
                    onClick={() => handleMove(c.key, 1)}
                    aria-label="下移"
                  >
                    <ArrowDownwardIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </>
              )}
            </Box>
          );
        })}
      </Popover>
    </Paper>
  );
}
