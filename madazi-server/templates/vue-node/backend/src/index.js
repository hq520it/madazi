import express from 'express';
import cors from 'cors';
import { initDb } from './db.js';
import itemsRouter from './routes/items.js';

const app = express();
// ★ 平台契约：Node 后端 = 3001（前端 Vite proxy 默认 target http://localhost:3001）
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/items', itemsRouter);

// 统一错误处理
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ code: 500, message: err.message || 'Internal Server Error' });
});

// 启动
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
