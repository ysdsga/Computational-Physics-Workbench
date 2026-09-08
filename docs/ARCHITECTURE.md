# 架构说明

当前版本为 Essential Workbench V3 / SQLite schema v8。Agent 本体是项目内的 Codex 对话；Express、SQLite 和 WebUI 是边界、记录与观察设施。

## 总体数据流

```text
研究者 ⇄ Codex 对话（思考、沟通、执行）
                 ▲
                 │ current-chat Scheduled Task（长作业唤醒）
                 │
                 │ workbench-agent skill
                 ▼
           workbench CLI
                 │ HTTP
                 ▼
┌──────────────── Workbench API ────────────────┐
│ Run / Task Spec │ Event / Action  │ SSH/LSF   │
│ Pending items   │ Artifact/Evidence│ Experience│
└──────────────────────┬─────────────────────────┘
                       ▼
                  SQLite ledger
                       │
                       ▼
             WebUI 观察与元数据管理
```

Web Agent、待沟通、证据与超算页面没有 Run 启动、Envelope 确认、Action 执行、Job 提交/取消/对账按钮。真实研究执行只走项目 `workbench-agent` skill 与 `workbench` CLI。

## 规划模型

Research Plan 记录科学思路，Core Workflow 记录最小骨架，Task Spec 把执行边界与当前策略分开：

- Confirmed Envelope 需要研究者一次明确确认；改变科学承诺、方法/软件、资源、权限、保护路径或完成证据时才重新确认。
- Working Plan 由 Codex 在边界内自主修订，包括 Task 目录树、Action 分解、诊断和重试。

Task Spec 以 `research_runs` 为唯一机器来源；CLI 与 Web 都从数据库渲染，不再维护独立 Contract/Policy 文件。

## 后端职责

- `server/migrations.ts`：可重复 schema 迁移和一致性备份。v5 精简运行模型；v6 增加 Run monitor；v7/v8 增加理论探索与逐阶段反思模板。
- `server/services/agentCore.ts`：Task Spec 校验、Run、Envelope 确认/修订、Working Plan、阶段反思循环、Pending Item、Event 和统一 Context。
- `server/services/agentActions.ts`：Action、Artifact validity、Evidence 与证据库查询。
- `server/services/actionExecutor.ts`：材料无关 capability、输入快照、Action spec、回执与执行恢复。
- `server/services/hpcConfig.ts`：验证连接 profile 和 Task 目录映射，派生用户读根/项目根/Task 写根。
- `server/services/remote.ts`：Task 会话式 OpenSSH/SFTP、自动 Event、提交身份、提交后 sanity check 与对账。
- `server/services/jobMonitor.ts`、`monitorStore.ts`、`monitorPolicy.ts`：持久化一个 Run monitor、按 Job 规格自适应检查、自动化生命周期指令、heartbeat lease 与 Stop Hook guard。
- `server/routes/*.ts`：HTTP 契约；Agent 写接口供 CLI 使用，Web 调用方只读取 Agent 记录。

执行器不得包含材料名、Task ID、固定 Workflow step、科学脚本路径或软件专属参数。新增材料/路线由 Codex 生成新的 Research Plan、Workflow、Task Spec 和 Action spec，不注册产品 adapter。

## 文件与工作流

`src/data/workflows.ts` 只提供内置默认、首次播种和模板重置。创建 Task 时模板复制到 `tasks.workflow_snapshot`，运行时以快照为准。

Workbench 只创建稳定 Task 根，不创建 Stage 子目录。Codex 可在 Task 根内设计任意树；路径解析阻止 `..`、绝对路径、同名前缀和符号链接逃逸。Workflow 删除节点不会删除历史文件。

## Task 会话、Action 与远程作业

确认 Envelope 后，CLI 默认返回紧凑恢复 Context。`remote session` 只展示服务派生的 host 和用户读根/项目读根/Task 写根；`remote exec/upload/download` 在该边界内直接工作并自动追加 Event，不需要 prepare/execute Action。普通连接或文件操作失败不会消耗科学重试预算。任意 shell 命令仍不得通过此通道直接提交或取消调度器 Job。

Action 保留给提交/取消、多 Job 批次和证据验证等科学里程碑。可执行 Action 在创建时规范化并哈希；提交输入保存文件快照。确认 Envelope 后无需逐 Action 授权，但科学里程碑执行仍检查：

- capability、Stage、method/software 是否在 Envelope；
- Task/HPC binding 是否仍匹配；
- 本地与远程路径是否在边界内且不覆盖保护路径；
- LSF 核数、墙钟、并发是否在资源上限；
- 输入/脚本哈希与创建 Action 时一致；
- 幂等键与回执是否属于同一 Action。

`job.submit` 先插入 Job 再调用 `bsub`。成功返回后用 `bjobs` 核对 ID/name；丢响应或核对失败写为 `submission_uncertain`。恢复按唯一 `job_name` 查 `bjobs/bhist`，从不通过重提判断状态。

首次出现非终态 Job 时，Run monitor 进入 `required`。每个提交规格保存 Codex 对该 Job 的预计运行时间、首次检查、RUN/PEND 检查间隔和依据；Workbench 从当前活跃 Jobs 计算推荐 heartbeat cadence，而不是使用全局 10/15/30 分钟表。Codex 创建、恢复或更新当前任务 heartbeat，确认自动化真实为 ACTIVE 后把 reference、cadence 绑定为 `scheduled`。`next_check_at` 决定一次唤醒是否访问 HPC；heartbeat lease 检出“账本已绑定但自动化没有继续唤醒”。最后一个 Job 终止后 monitor 保留 reference 并返回 `delete`，直到 Codex 删除自动化并提交 `monitor close` 回执才完成闭环。Stop Hook 会阻止未监控、lease 过期和待删除状态；Hook 和 Web 都不是后台 Agent。

替换失败科学 Job 的重试 Action 必须通过 `retry_of_action_id` 形成单链，`retry_attempt` 由服务计算，并硬性受 Confirmed Envelope 的 `maxAutomaticRetries` 限制。

Codex 可取消当前 Run 自己创建的错误/已替代 Job，前提是 Envelope 允许 `job.cancel`。外部调度器与远程文件系统是真实状态源；数据库保存最近观察与可恢复身份。

## WebUI

- 项目仓库：Project/Task 与本地文件。
- 工作流：模板与 Task 核心 Workflow。
- 研究方案：可持续修订的 Markdown。
- Agent 运行记录：Task Spec、Stage/Action/Job、命令预览、证据和 Event。
- 待沟通事项：Project/Task/status/audience 筛选；区分 Codex 与 researcher。
- 超算管理：连接与 Task binding；显示 Envelope、传输和 Job 记录。
- 证据库：Artifact、validity、SHA-256、validator 与本地可用性。
- 经验库：人工、候选、确认经验及适用边界。

## 远程与数据安全

服务默认绑定 `127.0.0.1`，CORS 默认只允许 `localhost:5173` 与 `127.0.0.1:5173` 两个本机 Vite 来源；生产页或自定义端口需要用 `WORKBENCH_ALLOWED_ORIGINS` 显式列出全部允许来源。已确认 Envelope 与 Task binding 是执行授权；远程通道默认可用，可用 `WORKBENCH_REMOTE_DISABLED=1` 或 `WORKBENCH_REMOTE_SUBMIT_DISABLED=1` 紧急停用。连接使用严格 host key、BatchMode、无 agent forwarding、超时和输出上限；Workbench 不保存密码或私钥。

数据库迁移前创建 `*.before-essential-v3.db`，v6 创建 `*.before-job-monitor-v6.db`，v7/v8 分别备份理论探索和阶段反思模板迁移前状态。正式库迁移必须先停用旧服务；自动化测试通过 `WORKBENCH_DB_PATH` 使用临时库。Project、Task、Plan 有 Run 历史后只能归档，Event 和科学来源链不提供破坏性清理接口。
