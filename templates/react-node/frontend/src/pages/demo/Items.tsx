import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchForm from '../../components/SearchForm';
import DataTable, { type ColumnDef } from '../../components/DataTable';
import FormDialog from '../../components/FormDialog';
import ConfirmDialog from '../../components/ConfirmDialog';
import DictTag from '../../components/DictTag';
import { HasPermission } from '../../components/HasPermission';
import type { FormFieldDef, FormValues } from '../../components/SchemaForm';
import { listItems, createItem, updateItem, deleteItem } from '../../api/biz';
import { usePageConfig } from '../../hooks/usePageConfig';
import { useSnackbar } from '../../context/SnackbarContext';
import type { Item } from '../../types';

// 页面配置编码（按用户持久化：搜索条件显隐 + 表格列显隐顺序）
const PAGE_CODE = 'demo_items';

// 默认配置：全部条件/列可见
const DEFAULT_SEARCH_FIELDS = ['search', 'category', 'status'];
const DEFAULT_COLUMNS = ['name', 'description', 'category', 'status', 'created_at'];

// 物品管理：统一组件全链路示例（搜索 + 表格 + 表单 + 字典 + 用户级配置）
export default function Items() {
  const { notify } = useSnackbar();

  // 用户级页面配置（跟着用户走，换账号互不影响）
  const { config, ready, save } = usePageConfig(PAGE_CODE, {
    searchFields: DEFAULT_SEARCH_FIELDS,
    columns: DEFAULT_COLUMNS,
  });

  // 列表状态
  const [rows, setRows] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [searchValues, setSearchValues] = useState<FormValues>({});
  const [submitted, setSubmitted] = useState<{ search?: string; category?: string; status?: string }>({});

  // 弹窗
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [formValues, setFormValues] = useState<FormValues>({});
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listItems({ page, size, ...submitted });
      setRows(res.list);
      setTotal(res.total);
    } catch (err) {
      notify(err instanceof Error ? err.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, size, submitted, notify]);

  useEffect(() => {
    if (ready) load();
  }, [load, ready]);

  // 搜索条件 schema（显隐可配置）
  const searchFields: FormFieldDef[] = [
    { key: 'search', label: '关键词', type: 'text', placeholder: '名称/描述' },
    { key: 'category', label: '分类', type: 'select', dictCode: 'item_category' },
    { key: 'status', label: '状态', type: 'select', dictCode: 'sys_status' },
  ];

  // 表格列定义（显隐 + 顺序可配置）
  const columns: ColumnDef<Item>[] = [
    { key: 'name', title: '名称' },
    { key: 'description', title: '描述', render: (r) => r.description ?? '-' },
    { key: 'category', title: '分类', width: 110, render: (r) => <DictTag dictCode="item_category" value={r.category} /> },
    { key: 'status', title: '状态', width: 90, render: (r) => <DictTag dictCode="sys_status" value={r.status} /> },
    {
      key: 'created_at',
      title: '创建时间',
      render: (r) => (r.created_at ? new Date(r.created_at).toLocaleString() : '-'),
    },
    {
      key: 'actions',
      title: '操作',
      width: 120,
      align: 'center',
      configurable: false,
      render: (r) => (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <HasPermission code="demo:item:edit">
            <Tooltip title="编辑">
              <IconButton size="small" onClick={() => openEdit(r)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </HasPermission>
          <HasPermission code="demo:item:delete">
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

  // 表单字段
  const formFields: FormFieldDef[] = [
    { key: 'name', label: '名称', type: 'text', required: true, maxLength: 128 },
    { key: 'category', label: '分类', type: 'select', dictCode: 'item_category' },
    { key: 'status', label: '状态', type: 'select', dictCode: 'sys_status', required: true },
    { key: 'description', label: '描述', type: 'textarea', maxLength: 500, span: 3 },
  ];

  const openAdd = () => {
    setEditing(null);
    setFormValues({ status: '1' });
    setFormOpen(true);
  };

  const openEdit = (r: Item) => {
    setEditing(r);
    setFormValues({ name: r.name, category: r.category ?? '', status: r.status, description: r.description ?? '' });
    setFormOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const data = {
        name: String(formValues.name ?? ''),
        category: String(formValues.category ?? '') || null,
        status: String(formValues.status ?? '1'),
        description: String(formValues.description ?? '') || null,
      };
      if (editing) {
        await updateItem(editing.id, data);
        notify('保存成功');
      } else {
        await createItem(data);
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
      await deleteItem(deleteTarget.id);
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
        fields={searchFields}
        values={searchValues}
        onChange={(k, v) => setSearchValues((prev) => ({ ...prev, [k]: v }))}
        onSearch={() => {
          setPage(0);
          setSubmitted({
            search: String(searchValues.search ?? ''),
            category: String(searchValues.category ?? ''),
            status: String(searchValues.status ?? ''),
          });
        }}
        onReset={() => {
          setSearchValues({});
          setPage(0);
          setSubmitted({});
        }}
        setting={
          ready
            ? {
                visibleKeys: config.searchFields ?? DEFAULT_SEARCH_FIELDS,
                onChange: (keys) => {
                  if (keys.length === 0) return;
                  save({ searchFields: keys, columns: config.columns ?? DEFAULT_COLUMNS });
                },
              }
            : undefined
        }
      />

      <DataTable<Item>
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
              物品列表
            </Typography>
            <HasPermission code="demo:item:add">
              <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>
                新增物品
              </Button>
            </HasPermission>
          </>
        }
        columnSetting={
          ready
            ? {
                visibleKeys: config.columns ?? DEFAULT_COLUMNS,
                onChange: (keys) => {
                  if (keys.length === 0) return;
                  save({ searchFields: config.searchFields ?? DEFAULT_SEARCH_FIELDS, columns: keys });
                },
              }
            : undefined
        }
      />

      <FormDialog
        open={formOpen}
        title={editing ? '编辑物品' : '新增物品'}
        fields={formFields}
        values={formValues}
        onChange={(k, v) => setFormValues((prev) => ({ ...prev, [k]: v }))}
        onSubmit={handleSubmit}
        onClose={() => setFormOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        content={`确认删除物品「${deleteTarget?.name}」？`}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
        confirmText="删除"
      />
    </Box>
  );
}
