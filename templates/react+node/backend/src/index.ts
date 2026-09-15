import express from 'express';
import cors from 'cors';
import { initDb } from './db.js';
import itemsRouter from './routes/items.js';

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json());

// 路由
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/items', itemsRouter);

// 启动
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
  });
});
