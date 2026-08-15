# DFT+DMFT Workbench

一个本地运行的 DFT+DMFT 科研工作台，用于管理材料计算项目、计算任务、工作流步骤、计算文件、经验记录和 HPC/LSF 提交脚本。

## 主要功能

- 项目与计算任务管理
- One-shot DFT+DMFT 工作流和交互式流程图
- 创建任务时复制模板；每个任务拥有可独立增删、修改的工作流
- 步骤进度、笔记、自定义命令与文件关联
- 工作流模板持久化、可视化编辑和重置；模板修改只影响之后创建的任务
- 项目工作目录浏览与文本文件查看
- 经验库
- HPC 配置和 LSF 提交向导（只生成并复制命令，不自动连接或执行）
- Agent 统一任务上下文、研究运行和不可变上下文版本
- YAML 研究合同、system/project/task 分层授权策略与追加式事件账本
- 评价中心：越界方案修订、异常提交和关键科学决定由研究者处理
- 受控 OpenSSH/LSF pilot：只读探测、任务根内传输、固定 1 核 smoke、状态/日志/取消/对账

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

启动服务后，研究者可以先在侧边栏进入“Agent 运行中心”启动运行、查看采用的上下文版本、策略、作业和事件；需要人工决定的越界修订或异常会进入“评价中心”。Agent 通过 HTTP CLI 操作同一套 API，不直接读取 SQLite：

```powershell
npm link                 # 可选：注册本地 workbench 命令
workbench doctor
workbench context --task <task-id> --pretty
workbench run start --task <task-id> --plan <research-plan-id> --idempotency-key <key>
workbench review list --run <run-id> --pretty
workbench remote inspect --task <task-id> --host <ssh-alias> --remote-root <approved-root>
```

CLI 默认连接 `http://127.0.0.1:3001`，可通过 `WORKBENCH_URL` 指向另一个本地端口。输出默认为 JSON；`--pretty` 仅改变排版。退出码 `2/3/4/5` 分别表示命令用法错误、API 拒绝、上下文阻塞或等待评价、服务不可达，因此脚本不需要解析自然语言错误。

研究合同保存在项目目录 `.workbench/contracts/<research-plan-id>.yaml`。研究方案仍可编辑；当前文件与运行采用版本不一致时，Context 会报告 drift。每个 Task 同时最多有一个 `active` 或 `waiting_review` 运行。

真实远程能力默认关闭。只有同时满足服务环境开关、active task policy、当前运行已采用该策略、批准主机/远程根/操作和首次 smoke 明确确认时，Workbench 才会调用系统 OpenSSH。V1 只提供 inspect、任务根内小文件传输、固定 1 核/1 分钟 smoke，以及已记录作业的状态、日志、取消和对账；不提供任意远程 shell。显式覆盖还受 `protectedPaths` 保护，smoke 同时受合同与 policy 的预算和并发上限约束。Workbench 不保存密码或私钥，也不自动接受 host key。该闭环已在 IBM Spectrum LSF 10.1 完成真实 pilot 验收，复现步骤见 [TESTING.md](TESTING.md)。

## 模板与任务工作流

工作流模板用于定义新任务的起始流程。创建任务后，系统会把模板复制到任务中：

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
