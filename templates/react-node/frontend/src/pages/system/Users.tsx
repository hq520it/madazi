import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import LockResetIcon from '@mui/icons-material/LockReset';
import SearchForm from '../../components/SearchForm';
import DataTable, { type ColumnDef } from '../../components/DataTable';
import FormDialog from '../../components/FormDialog';
import ConfirmDialog from '../../components/ConfirmDialog';
import DictTag from '../../components/DictTag';
import { HasPermission } from '../../components/HasPermission';
import type { FormFieldDef, FormValues } from '../../components/SchemaForm';
import { listUsers, createUser, updateUser, resetPassword, deleteUser, allRoles } from '../../api/users';
import { useSnackbar } from '../../context/SnackbarContext';
import type { Role, UserRow } from '../../types';

// 用户管理：搜索 + 表格 + 新增/编辑（含角色分配）+ 重置密码 + 删除
export default function Users() {
  const { notify } = useSnackbar();

  // 列表状态
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [searchValues, setSearchValues] = useState<FormValues>({});
  const [submittedSearch, setSubmittedSearch] = useState<{ search?: string; status?: string }>({});

  // 角色选项
  const [roleOptions, setRoleOptions] = useState<Role[]>([]);

  // 弹窗状态
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [formValues, setFormValues] = useState<FormValues>({});
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdTarget, setPwdTarget] = useState<UserRow | null>(null);
  const [pwdValue, setPwdValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listUsers({ page, size, ...submittedSearch });
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

  useEffect(() => {
    allRoles()
      .then(setRoleOptions)
      .catch(() => {});
  }, []);

  // 表格列定义
  const columns: ColumnDef<UserRow>[] = [
    { key: 'username', title: '用户名' },
    { key: 'nickname', title: '昵称', render: (r) => r.nickname ?? '-' },
    { key: 'email', title: '邮箱', render: (r) => r.email ?? '-' },
    { key: 'phone', title: '手机号', render: (r) => r.phone ?? '-' },
    {
      key: 'status',
      title: '状态',
      width: 90,
      render: (r) => <DictTag dictCode="sys_status" value={r.status} />,
    },
    {
      key: 'roles',
      title: '角色',
      render: (r) =>
        r.roles.length === 0
          ? '-'
          : r.roles.map((role) => (
              <Chip key={role.id} label={role.name} size="small" sx={{ mr: 0.5 }} variant="outlined" />
            )),
    },
    {
      key: 'created_at',
      title: '创建时间',
      render: (r) => (r.created_at ? new Date(r.created_at).toLocaleString() : '-'),
    },
    {
      key: 'actions',
      title: '操作',
      width: 140,
      align: 'center',
      configurable: false,
      render: (r) => (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <HasPermission code="system:user:edit">
            <Tooltip title="编辑">
              <IconButton size="small" onClick={() => openEdit(r)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </HasPermission>
          <HasPermission code="system:user:resetPwd">
            <Tooltip title="重置密码">
              <IconButton size="small" onClick={() => { setPwdTarget(r); setPwdValue(''); setPwdOpen(true); }}>
                <LockResetIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </HasPermission>
          <HasPermission code="system:user:delete">
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

  // 表单字段（新增/编辑复用）
  const formFields: FormFieldDef[] = [
    { key: 'username', label: '用户名', type: 'text', required: true, maxLength: 64, disabled: Boolean(editing) },
    ...(editing ? [] : [{ key: 'password', label: '初始密码', type: 'password' as const, required: true, minLength: 6, maxLength: 64 }]),
    { key: 'nickname', label: '昵称', type: 'text', maxLength: 64 },
    { key: 'email', label: '邮箱', type: 'text', maxLength: 128 },
    { key: 'phone', label: '手机号', type: 'text', maxLength: 32 },
    { key: 'status', label: '状态', type: 'select', dictCode: 'sys_status', required: true },
    { key: 'roleIds', label: '角色', type: 'multiselect', options: roleOptions.map((r) => ({ label: r.name, value: r.id })) },
  ];

  const openAdd = () => {
    setEditing(null);
    setFormValues({ status: '1', roleIds: [] });
    setFormOpen(true);
  };

  const openEdit = (r: UserRow) => {
    setEditing(r);
    setFormValues({
      username: r.username,
      nickname: r.nickname ?? '',
      email: r.email ?? '',
      phone: r.phone ?? '',
      status: r.status,
      roleIds: r.roles.map((role) => role.id),
    });
    setFormOpen(true);
  };

  const handleFormChange = (key: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    try {
      if (editing) {
        await updateUser(editing.id, {
          nickname: String(formValues.nickname ?? ''),
          email: String(formValues.email ?? ''),
          phone: String(formValues.phone ?? ''),
          status: String(formValues.status ?? '1'),
          roleIds: (formValues.roleIds as string[]) ?? [],
        });
        notify('保存成功');
      } else {
        await createUser({
          username: String(formValues.username ?? ''),
          password: String(formValues.password ?? ''),
          nickname: String(formValues.nickname ?? ''),
          email: String(formValues.email ?? ''),
          phone: String(formValues.phone ?? ''),
          status: String(formValues.status ?? '1'),
          roleIds: (formValues.roleIds as string[]) ?? [],
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

  const handleResetPwd = async () => {
    if (!pwdTarget) return;
    if (pwdValue.length < 6) {
      notify('密码至少 6 位', 'warning');
      return;
    }
    try {
      await resetPassword(pwdTarget.id, pwdValue);
      notify('密码已重置');
      setPwdOpen(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : '重置失败', 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteUser(deleteTarget.id);
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
        fields={[
          { key: 'search', label: '关键词', type: 'text', placeholder: '用户名/昵称/邮箱/手机号' },
          { key: 'status', label: '状态', type: 'select', dictCode: 'sys_status' },
        ]}
        values={searchValues}
        onChange={(k, v) => setSearchValues((prev) => ({ ...prev, [k]: v }))}
        onSearch={() => {
          setPage(0);
          setSubmittedSearch({ search: String(searchValues.search ?? ''), status: String(searchValues.status ?? '') });
        }}
        onReset={() => {
          setSearchValues({});
          setPage(0);
          setSubmittedSearch({});
        }}
      />

      <DataTable<UserRow>
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
              用户列表
            </Typography>
            <HasPermission code="system:user:add">
              <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>
                新增用户
              </Button>
            </HasPermission>
          </>
        }
      />

      <FormDialog
        open={formOpen}
        title={editing ? '编辑用户' : '新增用户'}
        fields={formFields}
        values={formValues}
        onChange={handleFormChange}
        onSubmit={handleSubmit}
        onClose={() => setFormOpen(false)}
      />

      <FormDialog
        open={pwdOpen}
        title={`重置密码：${pwdTarget?.username ?? ''}`}
        fields={[{ key: 'password', label: '新密码', type: 'password', required: true, minLength: 6, maxLength: 64 }]}
        values={{ password: pwdValue }}
        onChange={(_, v) => setPwdValue(String(v))}
        onSubmit={handleResetPwd}
        onClose={() => setPwdOpen(false)}
        submitText="重置"
        maxWidth="xs"
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        content={`确认删除用户「${deleteTarget?.username}」？该操作不可恢复。`}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
        confirmText="删除"
      />
    </Box>
  );
}
