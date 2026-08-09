# TESTING.md — 应用主体测试基线（D 盘根）

> 最后更新：2026-08-09（安全基线建立）
> 本文件描述 DFT+DMFT Workbench **应用主体**（D 盘根）的测试现状与命令。

## 现状

- **新增基线冒烟测试**：`tests/smoke.test.ts`（node:test 风格，零新增依赖——用 Node 内置 test runner + 项目已有的 tsx）。
- 测试在**临时数据库 + 临时研究方案目录**上运行，**绝不触碰真实用户数据**（`data/workbench.db`、`research-plans/`）。
- 为支持可测试性做了**最小结构改动**（不改变任何业务行为）：
  - `server/db.ts`：DB 路径支持 `WORKBENCH_DB_PATH` 环境变量覆盖（默认仍为 `data/workbench.db`）；导出 `closeDb()` 供测试释放句柄；研究方案目录支持 `WORKBENCH_PLANS_DIR` 覆盖。
  - `server/index.ts`：抽出 `createApp()` 工厂并导出 `server`；端口支持 `WORKBENCH_PORT` 覆盖（默认仍 3001）。
- `package.json` 新增 `test` 脚本。

## 命令

```bash
cd "D:\DFT+DMFT workbench"
npm test              # node --test --import tsx tests/smoke.test.ts
npm run lint          # oxlint（0 errors，11 个历史 warnings）
npm run build         # tsc -b && vite build → dist/index.html
npm start             # 生产运行，http://localhost:3001
```

## 测试覆盖（当前基线，4 个用例）

1. **启动冒烟**：服务器能启动、SPA 根页面返回 200 + HTML。
2. **核心接口可达**：`/api/projects`、`/api/tasks`、`/api/workflows`、`/api/research-plans` 均 200。
3. **项目 CRUD 行为保持**：创建（201）→ 读取（字段一致 + task_count=0）→ 更新（200）→ 删除（200）→ 再读 404。
4. **研究方案行为保持**：创建（写 md 文件 + 元数据 201）→ md 落盘 → 读内容一致 → 删除（文件 + 元数据同步移除）。

## 已知限制

- 未覆盖：tasks 深层流程、files 路径安全、experiences、workflows 编辑、前端 UI 交互。
- 运行测试时 Windows 偶发临时目录文件锁（WAL 句柄释放延迟），测试会忽略该清理错误（无害）。
- 历史测试文件（vitest 配置、hpcPaths.test.ts 等）已在 2026-08-09 快照中被移除；如需单元测试框架，后续另立任务。
