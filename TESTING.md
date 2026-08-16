# TESTING.md — 应用主体测试基线（D 盘根）

> 最后更新：2026-08-15（Workbench V2 隔离验收）
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
11. **Agent / Codex 内核**：合同绑定、运行/上下文冻结、事件幂等、越界修订评价、重复评价拒绝和归档保护。
12. **策略边界**：下层 host、操作、方法、根和资源上限不能扩大上层权限。
13. **提交前加固**：任务根不可回退到项目根；合同约束不能静默删除；评价请求幂等；保护路径与资源预算在执行点生效。
14. **Action 与证据链**：immutable manifest、显式授权、状态图、artifact/evidence 归属、哈希 drift 与崩溃重试。
15. **材料无关执行器**：两个不同材料、不同 workflow 的 `local.process` 共用同一接口；通用 `job.submit` 单次提交、响应不确定后只对账不重提，并有失败评价门禁和静态无硬编码检查。
16. **结论与经验提升**：只有 `codex_conversation` 来源可记录 researcher conclusion；Experience 提升重新校验本地证据哈希并保护 provenance 不可变。
17. **schema v4 迁移**：V0→V4、V1→V4、重复启动、原业务行数、外键和完整性检查。
18. **Web 观察面**：源代码静态门禁和浏览器请求监听共同保证 Agent/评价页面只发 GET。

浏览器 E2E 使用临时数据库覆盖空状态，以及预置 `run + open review` 后的运行观察台/待沟通事项。测试监听浏览器请求，断言访问和刷新期间没有任何 `/api/agent` POST/PUT/DELETE，并断言不存在启动、批准、提交、取消或对账控件。

## 真实 capability pilot

真实测试不会进入 `npm test`，也不会使用真实用户数据库。先人工确认 OpenSSH host key，并在测试用 Project/Task/Run 中配置 active task policy。先用 Codex 对话确认研究方案和动作边界，再让 Codex 生成通用 capability spec：

```powershell
$env:WORKBENCH_TEST_RUN_ID='<run ID>'
$env:WORKBENCH_TEST_CONTEXT_VERSION_ID='<context version ID>'
$env:WORKBENCH_TEST_STEP_ID='<workflow step ID>'
$env:WORKBENCH_TEST_CAPABILITY='remote.inspect' # 或 remote.task-root.create/files.upload/job.submit 等
$env:WORKBENCH_TEST_SPEC_FILE='<由 Codex 准备的 JSON spec>'
npm run test:remote:prepare
```

`prepare` 只创建 proposed action 并输出完整 manifest 与哈希，不执行。研究者在 Codex 对话中确认该精确 manifest 后，才可显式设置 action ID、manifest hash、授权摘要和 `WORKBENCH_LIVE_ACTION_CONFIRM=1`，再运行 `npm run test:remote:execute`。脚本、输入、路径、queue、核数和墙钟均来自 spec/manifest；测试脚本中没有材料、Task、step 或科学脚本硬编码。未提供 prepare 参数时命令明确输出 `SKIP`；execute 缺少精确授权参数时失败关闭。

## 已知限制

- V1 曾在研究者指定的上海超算环境完成 SSH inspect、SFTP 往返、固定 smoke、幂等去重和重启恢复验收；V2 已移除绕过 manifest 的专用 smoke 入口。普通回归不会连接或伪造真实集群，新的真实作业必须走通用 capability manifest 并单独获准。
- 运行测试时 Windows 偶发临时目录文件锁（WAL 句柄释放延迟），测试会忽略该清理错误（无害）。
- 历史测试文件（vitest 配置、hpcPaths.test.ts 等）已在 2026-08-09 快照中被移除；如需单元测试框架，后续另立任务。
