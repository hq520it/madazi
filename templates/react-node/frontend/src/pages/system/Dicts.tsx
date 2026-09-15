import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { useMediaQuery, useTheme } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ListIcon from '@mui/icons-material/List';
import SearchForm from '../../components/SearchForm';
import DataTable, { type ColumnDef } from '../../components/DataTable';
import FormDialog from '../../components/FormDialog';
import ConfirmDialog from '../../components/ConfirmDialog';
import DictTag from '../../components/DictTag';
import { HasPermission } from '../../components/HasPermission';
import type { FormFieldDef, FormValues } from '../../components/SchemaForm';
import {
  listDictTypes,
  createDictType,
  updateDictType,
  deleteDictType,
  listDictItems,
  createDictItem,
  updateDictItem,
  deleteDictItem,
} from '../../api/dicts';
import { useSnackbar } from '../../context/SnackbarContext';
import { useDict } from '../../context/DictContext';
import type { DictItemRow, DictTypeRow } from '../../types';

// 字典管理：类型列表 + 字典项管理弹窗
export default function Dicts() {
  const { notify } = useSnackbar();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('md'));
  const { reload: reloadDicts } = useDict();

  // 类型列表
  const [rows, setRows] = useState<DictTypeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [searchValues, setSearchValues] = useState<FormValues>({});
  const [submittedSearch, setSubmittedSearch] = useState<{ search?: string }>({});

  // 类型表单
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DictTypeRow | null>(null);
  const [formValues, setFormValues] = useState<FormValues>({});
  const [deleteTarget, setDeleteTarget] = useState<DictTypeRow | null>(null);

  // 字典项管理
  const [itemsOpen, setItemsOpen] = useState(false);
  const [itemsType, setItemsType] = useState<DictTypeRow | null>(null);
  const [items, setItems] = useState<DictItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<DictItemRow | null>(null);
  const [itemFormValues, setItemFormValues] = useState<FormValues>({});
  const [deleteItemTarget, setDeleteItemTarget] = useState<DictItemRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listDictTypes({ page, size, ...submittedSearch });
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

  const columns: ColumnDef<DictTypeRow>[] = [
    { key: 'name', title: '字典名称' },
    { key: 'code', title: '字典编码' },
    { key: 'description', title: '描述', render: (r) => r.description ?? '-' },
    { key: 'itemCount', title: '字典项数', align: 'center', width: 100 },
    { key: 'status', title: '状态', width: 90, render: (r) => <DictTag dictCode="sys_status" value={r.status} /> },
    {
      key: 'updated_at',
      title: '更新时间',
      render: (r) => (r.updated_at ? new Date(r.updated_at).toLocaleString() : '-'),
    },
    {
      key: 'actions',
      title: '操作',
      width: 170,
      align: 'center',
      configurable: false,
      render: (r) => (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Tooltip title="管理字典项">
            <IconButton size="small" color="primary" onClick={() => openItems(r)}>
              <ListIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <HasPermission code="system:dict:edit">
            <Tooltip title="编辑">
              <IconButton size="small" onClick={() => openEdit(r)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </HasPermission>
          <HasPermission code="system:dict:delete">
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

  // ---------- 类型表单 ----------
  const typeFields: FormFieldDef[] = [
    { key: 'code', label: '字典编码', type: 'text', required: true, maxLength: 64, placeholder: '如: order_status' },
    { key: 'name', label: '字典名称', type: 'text', required: true, maxLength: 64 },
    { key: 'description', label: '描述', type: 'textarea', maxLength: 255, span: 2 },
    { key: 'status', label: '状态', type: 'select', dictCode: 'sys_status', required: true },
  ];

  const openAdd = () => {
    setEditing(null);
    setFormValues({ status: '1' });
    setFormOpen(true);
  };

  const openEdit = (r: DictTypeRow) => {
    setEditing(r);
    setFormValues({ code: r.code, name: r.name, description: r.description ?? '', status: r.status });
    setFormOpen(true);
  };

  const handleFormSubmit = async () => {
    try {
      const data = {
        code: String(formValues.code ?? ''),
        name: String(formValues.name ?? ''),
        description: String(formValues.description ?? ''),
        status: String(formValues.status ?? '1'),
      };
      if (editing) {
        await updateDictType(editing.id, data);
        notify('保存成功');
      } else {
        await createDictType(data);
        notify('创建成功');
      }
      load();
      reloadDicts();
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : '保存失败', 'error');
      return false;
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDictType(deleteTarget.id);
      notify('删除成功');
      setDeleteTarget(null);
      load();
      reloadDicts();
    } catch (err) {
      notify(err instanceof Error ? err.message : '删除失败', 'error');
    }
  };

  // ---------- 字典项管理 ----------
  const loadItems = useCallback(async (typeCode: string) => {
    setItemsLoading(true);
    try {
      setItems(await listDictItems(typeCode));
    } catch (err) {
      notify(err instanceof Error ? err.message : '加载字典项失败', 'error');
    } finally {
      setItemsLoading(false);
    }
  }, [notify]);

  const openItems = (r: DictTypeRow) => {
    setItemsType(r);
    setItemsOpen(true);
    loadItems(r.code);
  };

  const itemFields: FormFieldDef[] = [
    ...(itemsType ? [{ key: 'type_code_display', label: '所属字典', type: 'text' as const, disabled: true }] : []),
    { key: 'label', label: '标签', type: 'text', required: true, maxLength: 128 },
    { key: 'value', label: '键值', type: 'text', required: true, maxLength: 128 },
    {
      key: 'color',
      label: '颜色',
      type: 'select',
      options: [
        { label: '默认', value: 'default' },
        { label: '主要', value: 'primary' },
        { label: '成功', value: 'success' },
        { label: '信息', value: 'info' },
        { label: '警告', value: 'warning' },
        { label: '错误', value: 'error' },
      ],
    },
    { key: 'sort', label: '排序', type: 'number', min: 0 },
    { key: 'status', label: '状态', type: 'select', dictCode: 'sys_status', required: true },
  ];

  const openAddItem = () => {
    setEditingItem(null);
    setItemFormValues({ status: '1', sort: 0, color: 'default' });
    setItemFormOpen(true);
  };

  const openEditItem = (r: DictItemRow) => {
    setEditingItem(r);
    setItemFormValues({
      label: r.label,
      value: r.value,
      color: r.color ?? 'default',
      sort: r.sort,
      status: r.status,
    });
    setItemFormOpen(true);
  };

  const handleItemSubmit = async () => {
    if (!itemsType) return false;
    try {
      const data = {
        type_code: itemsType.code,
        label: String(itemFormValues.label ?? ''),
        value: String(itemFormValues.value ?? ''),
        color: String(itemFormValues.color ?? 'default'),
        sort: Number(itemFormValues.sort ?? 0) || 0,
        status: String(itemFormValues.status ?? '1'),
      };
      if (editingItem) {
        await updateDictItem(editingItem.id, data);
        notify('保存成功');
      } else {
        await createDictItem(data);
        notify('创建成功');
      }
      loadItems(itemsType.code);
      reloadDicts();
      load(); // 刷新字典项计数
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : '保存失败', 'error');
      return false;
    }
  };

  const handleDeleteItem = async () => {
    if (!deleteItemTarget || !itemsType) return;
    try {
      await deleteDictItem(deleteItemTarget.id);
      notify('删除成功');
      setDeleteItemTarget(null);
      loadItems(itemsType.code);
      reloadDicts();
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '删除失败', 'error');
    }
  };

  return (
    <Box>
      <SearchForm
        fields={[{ key: 'search', label: '关键词', type: 'text', placeholder: '字典编码/名称' }]}
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

      <DataTable<DictTypeRow>
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
              字典类型
            </Typography>
            <HasPermission code="system:dict:add">
              <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>
                新增字典
              </Button>
            </HasPermission>
          </>
        }
      />

      <FormDialog
        open={formOpen}
        title={editing ? '编辑字典类型' : '新增字典类型'}
        fields={typeFields}
        values={formValues}
        onChange={(k, v) => setFormValues((prev) => ({ ...prev, [k]: v }))}
        onSubmit={handleFormSubmit}
        onClose={() => setFormOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        content={`确认删除字典「${deleteTarget?.name}」？其下所有字典项将一并删除。`}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
        confirmText="删除"
      />

      {/* 字典项管理弹窗 */}
      <Dialog open={itemsOpen} onClose={() => setItemsOpen(false)} fullWidth maxWidth="md" fullScreen={fullScreen}>
        <DialogTitle>
          字典项管理：{itemsType?.name}
          <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
            ({itemsType?.code})
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
            <HasPermission code="system:dict:edit">
              <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openAddItem}>
                新增字典项
              </Button>
            </HasPermission>
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>标签</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>键值</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>预览</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="center">排序</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>状态</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="center">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {itemsLoading ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
                    加载中…
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                    暂无字典项
                  </TableCell>
                </TableRow>
              ) : (
                items.map((it) => (
                  <TableRow key={it.id} hover>
                    <TableCell>{it.label}</TableCell>
                    <TableCell>{it.value}</TableCell>
                    <TableCell>
                      <DictTag dictCode={itemsType!.code} value={it.value} />
                    </TableCell>
                    <TableCell align="center">{it.sort}</TableCell>
                    <TableCell>
                      <DictTag dictCode="sys_status" value={it.status} />
                    </TableCell>
                    <TableCell align="center">
                      <HasPermission code="system:dict:edit">
                        <IconButton size="small" onClick={() => openEditItem(it)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </HasPermission>
                      <HasPermission code="system:dict:edit">
                        <IconButton size="small" color="error" onClick={() => setDeleteItemTarget(it)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </HasPermission>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button color="inherit" onClick={() => setItemsOpen(false)}>
            关闭
          </Button>
        </DialogActions>
      </Dialog>

      <FormDialog
        open={itemFormOpen}
        title={editingItem ? '编辑字典项' : '新增字典项'}
        fields={itemFields}
        values={
          editingItem
            ? itemFormValues
            : { ...itemFormValues, type_code_display: itemsType ? `${itemsType.name} (${itemsType.code})` : '' }
        }
        onChange={(k, v) => setItemFormValues((prev) => ({ ...prev, [k]: v }))}
        onSubmit={handleItemSubmit}
        onClose={() => setItemFormOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(deleteItemTarget)}
        content={`确认删除字典项「${deleteItemTarget?.label}」？`}
        onConfirm={handleDeleteItem}
        onClose={() => setDeleteItemTarget(null)}
        confirmText="删除"
      />
    </Box>
  );
}
