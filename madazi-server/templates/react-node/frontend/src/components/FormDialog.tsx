import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { useMediaQuery, useTheme } from '@mui/material';
import SchemaForm, { validateFields, type FormFieldDef, type FormValues } from './SchemaForm';

interface FormDialogProps {
  open: boolean;
  title: string;
  fields: FormFieldDef[];
  values: FormValues;
  onChange: (key: string, value: unknown) => void;
  onSubmit: () => Promise<boolean | void>; // 返回 false 表示不关闭弹窗
  onClose: () => void;
  submitText?: string;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg';
}

// 统一表单弹窗：校验 + 提交 loading + 手机全屏
export default function FormDialog({
  open,
  title,
  fields,
  values,
  onChange,
  onSubmit,
  onClose,
  submitText = '保存',
  maxWidth = 'sm',
}: FormDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('md'));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setErrors({});
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async () => {
    const errs = validateFields(fields, values);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setSubmitting(true);
    try {
      const ok = await onSubmit();
      if (ok !== false) onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth={maxWidth} fullScreen={fullScreen}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <SchemaForm fields={fields} values={values} onChange={onChange} errors={errors} />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} color="inherit" disabled={submitting}>
          取消
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting} startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : null}>
          {submitText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
