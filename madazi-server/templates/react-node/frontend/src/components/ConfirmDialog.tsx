import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  content: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  danger?: boolean;
  confirmText?: string;
}

// 统一确认弹窗（删除等危险操作）
export default function ConfirmDialog({
  open,
  title = '操作确认',
  content,
  onConfirm,
  onClose,
  danger = true,
  confirmText = '确认',
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{content}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} color="inherit">
          取消
        </Button>
        <Button onClick={onConfirm} variant="contained" color={danger ? 'error' : 'primary'}>
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
