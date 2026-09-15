import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import { useMediaQuery, useTheme } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DataTable, { type ColumnDef } from '../../components/DataTable';
import FormDialog from '../../components/FormDialog';
import ConfirmDialog from '../../components/ConfirmDialog';
import DictTag from '../../components/DictTag';
import { HasPermission } from '../../components/HasPermission';
import type { FormFieldDef, FormValues } from '../../components/SchemaForm';
import { menuTree, createMenu, updateMenu, deleteMenu } from '../../api/dicts';
import { useSnackbar } from '../../context/SnackbarContext';
import type { MenuRow } from '../../types';

// 菜单管理：树形表格 + 新增/编辑（支持新增子节点）
export default function Menus() {
  const { notify } = useSnackbar();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [menus, setMenus] = useState<MenuRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 弹窗
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MenuRow | null>(null);
  const [formValues, setFormValues] = useState<FormValues>({});
  const [deleteTarget, setDeleteTarget] = useState<MenuRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await menuTree();
      setMenus(data);
      // 默认全部展开
      setExpanded(new Set(flatten(data).map((m) => m.id)));
    } catch (err) {
      notify(err instanceof Error ? err.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  // 树 -> 行（仅展开的节点可见）
  const rows = useMemo(() => {
    const out: { row: MenuRow; level: number }[] = [];
    const walk = (nodes: MenuRow[], level: number) => {
      for (const n of nodes) {
        out.push({ row: n, level });
        if (n.children?.length && expanded.has(n.id)) walk(n.children, level + 1);
      }
    };
    walk(menus, 0);
    return out;
  }, [menus, expanded]);

  // 上级菜单下拉选项（扁平 + 缩进）
  const parentOptions = useMemo(() => {
    const out: { label: string; value: string }[] = [];
    const walk = (nodes: MenuRow[], prefix: string) => {
      for (const n of nodes) {
        if (n.type === 'button') continue; // 按钮不能作为上级
        out.push({ label: prefix + n.name, value: n.id });
        if (n.children?.length) walk(n.children, prefix + '　');
      }
    };
    walk(menus, '');
    return out;
  }, [menus]);

  const formFields: FormFieldDef[] = [
    { key: 'parent_id', label: '上级菜单', type: 'select', options: [{ label: '无（顶级）', value: '' }, ...parentOptions] },
    {
      key: 'type',
      label: '类型',
      type: 'select',
      required: true,
      options: [
        { label: '菜单', value: 'menu' },
        { label: '按钮', value: 'button' },
      ],
    },
    { key: 'code', label: '权限标识', type: 'text', required: true, maxLength: 64, placeholder: '如: system:user:add' },
    { key: 'name', label: '名称', type: 'text', required: true, maxLength: 64 },
    ...(formValues.type !== 'button'
      ? [{ key: 'path', label: '路由路径', type: 'text' as const, maxLength: 255, placeholder: '如: /system/users' }]
      : []),
    ...(formValues.type !== 'button'
      ? [{ key: 'icon', label: '图标名', type: 'text' as const, maxLength: 64, placeholder: 'MUI 图标名，如: People' }]
      : []),
    { key: 'sort', label: '排序', type: 'number', min: 0 },
    { key: 'status', label: '状态', type: 'select', dictCode: 'sys_status', required: true },
  ];

  const openAdd = (parent?: MenuRow) => {
    setEditing(null);
    setFormValues({
      parent_id: parent?.id ?? '',
      type: 'menu',
      status: '1',
      sort: 0,
    });
    setFormOpen(true);
  };

  const openEdit = (r: MenuRow) => {
    setEditing(r);
    setFormValues({
      parent_id: r.parent_id ?? '',
      type: r.type,
      code: r.code,
      name: r.name,
      path: r.path ?? '',
      icon: r.icon ?? '',
      sort: r.sort ?? 0,
      status: r.status,
    });
    setFormOpen(true);
  };

  const handleFormSubmit = async () => {
    const type = String(formValues.type ?? 'menu') as 'menu' | 'button';
    try {
      const data = {
        parent_id: (formValues.parent_id as string) || null,
        code: String(formValues.code ?? ''),
        name: String(formValues.name ?? ''),
        path: type === 'menu' ? String(formValues.path ?? '') || null : null,
        icon: type === 'menu' ? String(formValues.icon ?? '') || null : null,
        sort: Number(formValues.sort ?? 0) || 0,
        type,
        status: String(formValues.status ?? '1'),
      };
      if (editing) {
        await updateMenu(editing.id, data);
        notify('保存成功');
      } else {
        await createMenu(data);
        notify('创建成功');
      }
      load();
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : '保存失败', 'error');
      return false;
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMenu(deleteTarget.id);
      notify('删除成功');
      setDeleteTarget(null);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '删除失败', 'error');
    }
  };

  const columns: ColumnDef<{ row: MenuRow; level: number }>[] = [
    {
      key: 'name',
      title: '名称',
      render: ({ row, level }) => (
        <Box sx={{ display: 'flex', alignItems: 'center', pl: isMobile ? 0 : level * 2, gap: 0.5 }}>
          {row.children && row.children.length > 0 ? (
            <IconButton
              size="small"
              sx={{ p: 0.25 }}
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(row.id)) next.delete(row.id);
                  else next.add(row.id);
                  return next;
                })
              }
            >
              {expanded.has(row.id) ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            </IconButton>
          ) : (
            <Box sx={{ width: 26 }} />
          )}
          <Typography variant="body2" sx={{ fontWeight: row.children?.length ? 600 : 400 }}>
            {row.name}
          </Typography>
        </Box>
      ),
    },
    { key: 'code', title: '权限标识' },
    {
      key: 'type',
      title: '类型',
      width: 90,
      render: ({ row }) =>
        row.type === 'menu' ? (
          <Chip size="small" color="primary" variant="outlined" label="菜单" />
        ) : (
          <Chip size="small" variant="outlined" label="按钮" />
        ),
    },
    { key: 'path', title: '路由路径', render: ({ row }) => row.path ?? '-' },
    { key: 'icon', title: '图标', render: ({ row }) => row.icon ?? '-' },
    { key: 'sort', title: '排序', align: 'center', width: 80 },
    {
      key: 'status',
      title: '状态',
      width: 90,
      render: ({ row }) => <DictTag dictCode="sys_status" value={row.status} />,
    },
    {
      key: 'actions',
      title: '操作',
      width: 160,
      align: 'center',
      configurable: false,
      render: ({ row }) => (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <HasPermission code="system:menu:add">
            {row.type === 'menu' && (
              <Tooltip title="新增子节点">
                <IconButton size="small" color="primary" onClick={() => openAdd(row)}>
                  <AddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </HasPermission>
          <HasPermission code="system:menu:edit">
            <Tooltip title="编辑">
              <IconButton size="small" onClick={() => openEdit(row)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </HasPermission>
          <HasPermission code="system:menu:delete">
            <Tooltip title="删除">
              <IconButton size="small" color="error" onClick={() => setDeleteTarget(row)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </HasPermission>
        </Box>
      ),
    },
  ];

  return (
    <Box>
      <DataTable<{ row: MenuRow; level: number }>
        columns={columns}
        rows={rows}
        rowKey={({ row }) => row.id}
        loading={loading}
        total={rows.length}
        page={0}
        size={100}
        onPageChange={() => {}}
        onSizeChange={() => {}}
        hidePagination
        toolbar={
          <>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              菜单列表
            </Typography>
            <HasPermission code="system:menu:add">
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => openAdd()}>
                新增菜单
              </Button>
            </HasPermission>
          </>
        }
      />

      <FormDialog
        open={formOpen}
        title={editing ? '编辑菜单' : '新增菜单'}
        fields={formFields}
        values={formValues}
        onChange={(k, v) => setFormValues((prev) => ({ ...prev, [k]: v }))}
        onSubmit={handleFormSubmit}
        onClose={() => setFormOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        content={`确认删除「${deleteTarget?.name}」？`}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
        confirmText="删除"
      />
    </Box>
  );
}

function flatten(nodes: MenuRow[]): MenuRow[] {
  const out: MenuRow[] = [];
  const walk = (list: MenuRow[]) => {
    for (const n of list) {
      out.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
