# 架构说明

当前版本为 Essential Workbench V3 / SQLite schema v6。Agent 本体是项目内的 Codex 对话；Express、SQLite 和 WebUI 是边界、记录与观察设施。

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
│ Run / Task Spec │ Action executor │ SSH/LSF   │
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

- `server/migrations.ts`：可重复 schema 迁移和一致性备份。v5 精简运行模型；v6 增加 Run monitor、Job 检查状态与 Action retry lineage。
- `server/services/agentCore.ts`：Task Spec 校验、Run、Envelope 确认/修订、Working Plan、Pending Item、Event 和统一 Context。
- `server/services/agentActions.ts`：Action、Artifact validity、Evidence 与证据库查询。
- `server/services/actionExecutor.ts`：材料无关 capability、输入快照、Action spec、回执与执行恢复。
- `server/services/hpcConfig.ts`：验证连接 profile 和 Task 目录映射，派生用户读根/项目根/Task 写根。
- `server/services/remote.ts`：固定 OpenSSH/SFTP/LSF 原语、提交身份、提交后 sanity check 与对账。
- `server/services/jobMonitor.ts`、`monitorStore.ts`：持久化一个 Run monitor、到期 Job 检查、等待退避与 Stop Hook guard。
- `server/routes/*.ts`：HTTP 契约；Agent 写接口供 CLI 使用，Web 调用方只读取 Agent 记录。

执行器不得包含材料名、Task ID、固定 Workflow step、科学脚本路径或软件专属参数。新增材料/路线由 Codex 生成新的 Research Plan、Workflow、Task Spec 和 Action spec，不注册产品 adapter。

## 文件与工作流

`src/data/workflows.ts` 只提供内置默认、首次播种和模板重置。创建 Task 时模板复制到 `tasks.workflow_snapshot`，运行时以快照为准。

Workbench 只创建稳定 Task 根，不创建 Stage 子目录。Codex 可在 Task 根内设计任意树；路径解析阻止 `..`、绝对路径、同名前缀和符号链接逃逸。Workflow 删除节点不会删除历史文件。

## Action 与远程作业

可执行 Action 在创建时规范化并哈希；本地/提交输入还保存文件快照。确认 Envelope 后无需逐 Action 授权，但每次执行仍在服务端检查：

- capability、Stage、method/software 是否在 Envelope；
- Task/HPC binding 是否仍匹配；
- 本地与远程路径是否在边界内且不覆盖保护路径；
- LSF 核数、墙钟、并发是否在资源上限；
- 输入/脚本哈希与创建 Action 时一致；
- 幂等键与回执是否属于同一 Action。

`job.submit` 先插入 Job 再调用 `bsub`。成功返回后用 `bjobs` 核对 ID/name；丢响应或核对失败写为 `submission_uncertain`。恢复按唯一 `job_name` 查 `bjobs/bhist`，从不通过重提判断状态。

首次出现非终态 Job 时，Run monitor 进入 `required`。Codex 在当前任务中创建或复用一条 heartbeat Scheduled Task，并把其真实 reference 绑定为 `scheduled`。Scheduled Task 负责跨回合唤醒 Codex；`next_check_at` 决定本次唤醒是否真的访问 HPC；项目 Stop Hook 只检查活跃 Job 是否已绑定 monitor。PEND 按 10/30/60 分钟退避，RUN 约 15 分钟检查，终态清空下次检查。Hook 和 Web 都不是后台 Agent。

重试 Action 必须通过 `retry_of_action_id` 形成单链，`retry_attempt` 由服务计算，并硬性受 Confirmed Envelope 的 `maxAutomaticRetries` 限制。

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

服务默认绑定 `127.0.0.1`，CORS 默认只允许本机 Vite 源。远程执行还要求环境开关、严格 host key、BatchMode、无 agent forwarding、超时和输出上限；Workbench 不保存密码或私钥。

数据库迁移前创建 `*.before-essential-v3.db`，v6 再创建 `*.before-job-monitor-v6.db`。正式库迁移必须先停用旧服务；自动化测试通过 `WORKBENCH_DB_PATH` 使用临时库。Project、Task、Plan 有 Run 历史后只能归档，Event 和科学来源链不提供破坏性清理接口。
