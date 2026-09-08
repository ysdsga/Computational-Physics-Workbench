# Computational Physics Workbench — Codex 项目指南

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

创建 Task 时，后端只在项目 `working_dir` 下创建稳定 Task 根。Task 内目录树由 Codex 根据 Working Plan 自主设计，不按 Stage 自动建目录。

## 必须保持的约定

- Express 5 的嵌套路由使用 `Router({ mergeParams: true })`，否则无法读取父路由参数。
- SPA fallback 使用普通中间件，不使用 Express 5 不兼容的 `app.get('*', ...)`。
- 前端路由保持 `HashRouter`，Vite 保持 `base: './'` 与 `vite-plugin-singlefile`，以兼容本地部署。
- 工作流运行时数据以数据库为准；`src/data/workflows.ts` 只负责内置默认、首次播种和重置回退。相关修改要同时检查数据库 API、Context、模板编辑器和任务目录创建逻辑。
- 工作流模板和任务工作流只保留稳定的核心骨架：跑通计算所必需的物理阶段、软件转换、关键检查点与完成证据。试跑命令、连接尝试、上传下载和临时诊断只记 event；科学重试、参数扫描批次和提交作业可记为里程碑 Action，但不新增工作流节点；材料参数、收敛阈值、对照矩阵和不确定度设计放在研究方案中。
- SQLite schema 变更必须对现有数据库向后兼容。新增字段使用可重复启动的安全迁移；不要假设数据库是空的。
- Windows 的 `.bat` 启动脚本保持 ASCII/英文，避免系统代码页导致中文命令乱码。
- 文件 API 必须把访问限制在 Project 的 `working_dir` 内。处理路径时使用解析后的规范路径，并覆盖同名路径前缀、`..`、绝对路径等逃逸场景。
- 不凭空修改或“修正”DFT/DMFT 物理参数。涉及赝势、U/J、双计数、投影窗口、k/q 网格、收敛阈值、求解器参数等科学选择时，先说明依据；需求不明确且会影响结果时向用户确认。

## 数据与文件安全

- 不删除、覆盖、移动或批量格式化 `repository/`、项目 `working_dir` 或用户计算输出，除非用户明确指定目标。
- 不把 `data/workbench.db`、`-wal`、`-shm` 当作可随意重建的缓存。涉及迁移或写数据库前，先判断是否需要备份，并验证迁移后的数据。
- 测试写操作不得直接污染用户数据库或科研目录。优先使用临时目录和临时数据库；若当前结构不支持，应先重构出可注入路径或进行只读验证。
- 不提交 `node_modules/`、`dist/`、数据库运行文件或大体积计算输出。若初始化 Git，应先完善 `.gitignore` 再添加文件。
- `.gitignore` 中运行目录必须写成根锚定的 `/data/`、`/repository/`、`/output/`；不要使用未锚定的 `data/`，否则会误排除 `src/data/workflows.ts`。
- API 或 UI 中显示 shell/LSF 命令时，把它们视为用户数据；不要未经确认自动在本机或 HPC 执行。

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

## DFT+DMFT 结束后的默认结果处理

- 每次完成一段或多段 DFT+DMFT 迭代后，默认只做快速结果检查，不自动展开全面数值审计。
- 快速检查只包含四项：读取并绘制结果目录中 `conv_imp*.dat` 的全部迭代轮次，但以最后 5–10 轮作为初步收敛判断重点；读取并绘制 `observables_imp*.dat`（或同类命名文件）的全部迭代轮次，同样重点判断最后 5–10 轮；从主 HDF5 结果提取最后一轮自能并绘图；从同一最后轮提取杂质/局域格林函数并绘图。
- 将上述图保存到该计算分支的结果或检查目录，并给出简短初步判断：趋于稳定、仍振荡/漂移，或数据不足。初步判断不得冒充严格统计收敛证明。
- 完成快速图后默认停止。只有快速图显示异常、关键文件相互矛盾、研究者明确要求，或任务进入正式验收/发表证据阶段时，才追加全频率审计、因果性矩阵检查、窗口扫描、跨副本统计、历史全链拼接、离线重放等扩展诊断。
- 若必须升级诊断，先说明触发它的具体异常和最小追加检查，不因“可能有用”而默认执行整套验证。

## Codex Agent 执行边界

- Agent 本体是本项目中的 Codex 对话，不是 Web 页面、Express 后台 worker 或数据库进程。Agent 运行、评价、证据和远程作业的 Web 页面只能展示已记录状态，不得成为启动、授权、提交、取消或对账入口。
- 处理真实 Workbench 研究任务时必须读取并使用项目内的 `skills/workbench-agent/SKILL.md`。`workbench` 负责状态、边界、自动日志、传输、作业和监控，不是逐命令审批门；Codex 可在本地 Task 根直接使用终端，并可通过 `workbench remote exec` 在已确认远程边界内执行任意诊断和任务命令。禁止直接读写 SQLite、直接调用 Agent 写 API，或绕过记录通道提交/取消作业。
- `workbench remote exec/upload/download` 是透明的 SSH/SFTP 会话封装：自动推导 host/root 并写入事件日志，不创建 Action。封装自身故障时，Codex 可用直接 `ssh`/`sftp` 诊断或修复同一已登记 Task 边界并补记 event，但不得由此直接 `bsub`/`bkill`。远程写入仍只允许 Task 写根；用户根和项目根只读。
- 每个新 Codex 会话或中断恢复后，先运行 `workbench doctor` 和默认紧凑的 `workbench context --task <id> --allow-blocked --pretty`，只检查 Envelope 哈希/边界、Working Plan 当前阶段、待沟通事项和 active/uncertain Job。仅在明确需要某字段时用 `--full`；不要反复读取项目架构、完整工作流、全部历史 Action/证据/经验。提交响应不确定时只能按已记录作业身份对账，不能重提。
- 每个 `job.submit` 规格必须由 Codex 根据计算规模、阶段、历史耗时、资源和 wall-time 写入本 Job 的预计耗时、首次检查、RUN/PEND 检查间隔与依据；不得用全局固定轮询表代替 Agent 判断。首次出现非终态 Job 后，Codex 按 `workbench monitor directive` 创建或复用当前任务 heartbeat，确认其真实为 ACTIVE 后再 attach。Workbench 保存 `next_check_at`、实际 cadence 和 heartbeat lease；Stop Hook 同时阻止未监控、心跳过期和终态未删除自动化。所有 Job 终态且无后续 Job 时必须删除自动化，并用 `workbench monitor close` 回写删除成功。
- 首次进入执行前，必须在 Codex 对话中向研究者说明 Research Plan、核心 Workflow、Task Spec 的科学承诺、资源、研究者关口和完成证据，展示精确 Confirmed Envelope 及哈希并获得一次明确确认。不得把沉默、历史上的宽泛目标、Web 状态或 Agent 自己的建议当作授权。
- 确认后，Codex 可以在 Envelope 内自主修改 Working Plan、安排 Task 根下目录树、直接执行本地工作和已记录的远程会话命令、排错、传输、监控、下载分析，以及取消自己在当前 Run 中创建的错误或已替代 Job；不再逐命令或逐 Action 请求研究者确认。Action 只保留为提交/取消、多 Job 批次、证据验证等需要持久溯源的科学里程碑，不是普通命令的许可票据。扩展科学承诺、方法/软件栈、资源、权限或保护路径时，才创建 researcher 待沟通事项并重新确认 Envelope。
- 连接、认证、超时、建目录、检查和传输失败只写 event，不消耗科学重试额度。替换失败的科学 Job/Action 时必须显式绑定 `retry_of_action_id`；禁止科学重试分叉或超过 Confirmed Envelope 的 `maxAutomaticRetries`。`submission_uncertain` 只能对账，不能作为重试提交依据。
- Research Plan 和核心 Workflow 允许纠错。先评估受影响阶段和产物；边界内最小重算，边界外再沟通；相关 Artifact 必须标记为 `valid`、`suspect`、`invalid` 或 `superseded`，不得静默覆盖来源。
- 执行层只提供材料无关的 capability 接口与安全边界；材料名、Task ID、固定 workflow step、科学脚本路径和软件专属参数不得硬编码进执行器、路由或 CLI。由 Codex 根据采用的研究方案和工作流自主生成每次 action spec；材料专属内容只能作为项目数据或测试 fixture。
- 用户决定默认只保存摘要、哈希、时间和可选 Codex task reference，不保存完整聊天。事实、推断和决定分开写入；研究者未明确陈述或确认时，Codex 不得记录 researcher conclusion。
- Codex 恢复任务和规划卡壳步骤前应通过 CLI 检索项目/任务相关经验；验证成功或诊断失败后，可沉淀带条件、症状、处理方式和适用边界的候选经验。候选经验不是证据或研究者结论；确认经验时保留来源 Run、Artifact 与适用边界，后续修订仍需可追溯。
- 未单独获准迁移正式库前，不得为了检查界面或 Context 而让新版服务连接 `data/workbench.db`；使用注入的临时数据库完成开发和测试。

## 当前功能基线

- 项目与任务 CRUD、任务步骤进度追踪。
- 工作目录浏览、文本文件读取和目录创建。
- 通用及多软件栈 One-shot DFT+DMFT 工作流（QE/Wannier90/TRIQS、非磁 H0 自发磁性 DMFT、WIEN2k/dmftproj）及交互流程图。
- 工作流模板数据库持久化、可视化编辑和重置。
- 步骤笔记、自定义命令、文件关联。
- 独立证据库与经验库；证据索引文件/校验，经验保存可复用的研究记忆。
- 超算管理页面保存项目级连接元数据并观察边界、传输和作业；Web 不直接执行远程动作。

继续开发前可参考 `progress.md` 和 `doc/`，但最终以当前代码、数据库 schema 和实际运行结果为准。
