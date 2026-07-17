import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import db from './db.js';
import projectsRouter from './routes/projects.js';
import tasksRouter from './routes/tasks.js';
import progressRouter from './routes/progress.js';
import filesRouter from './routes/files.js';
import experiencesRouter from './routes/experiences.js';
import workflowsRouter from './routes/workflows.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/workflows', workflowsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/experiences', experiencesRouter);

// Nested routes need parent params
app.use('/api/projects/:projectId/tasks', tasksRouter);
app.use('/api/projects/:projectId/files', filesRouter);
app.use('/api/tasks/:taskId/progress', progressRouter);

// Step file deletion (standalone)
app.delete('/api/step-files/:fileId', (req, res) => {
  const result = db.prepare('DELETE FROM step_files WHERE id = ?').run(req.params.fileId);
  if (result.changes === 0) return res.status(404).json({ error: 'File not found' });
  res.json({ success: true });
});

// Serve static frontend in production (no-cache for HTML to ensure latest build)
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// SPA fallback: serve index.html for non-API routes
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    next();
  }
});

const server = app.listen(PORT, () => {
  console.log(`[DFT+DMFT Workbench] Server running at http://localhost:${PORT}`);
  console.log(`[DFT+DMFT Workbench] 按 Ctrl+C 停止服务`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error('============================================');
    console.error(`  [错误] 端口 ${PORT} 已被占用！`);
    console.error('============================================');
    console.error('  可能原因：另一个 DFT+DMFT Workbench 实例正在运行。');
    console.error('  解决方法：关闭其他实例后重试。');
    console.error('');
  } else {
    console.error(`[错误] 服务器启动失败: ${err.message}`);
  }
  process.exit(1);
});

// 捕获未处理的异常，防止静默崩溃
process.on('uncaughtException', (err) => {
  console.error('[致命错误] 未捕获的异常:', err.message);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[致命错误] 未处理的 Promise 拒绝:', reason);
  process.exit(1);
});
