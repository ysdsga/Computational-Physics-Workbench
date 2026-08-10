# TESTING.md — 应用主体测试基线（D 盘根）

> 最后更新：2026-08-10（任务独立工作流）
> 本文件描述 DFT+DMFT Workbench **应用主体**（D 盘根）的测试现状与命令。

## 现状

- **新增基线冒烟测试**：`tests/smoke.test.ts`（node:test 风格，零新增依赖——用 Node 内置 test runner + 项目已有的 tsx）。
- 测试在**临时数据库 + 临时项目工作目录**上运行，**绝不触碰真实用户数据**（`data/workbench.db`、真实项目目录）。
- 为支持可测试性做了**最小结构改动**：
  - `server/db.ts`：DB 路径支持 `WORKBENCH_DB_PATH` 环境变量覆盖（默认仍为 `data/workbench.db`）；导出 `closeDb()` 供测试释放句柄。
  - `server/index.ts`：抽出 `createApp()` 工厂并导出 `server`；端口支持 `WORKBENCH_PORT` 覆盖（默认仍 3001）。
- `package.json` 新增 `test` 脚本。

## 命令

```bash
cd "D:\DFT+DMFT workbench"
npm test              # node --test --import tsx tests/smoke.test.ts
npm run lint          # oxlint（0 errors，10 个历史 warnings）
npm run build         # tsc -b && vite build → dist/index.html
npm start             # 生产运行，http://localhost:3001
```

## 测试覆盖（当前基线，9 个用例）

1. **启动冒烟**：服务器能启动、SPA 根页面返回 200 + HTML。
2. **核心接口可达**：`/api/projects`、`/api/tasks`、`/api/workflows`、`/api/research-plans` 均 200。
3. **多软件栈模板**：现役内置模板可增量播种，阶段引用有效，创建任务时生成对应阶段目录。
4. **任务独立工作流**：旧任务快照可补齐；模板后续修改不影响任务；任务修改不回写模板；新增阶段会生成目录。
5. **工作流模板预览**：页面为每个现役内置模板提供选择项，已移除模板不会再次出现。
6. **项目 CRUD 行为保持**：创建（201）→ 读取（字段一致 + task_count=0）→ 更新（200）→ 删除（200）→ 再读 404。
7. **研究方案项目归属**：无项目时拒绝创建；文件只写入项目 `working_dir`；不同项目允许同名方案；删除时同步移除所属项目中的文件。
8. **研究方案目录容错**：项目工作目录暂时不可用时，列表仍返回全部元数据，并把对应方案标记为文件丢失。
9. **研究方案迁移安全**：旧的全局文件名唯一约束迁移为项目内唯一，已有元数据在初始化后仍然存在。

## 已知限制

- 未覆盖：files 路径安全、experiences，以及任务编辑器的完整前端交互；任务工作流快照与保存 API 已覆盖。
- 运行测试时 Windows 偶发临时目录文件锁（WAL 句柄释放延迟），测试会忽略该清理错误（无害）。
- 历史测试文件（vitest 配置、hpcPaths.test.ts 等）已在 2026-08-09 快照中被移除；如需单元测试框架，后续另立任务。
