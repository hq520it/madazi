import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Checkbox from '@mui/material/Checkbox';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Chip from '@mui/material/Chip';
import { useMediaQuery, useTheme } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import KeyIcon from '@mui/icons-material/Key';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import SearchForm from '../../components/SearchForm';
import DataTable, { type ColumnDef } from '../../components/DataTable';
import FormDialog from '../../components/FormDialog';
import ConfirmDialog from '../../components/ConfirmDialog';
import DictTag from '../../components/DictTag';
import { HasPermission } from '../../components/HasPermission';
import type { FormFieldDef, FormValues } from '../../components/SchemaForm';
import {
  listRoles,
  roleDetail,
  menuTreeAll,
  createRole,
  updateRole,
  deleteRole,
} from '../../api/roles';
import { useSnackbar } from '../../context/SnackbarContext';
import type { MenuRow, RoleRow } from '../../types';

// 角色管理：列表 + 新增/编辑 + 菜单权限树勾选
export default function Roles() {
  const { notify } = useSnackbar();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('md'));

  const [rows, setRows] = useState<RoleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [searchValues, setSearchValues] = useState<FormValues>({});
  const [submittedSearch, setSubmittedSearch] = useState<{ search?: string }>({});

  // 表单弹窗
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [formValues, setFormValues] = useState<FormValues>({});

  // 授权弹窗
  const [permOpen, setPermOpen] = useState(false);
  const [permRole, setPermRole] = useState<RoleRow | null>(null);
  const [permMenuIds, setPermMenuIds] = useState<string[]>([]);
  const [permSaving, setPermSaving] = useState(false);
  const [allMenus, setAllMenus] = useState<MenuRow[]>([]);

  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listRoles({ page, size, ...submittedSearch });
      setRows(res.list);
      setTotal(res.total);
    } catch (err) {
      notify(err instanceof Error ? err.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, size, submittedSearch, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: ColumnDef<RoleRow>[] = [
    { key: 'name', title: '角色名称' },
    { key: 'code', title: '角色标识', render: (r) => <Chip size="small" label={r.code} variant="outlined" /> },
    { key: 'description', title: '描述', render: (r) => r.description ?? '-' },
    { key: 'userCount', title: '用户数', align: 'center', width: 90 },
    { key: 'status', title: '状态', width: 90, render: (r) => <DictTag dictCode="sys_status" value={r.status} /> },
    {
      key: 'created_at',
      title: '创建时间',
      render: (r) => (r.created_at ? new Date(r.created_at).toLocaleString() : '-'),
    },
    {
      key: 'actions',
      title: '操作',
      width: 160,
      align: 'center',
      configurable: false,
      render: (r) => (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <HasPermission code="system:role:edit">
            <Tooltip title="编辑">
              <IconButton size="small" onClick={() => openEdit(r)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </HasPermission>
          <HasPermission code="system:role:edit">
            <Tooltip title="菜单权限">
              <IconButton size="small" color="primary" onClick={() => openPerm(r)}>
                <KeyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </HasPermission>
          <HasPermission code="system:role:delete">
            <Tooltip title="删除">
              <IconButton size="small" color="error" onClick={() => setDeleteTarget(r)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </HasPermission>
        </Box>
      ),
    },
  ];

  const formFields: FormFieldDef[] = [
    { key: 'code', label: '角色标识', type: 'text', required: true, maxLength: 64, placeholder: '如: operator', disabled: Boolean(editing && editing.code === 'super_admin') },
    { key: 'name', label: '角色名称', type: 'text', required: true, maxLength: 64 },
    { key: 'description', label: '描述', type: 'textarea', maxLength: 255, span: 2 },
    { key: 'status', label: '状态', type: 'select', dictCode: 'sys_status', required: true },
  ];

  const openAdd = () => {
    setEditing(null);
    setFormValues({ status: '1' });
    setFormOpen(true);
  };

  const openEdit = (r: RoleRow) => {
    setEditing(r);
    setFormValues({ code: r.code, name: r.name, description: r.description ?? '', status: r.status });
    setFormOpen(true);
  };

  const openPerm = async (r: RoleRow) => {
    setPermRole(r);
    setPermOpen(true);
    try {
      const [detail, menus] = await Promise.all([roleDetail(r.id), menuTreeAll()]);
      setPermMenuIds(detail.menuIds);
      // menus 是扁平数组 -> 组树
      setAllMenus(buildTree(menus));
    } catch (err) {
      notify(err instanceof Error ? err.message : '加载权限失败', 'error');
    }
  };

  const handleFormSubmit = async () => {
    try {
      if (editing) {
        await updateRole(editing.id, {
          code: String(formValues.code ?? ''),
          name: String(formValues.name ?? ''),
          description: String(formValues.description ?? ''),
          status: String(formValues.status ?? '1'),
        });
        notify('保存成功');
      } else {
        await createRole({
          code: String(formValues.code ?? ''),
          name: String(formValues.name ?? ''),
          description: String(formValues.description ?? ''),
          status: String(formValues.status ?? '1'),
          menuIds: [],
        });
        notify('创建成功');
      }
      load();
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : '保存失败', 'error');
      return false;
    }
  };

  const handleSavePerm = async () => {
    if (!permRole) return;
    setPermSaving(true);
    try {
      await updateRole(permRole.id, {
        code: permRole.code,
        name: permRole.name,
        description: permRole.description ?? '',
        status: permRole.status,
        menuIds: permMenuIds,
      });
      notify('权限已更新');
      setPermOpen(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setPermSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteRole(deleteTarget.id);
      notify('删除成功');
      setDeleteTarget(null);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '删除失败', 'error');
    }
  };

  return (
    <Box>
      <SearchForm
        fields={[{ key: 'search', label: '关键词', type: 'text', placeholder: '角色标识/名称' }]}
        values={searchValues}
        onChange={(k, v) => setSearchValues((prev) => ({ ...prev, [k]: v }))}
        onSearch={() => {
          setPage(0);
          setSubmittedSearch({ search: String(searchValues.search ?? '') });
        }}
        onReset={() => {
          setSearchValues({});
          setPage(0);
          setSubmittedSearch({});
        }}
      />

      <DataTable<RoleRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        total={total}
        page={page}
        size={size}
        onPageChange={setPage}
        onSizeChange={(s) => {
          setSize(s);
          setPage(0);
        }}
        toolbar={
          <>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              角色列表
            </Typography>
            <HasPermission code="system:role:add">
              <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>
                新增角色
              </Button>
            </HasPermission>
          </>
        }
      />

      <FormDialog
        open={formOpen}
        title={editing ? '编辑角色' : '新增角色'}
        fields={formFields}
        values={formValues}
        onChange={(k, v) => setFormValues((prev) => ({ ...prev, [k]: v }))}
        onSubmit={handleFormSubmit}
        onClose={() => setFormOpen(false)}
      />

      {/* 菜单权限弹窗 */}
      <Dialog open={permOpen} onClose={() => setPermOpen(false)} fullWidth maxWidth="sm" fullScreen={fullScreen}>
        <DialogTitle>菜单权限：{permRole?.name}</DialogTitle>
        <DialogContent dividers>
          <PermTree menus={allMenus} checked={permMenuIds} onChange={setPermMenuIds} />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button color="inherit" onClick={() => setPermOpen(false)} disabled={permSaving}>
            取消
          </Button>
          <Button variant="contained" onClick={handleSavePerm} disabled={permSaving}>
            保存权限
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        content={`确认删除角色「${deleteTarget?.name}」？已分配该角色的用户将失去对应权限。`}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
        confirmText="删除"
      />
    </Box>
  );
}

// ---------- 权限树 ----------
function buildTree(flat: MenuRow[]): MenuRow[] {
  const map = new Map(flat.map((m) => [m.id, { ...m, children: [] as MenuRow[] }]));
  const roots: MenuRow[] = [];
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) map.get(node.parent_id)!.children!.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: MenuRow[]) => {
    nodes.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    nodes.forEach((n) => sortRec(n.children ?? []));
  };
  sortRec(roots);
  return roots;
}

// 收集子孙 id
function descendants(node: MenuRow): string[] {
  const ids: string[] = [];
  const walk = (n: MenuRow) => {
    ids.push(n.id);
    (n.children ?? []).forEach(walk);
  };
  (node.children ?? []).forEach(walk);
  return ids;
}

function PermTree({
  menus,
  checked,
  onChange,
}: {
  menus: MenuRow[];
  checked: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <List dense disablePadding>
      {menus.map((m) => (
        <PermTreeNode key={m.id} node={m} checked={checked} onChange={onChange} level={0} />
      ))}
    </List>
  );
}

function PermTreeNode({
  node,
  checked,
  onChange,
  level,
}: {
  node: MenuRow;
  checked: string[];
  onChange: (ids: string[]) => void;
  level: number;
}) {
  const [open, setOpen] = useState(true);
  const childIds = useMemo(() => descendants(node), [node]);
  const checkedChildren = childIds.filter((id) => checked.includes(id));
  const allChecked = childIds.length > 0 && checkedChildren.length === childIds.length;
  const someChecked = checkedChildren.length > 0 && !allChecked;
  const selfChecked = checked.includes(node.id);

  const handleToggle = () => {
    if (allChecked) {
      // 取消自己 + 全部子孙
      onChange(checked.filter((id) => id !== node.id && !childIds.includes(id)));
    } else {
      // 勾选自己 + 全部子孙
      onChange([...new Set([...checked, node.id, ...childIds])]);
    }
  };

  return (
    <>
      <ListItemButton sx={{ pl: 1 + level * 2.5, py: 0.5 }} onClick={handleToggle} dense>
        <ListItemIcon sx={{ minWidth: 34 }}>
          <Checkbox
            size="small"
            checked={allChecked || (selfChecked && checkedChildren.length === childIds.length)}
            indeterminate={someChecked}
            onClick={(e) => {
              e.stopPropagation();
              handleToggle();
            }}
          />
        </ListItemIcon>
        <ListItemText
          primary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2">{node.name}</Typography>
              {node.type === 'button' && (
                <Chip size="small" label="按钮" variant="outlined" sx={{ height: 18, '& .MuiChip-label': { px: 0.5, fontSize: 11 } }} />
              )}
              <Typography variant="caption" color="text.secondary">
                {node.code}
              </Typography>
            </Box>
          }
        />
        {node.children && node.children.length > 0 && (
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
            {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
        )}
      </ListItemButton>
      {node.children && node.children.length > 0 && (
        <Collapse in={open} timeout="auto" unmountOnExit>
          <List dense disablePadding>
            {node.children.map((c) => (
              <PermTreeNode key={c.id} node={c} checked={checked} onChange={onChange} level={level + 1} />
            ))}
          </List>
        </Collapse>
      )}
    </>
  );
}
