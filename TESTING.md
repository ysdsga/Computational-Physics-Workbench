# TESTING.md — 应用主体测试基线（D 盘根）

> 最后更新：2026-08-16（Essential Workbench V3 / schema v6）
> 本文件描述 Computational Physics Workbench **应用主体**（D 盘根）的测试现状与命令。

## 现状

- 后端/API 使用 Node `node:test`；路径边界在 `tests/path-safety.test.ts`；浏览器流程使用 Playwright。
- 测试在**临时数据库 + 临时项目工作目录**上运行，**绝不触碰真实用户数据**（`data/workbench.db`、真实项目目录）。
- 为支持可测试性做了**最小结构改动**：
  - `server/db.ts`：DB 路径支持 `WORKBENCH_DB_PATH` 环境变量覆盖（默认仍为 `data/workbench.db`）；导出 `closeDb()` 供测试释放句柄。
  - `server/index.ts`：抽出 `createApp()` 工厂并导出 `server`；端口支持 `WORKBENCH_PORT` 覆盖（默认仍 3001）。
- `package.json` 新增 `test` 脚本。

## 命令

```bash
cd "<path-to-computational-physics-workbench>"
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
3. **多软件栈模板**：现役内置模板可增量播种，阶段引用有效；创建任务只建立稳定 Task 根。
4. **任务独立工作流**：旧任务快照可补齐；模板后续修改不影响任务；任务修改不回写模板；Workflow 不强制物理目录。
5. **工作流模板预览**：页面为每个现役内置模板提供选择项，已移除模板不会再次出现。
6. **项目 CRUD 行为保持**：创建（201）→ 读取（字段一致 + task_count=0）→ 更新（200）→ 删除（200）→ 再读 404。
7. **研究方案项目归属**：无项目时拒绝创建；文件只写入项目 `working_dir`；不同项目允许同名方案；删除时同步移除所属项目中的文件。
8. **研究方案目录容错**：项目工作目录暂时不可用时，列表仍返回全部元数据，并把对应方案标记为文件丢失。
9. **研究方案迁移安全**：旧的全局文件名唯一约束迁移为项目内唯一，已有元数据在初始化后仍然存在。
10. **路径安全**：绝对路径、`..`、同名前缀目录和符号链接逃逸失败关闭。
11. **Task Spec / Codex 内核**：一次 Envelope 确认、Working Plan 自主更新、事件幂等、Stage pending、Envelope 修订和归档保护。
12. **执行边界**：host、capability、方法/软件、Task 根、保护路径、输入哈希与资源上限在执行点强制。
13. **Action 与证据链**：不可变 spec、状态图、artifact/evidence 归属、回执恢复和有效性纠错。
14. **材料无关执行器**：通用 `local.process` 与 `job.submit`；单次提交、响应不确定后只对账不重提，并有静态无硬编码检查。
15. **重试预算**：`retry_of_action_id` 单链、禁止分叉、超过 `maxAutomaticRetries` 失败关闭。
16. **长作业监控**：Run monitor attach/guard/tick、PEND 10/30/60 退避、RUN 15 分钟、终态停止、Stop Hook 单次守门且服务不可用时 fail open。
17. **schema v6 迁移**：临时库从空状态到 v6、专用备份、外键和完整性检查。
18. **Web 观察面**：静态门禁保证 Agent 页面不发起执行；显示 monitor、排队原因、最后进展和下次检查。

浏览器 E2E 使用临时数据库覆盖空状态，以及预置 `run + open review` 后的运行观察台/待沟通事项。测试监听浏览器请求，断言访问和刷新期间没有任何 `/api/agent` POST/PUT/DELETE，并断言不存在启动、批准、提交、取消或对账控件。

## 真实 capability pilot

真实测试不会进入 `npm test`。先人工确认 OpenSSH host key，并在目标 Project/Task 中登记连接与 Task root。Codex 必须先通过 `workbench-agent` skill 运行 doctor/context，展示 Research Plan、Core Workflow、完整 Task Spec Envelope 和哈希，获得一次明确确认，然后生成通用 capability spec：

```powershell
$env:WORKBENCH_TEST_RUN_ID='<run ID>'
$env:WORKBENCH_TEST_STAGE_ID='<workflow stage ID>'
$env:WORKBENCH_TEST_CAPABILITY='remote.inspect' # 或 remote.task-root.create/files.upload/job.submit 等
$env:WORKBENCH_TEST_SPEC_FILE='<由 Codex 准备的 JSON spec>'
npm run test:remote:prepare
```

`prepare` 创建一个 `ready` Action，建立不可变 spec、输入快照和命令预览，不执行。Envelope 一次确认后不再逐 Action 授权；执行时仍重新检查路径、输入哈希、资源和 capability。首次记录非终态 Job 后必须创建/复用当前 Codex 任务 Scheduled Task，并通过 `workbench monitor attach` 绑定真实 reference。未提供 pilot 参数时命令明确输出 `SKIP`。

## 已知限制

- V1 曾在研究者指定的上海超算环境完成 SSH inspect、SFTP 往返、固定 smoke、幂等去重和重启恢复验收。V3 已移除材料专用入口和逐 Action 授权；普通回归不会连接真实集群，新的真实作业必须走通用 capability 与已确认 Task Spec。
- 运行测试时 Windows 偶发临时目录文件锁（WAL 句柄释放延迟），测试会忽略该清理错误（无害）。
- 历史测试文件（vitest 配置、hpcPaths.test.ts 等）已在 2026-08-09 快照中被移除；如需单元测试框架，后续另立任务。
