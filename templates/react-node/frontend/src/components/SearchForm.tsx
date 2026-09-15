import { useState } from 'react';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Checkbox from '@mui/material/Checkbox';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import SearchIcon from '@mui/icons-material/Search';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import TuneIcon from '@mui/icons-material/Tune';
import SchemaForm, { type FormFieldDef, type FormValues } from './SchemaForm';

interface SearchFormProps {
  fields: FormFieldDef[];
  values: FormValues;
  onChange: (key: string, value: unknown) => void;
  onSearch: () => void;
  onReset: () => void;
  /** 搜索条件显隐配置（跟着用户走） */
  setting?: {
    visibleKeys: string[];
    onChange: (keys: string[]) => void;
  };
}

// 统一搜索表单：条件 schema 驱动 + 显隐配置 + 响应式栅格
export default function SearchForm({ fields, values, onChange, onSearch, onReset, setting }: SearchFormProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  // 按配置过滤 + 排序；无配置时显示全部
  const visibleFields = setting
    ? setting.visibleKeys
        .map((k) => fields.find((f) => f.key === k))
        .filter((f): f is FormFieldDef => Boolean(f))
    : fields;

  const handleToggle = (key: string, checked: boolean) => {
    if (!setting) return;
    if (checked) {
      setting.onChange([...setting.visibleKeys, key]);
    } else {
      if (setting.visibleKeys.length <= 1) return; // 至少保留一个条件
      setting.onChange(setting.visibleKeys.filter((k) => k !== key));
    }
  };

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch();
      }}
      sx={{ mb: 2 }}
    >
      <Grid container spacing={2} sx={{ alignItems: 'flex-start' }}>
        {visibleFields.map((f) => (
          <Grid key={f.key} size={{ xs: 12, sm: 6, md: 3 }}>
            <SchemaForm
              fields={[{ ...f, required: false }]}
              values={values}
              onChange={onChange}
            />
          </Grid>
        ))}
        <Grid size={{ xs: 12, sm: 'auto' }}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', pt: 0.5 }}>
            <Button type="submit" variant="contained" startIcon={<SearchIcon />}>
              查询
            </Button>
            <Button variant="outlined" color="inherit" startIcon={<RestartAltIcon />} onClick={onReset}>
              重置
            </Button>
            {setting && (
              <Tooltip title="搜索条件设置">
                <IconButton size="small" onClick={(e) => setAnchorEl(e.currentTarget)} aria-label="搜索条件设置">
                  <TuneIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Grid>
      </Grid>

      {/* 条件设置弹层 */}
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 260, p: 1 } } }}
      >
        <Typography variant="subtitle2" sx={{ px: 1, py: 0.5, color: 'text.secondary' }}>
          显示的搜索条件（自动保存）
        </Typography>
        {fields.map((f) => {
          const visible = setting!.visibleKeys.includes(f.key);
          return (
            <Box key={f.key} sx={{ display: 'flex', alignItems: 'center', borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}>
              <Checkbox size="small" checked={visible} onChange={(e) => handleToggle(f.key, e.target.checked)} />
              <Typography variant="body2">{f.label}</Typography>
            </Box>
          );
        })}
      </Popover>
    </Box>
  );
}
