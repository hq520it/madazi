import { useState, useEffect } from 'react';
import { api } from '../api';

interface Item {
  id: string;
  name: string;
  description: string;
  status: string;
  created_at: string;
}

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const loadItems = () => api<Item[]>('/items').then(setItems);

  useEffect(() => { loadItems(); }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await api<Item>('/items', {
        method: 'POST',
        body: JSON.stringify({ name, description }),
      });
      setName('');
      setDescription('');
      await loadItems();
    } catch (e) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    await api(`/items/${id}`, { method: 'DELETE' });
    await loadItems();
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1>Items</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          placeholder="名称"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <input
          placeholder="描述"
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
        <button onClick={handleCreate} disabled={loading}>
          {loading ? '创建中...' : '添加'}
        </button>
      </div>

      <div>
        {items.map(item => (
          <div key={item.id} style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '12px 16px', borderBottom: '1px solid #2a2b35',
          }}>
            <div>
              <strong>{item.name}</strong>
              {item.description && <span style={{ marginLeft: 12, opacity: 0.6 }}>{item.description}</span>}
            </div>
            <button
              onClick={() => handleDelete(item.id)}
              style={{ background: '#dc3545' }}
            >
              删除
            </button>
          </div>
        ))}
        {items.length === 0 && <p style={{ opacity: 0.5 }}>暂无数据</p>}
      </div>
    </div>
  );
}
