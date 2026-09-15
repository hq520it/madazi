import { useMemo } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import { useDict } from '../context/DictContext';

// 统一表单组件：schema 驱动，配合 FormDialog 使用
export interface FormFieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'textarea' | 'number' | 'select' | 'multiselect' | 'switch' | 'date';
  required?: boolean;
  options?: { label: string; value: string }[];
  dictCode?: string; // 从字典上下文自动取选项
  placeholder?: string;
  maxLength?: number;
  minLength?: number;
  min?: number;
  max?: number;
  span?: 1 | 2 | 3; // 栅格跨度（桌面 3 列、pad 2 列、手机 1 列）
  disabled?: boolean;
  hidden?: boolean;
}

export type FormValues = Record<string, unknown>;

export function validateFields(fields: FormFieldDef[], values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (f.hidden || f.disabled) continue;
    const v = values[f.key];
    if (f.required) {
      if (f.type === 'switch') continue; // 开关恒有值
      if (v === undefined || v === null || String(v).trim() === '') {
        errors[f.key] = `${f.label}不能为空`;
        continue;
      }
      if (f.type === 'multiselect' && Array.isArray(v) && v.length === 0) {
        errors[f.key] = `请至少选择一项${f.label}`;
        continue;
      }
    }
    if (v !== undefined && v !== null && String(v).length > 0) {
      if (f.minLength && String(v).length < f.minLength) {
        errors[f.key] = `${f.label}至少 ${f.minLength} 个字符`;
      }
      if (f.maxLength && String(v).length > f.maxLength) {
        errors[f.key] = `${f.label}不能超过 ${f.maxLength} 个字符`;
      }
      if (f.type === 'number') {
        const n = Number(v);
        if (Number.isNaN(n)) {
          errors[f.key] = `${f.label}必须是数字`;
        } else {
          if (f.min !== undefined && n < f.min) errors[f.key] = `${f.label}不能小于 ${f.min}`;
          if (f.max !== undefined && n > f.max) errors[f.key] = `${f.label}不能大于 ${f.max}`;
        }
      }
    }
  }
  return errors;
}

interface SchemaFormProps {
  fields: FormFieldDef[];
  values: FormValues;
  onChange: (key: string, value: unknown) => void;
  errors?: Record<string, string>;
}

// span -> MUI Grid size（桌面 md 3 列 / sm 2 列 / xs 1 列）
function gridSpan(span: 1 | 2 | 3 = 1) {
  const unit = 4; // 12 / 3 列
  const w = Math.min(12, span * unit);
  return {
    xs: 12,
    sm: span >= 2 ? 12 : 6,
    md: w,
  };
}

export default function SchemaForm({ fields, values, onChange, errors = {} }: SchemaFormProps) {
  const { getDict } = useDict();

  const visible = useMemo(() => fields.filter((f) => !f.hidden), [fields]);

  return (
    <Grid container spacing={2}>
      {visible.map((f) => {
        const err = errors[f.key];
        const commonProps = {
          label: f.label,
          placeholder: f.placeholder,
          disabled: f.disabled,
          error: Boolean(err),
          helperText: err,
        } as const;

        return (
          <Grid key={f.key} size={gridSpan(f.span)}>
            {f.type === 'switch' ? (
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(values[f.key])}
                    onChange={(e) => onChange(f.key, e.target.checked ? '1' : '0')}
                    disabled={f.disabled}
                  />
                }
                label={f.label}
              />
            ) : f.type === 'select' || f.type === 'multiselect' ? (
              <TextField
                {...commonProps}
                select
                slotProps={{ select: f.type === 'multiselect' ? { multiple: true } : undefined }}
                value={values[f.key] ?? (f.type === 'multiselect' ? [] : '')}
                onChange={(e) => onChange(f.key, e.target.value)}
              >
                {(f.dictCode ? getDict(f.dictCode) : f.options ?? []).map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
            ) : f.type === 'textarea' ? (
              <TextField
                {...commonProps}
                multiline
                minRows={3}
                maxRows={6}
                slotProps={{ htmlInput: { maxLength: f.maxLength } }}
                value={(values[f.key] as string) ?? ''}
                onChange={(e) => onChange(f.key, e.target.value)}
              />
            ) : (
              <TextField
                {...commonProps}
                type={f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text'}
                slotProps={{ htmlInput: { maxLength: f.maxLength, min: f.min, max: f.max } }}
                value={(values[f.key] as string | number) ?? ''}
                onChange={(e) => onChange(f.key, e.target.value)}
              />
            )}
          </Grid>
        );
      })}
    </Grid>
  );
}
