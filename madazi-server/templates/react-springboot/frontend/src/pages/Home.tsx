import { useState, useEffect } from 'react';
import { api } from '../api';

interface Item {
  id: string;
  name: string;
  description?: string;
}

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');

  const load = () => {
    api<{ data: Item[] }>('/items').then(res => setItems(res.data ?? [])).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const add = () => {
    api('/items', {
      method: 'POST',
      body: JSON.stringify({ name, description: desc })
    }).then(() => { setName(''); setDesc(''); load(); });
  };

  const del = (id: string) => {
    api(`/items/${id}`, { method: 'DELETE' }).then(load);
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20, fontFamily: 'system-ui' }}>
      <h1>项目首页</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="名称" style={{ padding: 8 }} />
        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="描述" style={{ padding: 8, flex: 1 }} />
        <button onClick={add} style={{ padding: '8px 16px' }}>添加</button>
      </div>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map(i => (
          <li key={i.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 8, borderBottom: '1px solid #eee' }}>
            <span>{i.name} - {i.description}</span>
            <button onClick={() => del(i.id)}>删除</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
