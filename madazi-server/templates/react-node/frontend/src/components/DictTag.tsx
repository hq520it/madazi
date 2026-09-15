import Chip from '@mui/material/Chip';
import { useDict } from '../context/DictContext';

// 字典标签：按 dictCode 渲染彩色 Chip
export default function DictTag({ dictCode, value }: { dictCode: string; value?: string | null }) {
  const { getDict } = useDict();
  if (value === undefined || value === null || value === '') {
    return <>-</>;
  }
  const item = getDict(dictCode).find((i) => i.value === value);
  if (!item) return <>{String(value)}</>;
  return <Chip label={item.label} color={(item.color as 'default') || 'default'} size="small" variant="outlined" />;
}
