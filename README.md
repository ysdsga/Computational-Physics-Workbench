# DFT+DMFT Workbench

一个本地运行的 DFT+DMFT 科研工作台，用于管理材料计算项目、计算任务、工作流步骤、计算文件、经验记录和 HPC/LSF 提交脚本。

## 主要功能

- 项目与计算任务管理
- One-shot DFT+DMFT、TRIQS 模型 DMFT 与通用理论研究工作流，以及交互式流程图
- 创建任务时复制模板；每个任务拥有可独立增删、修改的工作流
- 步骤进度、笔记、自定义命令与文件关联
- 工作流模板持久化、可视化编辑和重置；模板修改只影响之后创建的任务
- 项目工作目录浏览与文本文件查看
- 证据库：按项目/任务索引本地与远端产物、下载副本、处理图和 validator 结论
- 经验库：人工记录、Codex 候选经验与证据确认经验分层管理
- 超算管理：项目级 OpenSSH 连接、用户只读根、项目根、Task 写目录映射、传输记录和作业快照；不在 Web 执行
- Task Spec = 一次确认的 Confirmed Envelope + Codex 可自主修改的 Working Plan
- 理论研究每个阶段可追加任意多条“记录与反思”；重要新想法逐项处置，必要时停留或回到最早受影响阶段，未闭环时不能结束 Run
- Stage → Action → Job → Artifact/Evidence 追加式账本；Action spec 不可变但不逐动作授权
- Agent 运行记录与待沟通事项：Web 只读展示命令预览、作业监控、证据和决定，并支持项目/任务/状态筛选
- 材料无关 capability：Codex 自主选择脚本、输入和资源；Workbench 校验边界、快照、路径、哈希和资源
- 长作业由当前 Codex 任务的 heartbeat Scheduled Task 唤醒；Workbench 保存下次检查，Stop Hook 只负责防止失联
- 自动重试保留 retry lineage，并硬性受 Task Spec 重试预算约束

## 技术栈

- React 19 + TypeScript + Vite 8 + Tailwind CSS v4
- Node.js + Express 5
- SQLite（better-sqlite3）

## 本地运行

```powershell
npm install
npm run dev:full
```

开发模式下，Vite 前端会把 `/api` 请求代理到 `http://127.0.0.1:3001`。

生产式本地运行：

```powershell
npm run build
npm start
```

然后访问 <http://127.0.0.1:3001>。服务默认只监听回环地址，并只允许已配置的本地开发源跨域访问。

## Agent CLI

Agent 本体是本项目中的 Codex 对话。研究者先在对话中确认研究方案、工作流、科学边界、资源和完成证据；Codex 再通过 `workbench` CLI 操作同一套 HTTP API，不直接读取 SQLite。Web 的“Agent 运行记录”和“待沟通事项”只显示已经记录的状态，不能启动、批准、提交、取消或对账：

```powershell
npm link                 # 可选：注册本地 workbench 命令
workbench doctor
workbench context --task <task-id> --allow-blocked --pretty
workbench plan show --plan <research-plan-id>
workbench workflow show --task <task-id>
workbench run draft --task <task-id> --plan <research-plan-id> --task-spec-file <json> --idempotency-key <key>
workbench run confirm --run <run-id> --summary <confirmed-summary> --conversation-ref <ref>
workbench execution contract --pretty
workbench action prepare --run <run-id> --stage <stage-id> --capability local.process --spec-file <spec.json> --idempotency-key <key>
workbench action execute --action <action-id>
workbench reflection record --run <run-id> --stage <stage-id> --file <reflection.json> --idempotency-key <key>
workbench monitor guard
workbench monitor attach --run <run-id> --automation-ref <ref> --cadence-minutes 10
workbench monitor tick --run <run-id>
workbench experience search --task <task-id> --query <关键词>
workbench experience capture --run <run-id> --stage <stage-id> --title <标题> --content-file <经验.md> --applicable-scope <范围> --idempotency-key <key>
```

CLI 默认连接 `http://127.0.0.1:3001`，可通过 `WORKBENCH_URL` 指向另一个本地端口。输出默认为 JSON；`--pretty` 仅改变排版。退出码 `2/3/4/5` 分别表示命令用法错误、API 拒绝、记录边界/待处理状态阻塞、服务不可达。

Task Spec 保存在 Workbench 账本中。研究方案与核心 Workflow 仍可纠错；改变 Confirmed Envelope 时才需要新的研究者确认。每个 Task 同时最多有一个开放 Run。

真实远程能力默认关闭。项目连接、Task 目录映射和一次确认的 Task Spec 必须一致，Workbench 才会调用系统 OpenSSH/LSF。用户根只读，只有当前 Task 写根允许上传和作业操作；执行器不按材料名、Task ID、Workflow step 或软件栈选择路线。Codex 根据研究方案生成通用 Action spec，Workbench 只负责建立不可变快照并强制边界。响应不确定时只按已记录身份对账；长作业通过当前 Codex 任务的 Scheduled Task 恢复，不在 Web 或 Express 内另建 Agent。Workbench 不提供任意远程 shell，不保存密码或私钥，也不自动接受 host key。真实科学作业仍需先确认 Task Spec，复现边界见 [TESTING.md](TESTING.md)。

## 模板与任务工作流

工作流模板用于定义新任务的核心科学/软件骨架：关键阶段、不可缺少的软件转换、检查点和完成证据。试跑、重试、传输、参数扫描批次与临时诊断由 Codex 记录为 action/event，不为每个执行细节增加工作流节点。创建任务后，系统会把模板复制到任务中：

- 在“工作流”的模板预览模式中编辑模板，只影响以后创建的任务。
- 进入任务详情，点击“编辑任务流程”，可以为当前任务增加、删除或修改阶段和步骤。
- 在“工作流”页面选择具体任务后，“编辑任务流程”同样只修改该任务。
- 删除任务工作流中的节点不会删除已有计算目录、文件和历史进度。

从旧版本升级时，已有任务会以升级时当前显示的模板内容建立自己的初始副本，之后不再随模板变化。

## 常用检查

```powershell
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```

## 数据说明

`data/` 中的 SQLite 数据库以及 `repository/` 中的真实科研输入输出不会提交到 Git。它们属于本地用户数据，应单独备份和管理。

项目协作与安全约定见 [AGENTS.md](AGENTS.md)，历史进度见 [progress.md](progress.md)。任务行为、架构变化和设计决定见 [docs/TASKS.md](docs/TASKS.md)、[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 和 [docs/DECISIONS.md](docs/DECISIONS.md)；接口、数据字典和完整架构图见 [doc/](doc/)。
