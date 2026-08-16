# DFT+DMFT Workbench 当前状态

> 核对日期：2026-08-15
> 当前代码包含 Agent 科研环境 V1 本地与受控远程闭环；真实 SSH/SFTP/LSF pilot 已完成验收。

## 权威入口

- 使用和启动方式：`README.md`
- Agent 修改边界与数据安全：`AGENTS.md`
- 系统结构：`doc/架构图.md`
- 数据库字段：`doc/数据字典.md`
- HTTP 接口：`doc/接口清单.md`
- 实际行为最终以当前代码、SQLite schema 和本地运行态为准。

## 当前功能

- Project 表示一个材料或研究体系；Task 表示该项目的一次完整工作流运行；Step 是工作流模板中的步骤。
- 内置 One-shot 模板包含通用 QE/Wannier90/TRIQS，以及非磁 QE/自发磁性 DMFT、WIEN2k/dmftproj 两条专用路线。
- 支持项目/任务 CRUD、步骤进度、笔记、自定义命令、LSF 脚本和文件关联。
- 支持项目工作目录浏览、文本读取和目录创建；创建任务时按阶段建立 `{任务名}/{stageId}/` 目录。
- 工作流模板保存在 `workflow_templates` 表中，可通过 UI 编辑或重置为源码内置默认值。
- 超算管理保存项目级 OpenSSH alias/远程根/调度器元数据，观察有效边界、传输 action 和作业快照；不在 Web 上传、提交、取消或对账。
- 证据库按项目/任务管理本地与远端 artifact、下载副本、派生图和 validator 结果；经验库单独保存可复用记忆，区分人工、Codex 候选和证据确认来源。
- **研究方案模块**：正文以 Markdown 文件保存在所属项目的 `working_dir`，数据库只保存标题、项目与任务关联、状态和标签等元数据；支持创建、导入、编辑、搜索和状态管理。项目目录暂时不可用时，列表仍保留方案元数据并标记文件丢失。
- **Agent/Workbench**：稳定任务根、YAML 研究合同、运行上下文版本、分层授权策略、追加式账本、Agent 运行记录、待沟通事项、CLI，以及由 Codex 生成 spec 的材料无关 capability executor；不注册材料/任务专用 adapter。

## 2026-07-21 验证结果

- `npm ci`：依赖按锁文件重建成功。
- `npm run lint`：通过，保留 9 条现有 warning。
- `npm run build`：通过，生成单文件 `dist/index.html`。
- 本地页面 `http://localhost:3001` 返回 HTTP 200；项目和工作流只读接口可用。
- 运行数据库为 6 张业务表，不包含后来试验的 Task Spec、作业链或 Agent 同步表。

## 待验收与后续边界

1. **依赖审计告警**：当前 `npm install` 报告 6 个 high severity 漏洞；未自动执行破坏性 `npm audit fix`。
2. **V1 明确不含**：真实 DFT/DMFT 科学计算、软件栈验收器、连续 `agent-cycle`、MCP、多 Agent 和任意远程 shell。
3. **真实测试边界**：普通回归不会连接集群；只有显式环境开关、任务 policy、已采用上下文和研究者确认同时满足时才运行独立 pilot 命令。

## 历史摘要

- 2026-07-09：从 localStorage 原型重构为 React + Express + SQLite 工作台。
- 2026-07-10：加入任务阶段目录、自定义步骤命令和文件关联联动。
- 2026-07-11：加入数据库化工作流模板、模板编辑器、项目级 HPC 配置和 LSF 复制向导。
- 2026-07-21：撤销此后试验性的稳定性/HPCPlus/Agent/复杂任务系统改造，恢复上述原始基线。
- 2026-07-21：新增"研究方案"模块（`research_plans` 表 + `/api/research-plans` 路由 + 研究方案页面 + 项目详情页 Tab 集成）。
- 2026-08-10：新增两套多软件栈 One-shot 模板，并改为增量播种缺失内置模板而不覆盖用户编辑。
- 2026-08-10：研究方案统一保存到所属项目目录；目录暂时不可用时，方案列表保留元数据并显示文件丢失状态。
- 2026-08-13：实现 Agent 科研环境 V1 的本地运行/合同/策略/账本/评价/CLI 闭环，以及默认关闭的真实 OpenSSH/LSF pilot adapter。
- 2026-08-15：完成真实 SSH/SFTP/LSF pilot，并加固任务根、合同收紧、评价幂等、policy 执行和不确定提交恢复。
- 2026-08-15：工作流收敛为核心骨架；拆分证据库/经验库；删除旧超算提交向导并新增超算管理；待沟通事项加入项目/任务/状态筛选；Agent 运行记录显示 manifest 命令预览；Codex 增加经验检索与候选沉淀。
