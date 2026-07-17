import { createApp } from './app.js';

const app = createApp();
const PORT = 3001;

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
