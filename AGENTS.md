# DFT+DMFT Workbench — Codex 项目指南

## 项目目标

这是一个本地运行的 DFT+DMFT 科研工作台，用于管理材料计算项目、计算任务、工作流步骤、输入/输出文件、计算经验和 HPC/LSF 提交脚本。

项目既包含工作台应用代码，也包含真实科研数据。修改时优先保证数据安全、工作流可追溯，以及已有计算目录不被意外改写。

## 技术栈与启动

- 前端：React 19、TypeScript、Vite 8、Tailwind CSS v4、React Router（`HashRouter`）。
- 后端：Node.js、Express 5、better-sqlite3。
- 数据库：`data/workbench.db`，启用 WAL 和外键。
- 默认服务地址：`http://localhost:3001`。
- Node 依赖以 `package-lock.json` 为准，使用 `npm`。

常用命令：

```powershell
npm install
npm run dev:full   # Vite 与 Express 同时运行
npm start          # Express 服务 API，并托管 dist/
npm run lint
npm run build
```

修改前端后，如果用户通过 `npm start` 或 `start.bat` 查看生产界面，必须重新执行 `npm run build`，并提醒用户硬刷新浏览器。

## 代码结构

- `src/`：React 前端。
  - `src/pages/`：项目、任务工作流、工作流模板、HPC、经验库页面。
  - `src/components/`：流程图、步骤详情、文件浏览器、模板编辑器、HPC 向导等。
  - `src/api/client.ts`：前端 HTTP API 的统一入口。
  - `src/contexts/WorkflowContext.tsx`：从后端加载和保存工作流模板。
  - `src/data/workflows.ts`：内置工作流默认值，也是数据库首次播种和重置的来源。
  - `src/types/index.ts`：前后端共享的主要数据类型。
- `server/`：Express 后端。
  - `server/index.ts`：路由挂载、静态文件托管和端口监听。
  - `server/db.ts`：SQLite schema 与兼容性迁移。
  - `server/routes/`：业务 API；当前 SQL 和业务逻辑主要位于路由中。
- `data/`：工作台运行数据库及 WAL 文件，是用户数据，不是测试夹具。
- `repository/`：真实 DFT/DMFT 输入、输出、赝势、Wannier 和 notebook 等科研文件。
- `dist/`：Vite 单文件构建产物，由构建命令生成，不手工编辑。
- `doc/`：架构、接口和数据字典；改动相关行为时同步更新。
- `progress.md`：历史进度与待办，部分描述早于最新代码，使用前应与实现核对。

## 核心领域模型

- Project：一个材料或研究体系，拥有 `working_dir`。
- Task：一次具体计算运行，属于 Project，并绑定一个工作流模板。
- WorkflowTemplate：阶段和步骤定义；内置默认值在源码中，用户编辑结果持久化在 `workflow_templates` 表中。
- StepProgress：某个 Task 下步骤的状态、笔记、自定义命令和 LSF 脚本。
- StepFile：步骤所关联的文件路径引用，不存储文件内容。
- Experience：可关联项目、任务或步骤的经验记录。

创建 Task 时，后端会在项目 `working_dir` 下创建 `{task_name}/{stageId}/`。只创建阶段目录，不增加步骤子目录。

## 必须保持的约定

- Express 5 的嵌套路由使用 `Router({ mergeParams: true })`，否则无法读取父路由参数。
- SPA fallback 使用普通中间件，不使用 Express 5 不兼容的 `app.get('*', ...)`。
- 前端路由保持 `HashRouter`，Vite 保持 `base: './'` 与 `vite-plugin-singlefile`，以兼容本地部署。
- 工作流运行时数据以数据库为准；`src/data/workflows.ts` 只负责内置默认、首次播种和重置回退。相关修改要同时检查数据库 API、Context、模板编辑器和任务目录创建逻辑。
- SQLite schema 变更必须对现有数据库向后兼容。新增字段使用可重复启动的安全迁移；不要假设数据库是空的。
- Windows 的 `.bat` 启动脚本保持 ASCII/英文，避免系统代码页导致中文命令乱码。
- 文件 API 必须把访问限制在 Project 的 `working_dir` 内。处理路径时使用解析后的规范路径，并覆盖同名路径前缀、`..`、绝对路径等逃逸场景。
- 不凭空修改或“修正”DFT/DMFT 物理参数。涉及赝势、U/J、双计数、投影窗口、k/q 网格、收敛阈值、求解器参数等科学选择时，先说明依据；需求不明确且会影响结果时向用户确认。

## 数据与文件安全

- 不删除、覆盖、移动或批量格式化 `repository/`、项目 `working_dir` 或用户计算输出，除非用户明确指定目标。
- 不把 `data/workbench.db`、`-wal`、`-shm` 当作可随意重建的缓存。涉及迁移或写数据库前，先判断是否需要备份，并验证迁移后的数据。
- 测试写操作不得直接污染用户数据库或科研目录。优先使用临时目录和临时数据库；若当前结构不支持，应先重构出可注入路径或进行只读验证。
- 不提交 `node_modules/`、`dist/`、数据库运行文件或大体积计算输出。若初始化 Git，应先完善 `.gitignore` 再添加文件。
- API 或 UI 中显示 shell/LSF 命令时，把它们视为用户数据；不要未经确认自动在本机或 HPC 执行。

## HPCPlus 网页终端边界

- HPCPlus 只作为用户手动登录并连接后的网页版命令行通道。不要对门户做 DOM/API 爬取、菜单遍历、自动上传下载或并发页面操作。
- 项目内桥接 skill 位于 `.agents/skills/hpcplus-web-terminal/`。它只允许单会话、单命令、有界输出；出现 403、断线、超时或输出标记缺失时立即停止，禁止自动重试。
- 执行写文件、移动/删除、提交/取消作业等远端状态变更前，必须展示完整命令并取得用户针对该动作的明确确认。
- `C:\Users\pikaqiu\.workbuddy-ai\skills\computational-physics-workbench` 以及 `D:\Documents\Try\a\Skill-Workspace Anchor\` 下的旧桥接脚本只可作为参考，禁止修改。

## 修改工作方式

1. 先阅读与任务直接相关的实现、类型、API 和文档，不只依赖 `progress.md`。
2. 前后端契约变更时，同步更新 `src/types/index.ts`、`src/api/client.ts`、对应路由和 UI 调用方。
3. 优先做小而完整的变更，保留现有中文界面和科研术语的一致性。
4. 修复缺陷时先确认根因，并尽量增加最小回归验证；不要吞掉异常，给用户可操作的错误信息。
5. 完成代码修改后至少运行与改动相关的检查。通常是：

```powershell
npm run lint
npm run build
```

涉及 API 时，再启动服务并验证相应端点；涉及 UI 时，验证主要交互流程。不要为了测试清空或重置现有数据库。

## 当前功能基线

- 项目与任务 CRUD、任务步骤进度追踪。
- 工作目录浏览、文本文件读取和目录创建。
- One-shot DFT+DMFT 工作流及交互流程图。
- 工作流模板数据库持久化、可视化编辑和重置。
- 步骤笔记、自定义命令、文件关联。
- 经验库。
- HPC 配置与 LSF 提交向导（桌面 Edge PWA 网页终端模式，不连接 SSH，不自动传输文件）。

继续开发前可参考 `progress.md` 和 `doc/`，但最终以当前代码、数据库 schema 和实际运行结果为准。
