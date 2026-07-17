# DFT+DMFT Workbench

一个本地运行的 DFT+DMFT 科研工作台，用于管理材料计算项目、计算任务、工作流步骤、计算文件、经验记录和 HPC/LSF 提交脚本。

## 主要功能

- 项目与计算任务管理
- One-shot DFT+DMFT 工作流和交互式流程图
- 步骤进度、笔记、自定义命令与文件关联
- 工作流模板持久化、可视化编辑和重置
- 项目工作目录浏览与文本文件查看
- 经验库
- HPC 配置和 LSF 提交向导（复制粘贴模式）

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

## 常用检查

```powershell
npm run lint
npm run build
```

## 数据说明

`data/` 中的 SQLite 数据库以及 `repository/` 中的真实科研输入输出不会提交到 Git。它们属于本地用户数据，应单独备份和管理。

项目协作与安全约定见 [AGENTS.md](AGENTS.md)，历史进度见 [progress.md](progress.md)，架构、接口和数据字典见 [doc/](doc/)。
