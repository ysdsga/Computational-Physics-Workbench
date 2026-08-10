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

## 技术栈

- React 19 + TypeScript + Vite 8 + Tailwind CSS v4
- Node.js + Express 5
- SQLite（better-sqlite3）

## 本地运行

```powershell
npm install
npm run dev:full
```

开发模式下，Vite 前端会把 `/api` 请求代理到 `http://localhost:3001`。

生产式本地运行：

```powershell
npm run build
npm start
```

然后访问 <http://localhost:3001>。

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
npm run build
```

## 数据说明

`data/` 中的 SQLite 数据库以及 `repository/` 中的真实科研输入输出不会提交到 Git。它们属于本地用户数据，应单独备份和管理。

项目协作与安全约定见 [AGENTS.md](AGENTS.md)，历史进度见 [progress.md](progress.md)。任务行为、架构变化和设计决定见 [docs/TASKS.md](docs/TASKS.md)、[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 和 [docs/DECISIONS.md](docs/DECISIONS.md)；接口、数据字典和完整架构图见 [doc/](doc/)。
