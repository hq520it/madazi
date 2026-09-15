import express from 'express';
import cors from 'cors';
import { initDb } from './db.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import rolesRouter from './routes/roles.js';
import menusRouter from './routes/menus.js';
import dictsRouter from './routes/dicts.js';
import preferencesRouter from './routes/preferences.js';
import dashboardRouter from './routes/dashboard.js';
import itemsRouter from './routes/items.js';

const app = express();
// ★ 平台契约：Node 后端 = 3001（前端 Vite proxy 默认 target http://localhost:3001）
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// 健康检查（公开）
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 业务路由（auth 内部自行区分公开/鉴权）
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/roles', rolesRouter);
app.use('/api/menus', menusRouter);
app.use('/api/dicts', dictsRouter);
app.use('/api/preferences', preferencesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/items', itemsRouter);

// 统一错误处理
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ code: 500, message: err.message || 'Internal Server Error' });
});

// 启动
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Backend running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('数据库初始化失败:', err);
    process.exit(1);
  });
