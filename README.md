# DFT+DMFT Workbench

一个本地运行的 DFT+DMFT 科研工作台，用于管理材料计算项目、计算任务、工作流步骤、计算文件、经验记录和 HPC/LSF 提交脚本。

## 主要功能

- 项目与计算任务管理
- One-shot DFT+DMFT 工作流和交互式流程图
- 步骤进度、笔记、自定义命令与文件关联
- 工作流模板持久化、可视化编辑和重置
- 项目工作目录浏览与文本文件查看
- 经验库
- HPC 配置和 LSF 提交向导（HPCPlus 网页终端模式）
- 项目内 `hpcplus-web-terminal` skill：通过已打开的 Edge PWA 逐条中继经审阅的命令，不使用 SSH、SCP 或门户接口
- Task Spec 编排与审计：命令、远端目录、依赖、预期输出和成功判据统一检查，审批绑定内容哈希
- LSF 审批绑定完整脚本快照：脚本内部命令参与风险分类和哈希，远端脚本内容必须与快照一致
- 结构化科学契约：每个步骤记录前置条件、步骤依赖、科学检查、失败处理和人工审批点
- 执行结果与科学验证分离：远端退出码成功后仍需研究者依据日志、收敛和物理判据确认
- LSF 生命周期审计：从确认后的提交中登记 job ID，服务端强制 ≥60 秒状态查询和 1–200 行有界日志读取
- 人工经验闭环：从结束、失败或未知的 Task Spec 撰写经验，并保留来源计划、任务和步骤追踪

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
npm run typecheck:server
npm test
npm run build
# 或一次运行全部检查
npm run check
```

## 数据说明

`data/` 中的 SQLite 数据库以及 `repository/` 中的真实科研输入输出不会提交到 Git。它们属于本地用户数据，应单独备份和管理。

数据库升级使用 `schema_migrations` 记录迁移版本。执行涉及数据库结构的升级前，应先在 `data/backups/` 创建并校验备份。

项目协作与安全约定见 [AGENTS.md](AGENTS.md)，历史进度见 [progress.md](progress.md)，架构、接口和数据字典见 [doc/](doc/)。

HPCPlus 桥接脚本位于 `.agents/skills/hpcplus-web-terminal/`。它只适合短命令、调度器查询和有界日志读取；每次执行都必须独立提供并核验已确认的 Task Spec 工作目录，用户命令只能引用其中的相对路径。作业提交和远端写操作必须通过 Task Spec 显式审批，并由审计执行器启动，不支持文件传输、交互程序、绝对/home-relative 路径、目录越界、后台命令或门户爬取。终端输出默认限制为末尾 160 行和 65,536 字符；只有同一次执行的完整开始/结束标记对才能确认退出码，超时、403、断线、会话过期或终端状态不确定时记录为 `unknown`，绝不自动重试。
