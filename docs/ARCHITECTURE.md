# 架构说明

本文说明任务独立工作流和 Codex 驱动的 Workbench V2。系统完整路由列表仍可参考 [`../doc/架构图.md`](../doc/架构图.md)。

## Agent 研究数据流

```text
研究者 ⇄ Codex 项目对话（Agent 本体）
                │ 明确确认方案 / workflow / manifest
                ▼
workbench-agent skill → workbench CLI → HTTP API
                │
research_run → immutable context → action / manifest
                │
        remote job → artifact → evidence / review
                │
                ▼
SQLite 追加账本 → Web 只读观察面
```

`server/services/agentCore.ts` 负责合同、稳定哈希、策略收紧、运行版本、账本和评价；`agentActions.ts` 固定 action/manifest/artifact/evidence 契约；`actionExecutor.ts` 提供材料无关的 capability contract、不可变输入快照和执行；`experiencePromotion.ts` 绑定研究者结论与 Experience provenance。`remote.ts` 是 OpenSSH/SFTP/LSF 的受控基础设施层，不承担材料匹配、科学规划或软件栈选择。外部调度器和远程目录是真实状态源，`remote_jobs` 只保存幂等身份与最近一次由 Codex 对账的观察。

## 工作流数据流

```text
src/data/workflows.ts
        │ 内置默认、首次播种、模板重置
        ▼
workflow_templates
        │ 创建任务时复制一次
        ▼
tasks.workflow_snapshot
        │ 任务页面、进度条、流程图和步骤详情读取
        ▼
当前任务的独立工作流
```

模板和任务之间没有运行期同步。`tasks.workflow_id` 只保留来源关系，任务显示和执行所需的阶段、步骤、命令及文件定义来自 `workflow_snapshot`。工作流是稳定骨架，只容纳核心阶段、软件转换、检查点和完成证据；每次执行中的试跑、重试、传输、扫描和诊断属于 action/event。

## 后端

`server/db.ts` 负责打开 SQLite、启用 WAL/外键、建立基础表，并保留早期字段的兼容性补列。版本化迁移位于 `server/migrations.ts`，当前 schema version 为 4：先加入稳定任务根、policy/run/context/event/review/job，再加入 action/artifact/evidence，最后加入 Experience promotion provenance。迁移前生成一致性备份；测试通过 `WORKBENCH_DB_PATH` 注入临时数据库。

`server/routes/tasks.ts` 负责：

- 新建任务时读取模板并保存完整快照。
- 读取任务时把数据库中的 JSON 解析为响应字段 `workflow`，不向前端暴露原始 `workflow_snapshot` 字符串。
- 对缺少快照的旧任务，以迁移时的当前来源模板补齐一次。
- 通过 `PUT /api/tasks/:taskId/workflow` 校验并保存任务工作流。
- 保存任务工作流后补建新增阶段目录，不删除已有目录或计算数据。

任务工作流校验保证阶段 ID 可安全作为目录名、阶段和步骤 ID 不重复，并且每个步骤引用已存在的阶段。

Agent 接口分成三层：

- `server/routes/agent.ts`：Context、Run、Action、Artifact、Evidence、Conclusion、Promotion、Policy 和 Review HTTP API。
- `server/services/agentCore.ts` / `agentActions.ts` / `experiencePromotion.ts`：不可变上下文、追加账本、动作与结论事务。
- `server/services/actionExecutor.ts`：公开 `local.process`、`remote.inspect`、`remote.task-root.create`、`files.upload/download`、`job.submit/cancel`；根据 Codex 的 spec 生成绑定 context/step/input/resource 的 immutable manifest。
- `server/services/hpcConfig.ts`：验证项目连接和 Task 目录映射，派生用户只读根、项目根与 Task 写根；不保存凭据，也不包含材料或软件栈分支。
- `server/services/remote.ts`：执行已授权 manifest 所需的固定 OpenSSH/SFTP/LSF 原语及远程作业对账。

执行器禁止包含材料名、Task ID、固定 workflow step、科学脚本路径和软件专属参数。Codex 从当前研究方案、合同和任务工作流决定这些内容，再经 `action prepare` 提交；服务只做通用 schema、policy、路径、哈希、资源、幂等和状态图校验。新增材料或软件路线不需要注册产品 adapter。

所有 Agent HTTP 接口位于 `/api/agent/v1`。服务默认绑定 `127.0.0.1`，CORS 默认只允许本机 Vite 开发源；这套边界按“可信本机用户”设计，不包含账号登录或局域网服务模式。

## 前端

`Task.workflow` 是前端使用的完整任务工作流对象。以下组件直接接收该对象，不再根据模板 ID 重新查询全局上下文：

- `Flowchart`
- `ProgressBar`
- `StepDetail`

`TemplateEditor` 支持两种已经实现的模式：

- 模板模式：保存到 `workflow_templates`，可重置为内置默认模板。
- 任务模式：保存到当前任务快照，不显示模板重置操作。

`WorkflowPage` 在模板预览模式使用 `WorkflowContext` 中的全局模板；选择任务后改用该任务的 `workflow`。`TaskWorkflowPage` 始终使用所选任务的工作流。

`AgentRunsPage`（Agent 运行记录）只读聚合运行、上下文哈希、drift、blocker、manifest/action、授权命令预览、远程作业快照、artifact/evidence 和事件时间线。`ReviewCenterPage`（待沟通事项）按项目/任务/状态筛选绑定上下文的开放/已决定事项；决定必须回到 Codex 对话后由 CLI 记录。任务流程图在骨架步骤上显示 action/job/evidence 计数。

`EvidencePage` 是独立的证据索引：聚合 `run_artifacts`、`evidence_checks`、项目/任务、action/job，并检查任务根内的本地引用是否仍可用。原始文件、下载副本和绘图仍存放在项目工作目录，不复制进 SQLite。`ExperiencePage` 只管理可复用经验，区分人工记录、Codex 候选和证据确认记录。Codex 通过 `experience search/capture/promote` 检索、沉淀和提升经验。

`SupercomputersPage` 复用 `projects.hpc_config` 保存多连接元数据：每个 profile 登记 OpenSSH alias、用户只读根、项目根、调度器和说明，`taskBindings[]` 为 Task 绑定项目根下的单段目录名。它同时显示本地/远程目录映射、有效 policy、传输 action 和远程作业快照。配置不是权限，不保存凭据，也不提供远程创建、上传、下载、提交、取消或对账按钮。旧 `HPCPage`/`HpcWizard` 已移除。

## 远程执行边界

远程动作必须同时通过环境开关和有效 policy。system policy 定义上限，project/task 只能收紧；task 必须存在 active policy，且当前 `run_context_versions.policy_sha256` 必须与现行有效策略一致。策略改变后，运行需显式采用新策略版本才能继续远程操作。

SSH 主机参数必须是连接元数据和 policy 同时批准的 OpenSSH alias；需要指定远程用户和专用 key 时，通过研究者预先配置并确认 host key 的 alias 提供。远程执行层使用参数数组启动 `ssh`/`sftp`，启用 BatchMode、严格 host key 检查、连接超时和输出上限，不保存凭据、不启用 agent forwarding。读取和下载可来自用户只读根内；上传、目录创建和作业工作目录只能使用已登记的 Task 写根。`remote.task-root.create` 只允许在既有项目根下创建或核对这个直接子目录。`protectedPaths` 阻止显式覆盖相对路径及其子树，LSF 资源同时受合同与 policy 上限约束。这是 Workbench/Codex 的治理边界；若 Unix 账号本身拥有更宽写权限，操作系统级硬隔离仍需集群 ACL、独立账号或容器提供。

`job.submit` 先验证 Task 内脚本/输入快照、LSF 资源和远端脚本哈希，再写入 `remote_jobs` prepared 记录并提交；`action_token` 和运行内幂等键用于避免重复作业。`bsub` 返回非零、无法解析 job ID、SSH 超时或传输层异常都会保存为 `submission_uncertain` 并创建幂等评价请求；Workbench 不会自动重提。下载先写同目录临时文件，完整成功后才替换目标，避免失败时留下被误认为完整结果的文件。旧的 task 级 inspect/upload/download/smoke/cancel 直通 API 已移除；远程变更统一经 immutable capability manifest，只有 status/log/reconcile 作为已记录作业的观察与恢复入口保留。

## 数据安全边界

- 数据库迁移不重建 `tasks` 表，也不删除任务、进度或文件关联。
- 工作流节点删除只改变任务快照，不删除项目工作目录中的内容。
- 自动化测试使用 `WORKBENCH_DB_PATH` 和临时项目目录，不写入真实数据库或科研目录。
- `tasks.task_root_rel` 创建后不随显示名改变；无法确认的旧目录保持 unresolved，不移动科研数据。
- 路径检查使用规范包含关系，并检查现有目标或最近现有父目录的真实路径。
- 服务默认绑定 `127.0.0.1`；远程动作还要求环境 kill switch、任务策略和显式批准根。
- 有运行历史的 Project、Task 和 ResearchPlan 只能归档；账本事件不提供更新或删除 API。
