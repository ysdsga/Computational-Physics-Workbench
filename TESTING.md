# TESTING.md — 应用主体测试基线（D 盘根）

> 最后更新：2026-08-15（Agent 科研环境 V1 提交前加固）
> 本文件描述 DFT+DMFT Workbench **应用主体**（D 盘根）的测试现状与命令。

## 现状

- 后端/API 使用 Node `node:test`；路径边界在 `tests/path-safety.test.ts`；浏览器流程使用 Playwright。
- 测试在**临时数据库 + 临时项目工作目录**上运行，**绝不触碰真实用户数据**（`data/workbench.db`、真实项目目录）。
- 为支持可测试性做了**最小结构改动**：
  - `server/db.ts`：DB 路径支持 `WORKBENCH_DB_PATH` 环境变量覆盖（默认仍为 `data/workbench.db`）；导出 `closeDb()` 供测试释放句柄。
  - `server/index.ts`：抽出 `createApp()` 工厂并导出 `server`；端口支持 `WORKBENCH_PORT` 覆盖（默认仍 3001）。
- `package.json` 新增 `test` 脚本。

## 命令

```bash
cd "D:\DFT+DMFT workbench"
npm test              # node --test --import tsx "tests/**/*.test.ts"
npm run lint          # oxlint（0 errors，10 个历史 warnings）
npm run typecheck     # 前端与后端 TypeScript
npm run build         # typecheck + Vite 单文件构建
npm run test:e2e      # 临时数据库启动服务并验证 UI
npm start             # 生产运行，http://127.0.0.1:3001
```

## 自动隔离测试覆盖

1. **启动冒烟**：服务器能启动、SPA 根页面返回 200 + HTML。
2. **核心接口可达**：`/api/projects`、`/api/tasks`、`/api/workflows`、`/api/research-plans` 均 200。
3. **多软件栈模板**：现役内置模板可增量播种，阶段引用有效，创建任务时生成对应阶段目录。
4. **任务独立工作流**：旧任务快照可补齐；模板后续修改不影响任务；任务修改不回写模板；新增阶段会生成目录。
5. **工作流模板预览**：页面为每个现役内置模板提供选择项，已移除模板不会再次出现。
6. **项目 CRUD 行为保持**：创建（201）→ 读取（字段一致 + task_count=0）→ 更新（200）→ 删除（200）→ 再读 404。
7. **研究方案项目归属**：无项目时拒绝创建；文件只写入项目 `working_dir`；不同项目允许同名方案；删除时同步移除所属项目中的文件。
8. **研究方案目录容错**：项目工作目录暂时不可用时，列表仍返回全部元数据，并把对应方案标记为文件丢失。
9. **研究方案迁移安全**：旧的全局文件名唯一约束迁移为项目内唯一，已有元数据在初始化后仍然存在。
10. **路径安全**：绝对路径、`..`、同名前缀目录和符号链接逃逸失败关闭。
11. **Agent V1 内核**：合同绑定、运行/上下文冻结、事件幂等、越界修订评价、重复评价拒绝和归档保护。
12. **策略边界**：下层 host、操作、方法、根和资源上限不能扩大上层权限。
13. **提交前加固**：任务根不可回退到项目根；合同约束不能静默删除；评价请求幂等；保护路径和 smoke 预算在执行点生效。

浏览器 E2E 使用临时数据库覆盖空状态，以及“初始化合同 → 激活任务策略 → 启动运行 → 创建并批准评价”的完整研究者路径。

## 真实 SSH/LSF pilot

真实测试不会进入 `npm test`，也不会使用真实用户数据库。先用普通 `ssh <alias>` 人工确认 host key，并在测试用临时 Project/Task/Run 中配置 active task policy。服务需设置：

```powershell
$env:WORKBENCH_REMOTE_ENABLED='1'
$env:WORKBENCH_ALLOW_REMOTE_SMOKE='1'  # 仅 smoke 时
$env:WORKBENCH_TEST_TASK_ID='<临时任务 ID>'
$env:WORKBENCH_TEST_SSH_HOST='<OpenSSH alias>'
$env:WORKBENCH_TEST_REMOTE_ROOT='<批准的测试根>'
$env:WORKBENCH_TEST_LSF_QUEUE='<可选 queue>'

npm run test:ssh:inspect
$env:WORKBENCH_LIVE_SMOKE_CONFIRM='1'
npm run test:ssh:lsf-smoke
```

`inspect` 不创建目录、不传文件、不提交作业。固定 smoke 使用 1 核、1 分钟上限，保留远程 `.workbench-smoke/<token>/` 证据，不自动删除。没有上述 pilot 参数时两个命令明确输出 `SKIP`。

## 已知限制

- 已于 2026-08-15 在研究者指定的上海超算魔方-III pilot 上完成 SSH inspect、SFTP 往返、`score` 队列固定 smoke、幂等去重和重启恢复验收。该验收依赖研究者本机 SSH 配置，普通回归仍不会连接或伪造真实集群。
- 运行测试时 Windows 偶发临时目录文件锁（WAL 句柄释放延迟），测试会忽略该清理错误（无害）。
- 历史测试文件（vitest 配置、hpcPaths.test.ts 等）已在 2026-08-09 快照中被移除；如需单元测试框架，后续另立任务。
