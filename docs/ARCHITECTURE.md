# 架构说明

本文说明任务独立工作流和 Agent 科研环境 V1。系统完整路由列表仍可参考 [`../doc/架构图.md`](../doc/架构图.md)。

## Agent 研究数据流

```text
Markdown 研究方案 + YAML 研究合同
                │ 哈希绑定
                ▼
research_runs → run_context_versions（不可变快照）
                │
     effective policy + workflow snapshot
                ▼
AgentContextV1 / workbench CLI
                │
     run_events + remote_jobs + reviews
                ▼
外部文件系统与 LSF 状态对账 / 研究者评价
```

`server/services/agentCore.ts` 负责合同、稳定哈希、策略收紧、运行版本、账本和评价。`server/services/remote.ts` 只执行受控 OpenSSH/SFTP/LSF 动作，不承担科学决策。外部调度器和远程目录是真实状态源，`remote_jobs` 保存幂等身份与最近观察。

## 工作流数据流

```text
src/data/workflows.ts
        │ 内置默认、首次播种、模板重置
        ▼
workflow_templates
        │ 创建任务时复制一次
        ▼
tasks.workflow_snapshot
        │ 任务页面、进度条、流程图、步骤详情、HPC 向导读取
        ▼
当前任务的独立工作流
```

模板和任务之间没有运行期同步。`tasks.workflow_id` 只保留来源关系，任务显示和执行所需的阶段、步骤、命令及文件定义来自 `workflow_snapshot`。

## 后端

`server/db.ts` 负责打开 SQLite、启用 WAL/外键、建立基础表，并保留早期字段的兼容性补列。Agent V1 的版本化迁移位于 `server/migrations.ts`：通过 `PRAGMA user_version` 只执行一次，在修改现有数据库前生成 `.before-agent-v1.db` 一致性备份，并新增稳定任务根、归档状态、policy、run、context、event、review 和 remote job 表。测试通过 `WORKBENCH_DB_PATH` 注入临时数据库。

`server/routes/tasks.ts` 负责：

- 新建任务时读取模板并保存完整快照。
- 读取任务时把数据库中的 JSON 解析为响应字段 `workflow`，不向前端暴露原始 `workflow_snapshot` 字符串。
- 对缺少快照的旧任务，以迁移时的当前来源模板补齐一次。
- 通过 `PUT /api/tasks/:taskId/workflow` 校验并保存任务工作流。
- 保存任务工作流后补建新增阶段目录，不删除已有目录或计算数据。

任务工作流校验保证阶段 ID 可安全作为目录名、阶段和步骤 ID 不重复，并且每个步骤引用已存在的阶段。

Agent 接口分成三层：

- `server/routes/agent.ts`：Context、Run、Policy、Event 和 Review HTTP API。
- `server/services/agentCore.ts`：合同解析、稳定哈希、分层策略、不可变上下文、追加账本和评价事务。
- `server/routes/remote.ts` + `server/services/remote.ts`：固定 OpenSSH/SFTP/LSF 动作及远程作业对账。

所有 Agent HTTP 接口位于 `/api/agent/v1`。服务默认绑定 `127.0.0.1`，CORS 默认只允许本机 Vite 开发源；这套边界按“可信本机用户”设计，不包含账号登录或局域网服务模式。

## 前端

`Task.workflow` 是前端使用的完整任务工作流对象。以下组件直接接收该对象，不再根据模板 ID 重新查询全局上下文：

- `Flowchart`
- `ProgressBar`
- `StepDetail`
- `HpcWizard`

`TemplateEditor` 支持两种已经实现的模式：

- 模板模式：保存到 `workflow_templates`，可重置为内置默认模板。
- 任务模式：保存到当前任务快照，不显示模板重置操作。

`WorkflowPage` 在模板预览模式使用 `WorkflowContext` 中的全局模板；选择任务后改用该任务的 `workflow`。`TaskWorkflowPage` 和 `HPCPage` 始终使用所选任务的工作流。

`AgentRunsPage` 聚合任务、运行、上下文版本、drift、有效策略、远程作业和事件时间线。`ReviewCenterPage` 读取绑定上下文版本的开放评价请求，并提交唯一的批准、驳回、补充或终止决定。两页均通过 `src/api/client.ts` 调用后端，不直接访问数据库或科研目录。

## 远程执行边界

远程动作必须同时通过环境开关和有效 policy。system policy 定义上限，project/task 只能收紧；task 必须存在 active policy，且当前 `run_context_versions.policy_sha256` 必须与现行有效策略一致。策略改变后，运行需显式采用新策略版本才能继续远程操作。

SSH 主机参数可以是 policy 批准的 OpenSSH alias 或 hostname；需要指定远程用户和专用 key 时，通过研究者预先配置并确认 host key 的 alias 提供。adapter 使用参数数组启动 `ssh`/`sftp`，启用 BatchMode、严格 host key 检查、连接超时和输出上限，不保存凭据、不启用 agent forwarding。上传和下载的本地路径限定在稳定 Task 根；远程路径限定在批准根。`protectedPaths` 阻止显式覆盖相对路径及其子树，固定 smoke 同时受合同与 policy 的资源、并发上限约束。

固定 smoke 在写入 `remote_jobs` prepared 记录后上传脚本并提交，`action_token` 和运行内幂等键用于避免重复作业。`bsub` 返回非零、无法解析 job ID、SSH 超时或传输层异常都会保存为 `submission_uncertain` 并创建幂等评价请求；Workbench 不会自动重提。下载先写同目录临时文件，完整成功后才替换目标，避免失败时留下被误认为完整结果的文件。

## 数据安全边界

- 数据库迁移不重建 `tasks` 表，也不删除任务、进度或文件关联。
- 工作流节点删除只改变任务快照，不删除项目工作目录中的内容。
- 自动化测试使用 `WORKBENCH_DB_PATH` 和临时项目目录，不写入真实数据库或科研目录。
- `tasks.task_root_rel` 创建后不随显示名改变；无法确认的旧目录保持 unresolved，不移动科研数据。
- 路径检查使用规范包含关系，并检查现有目标或最近现有父目录的真实路径。
- 服务默认绑定 `127.0.0.1`；远程动作还要求环境 kill switch、任务策略和显式批准根。
- 有运行历史的 Project、Task 和 ResearchPlan 只能归档；账本事件不提供更新或删除 API。
