# 关键设计决定

本文只记录当前有效决定。历史 V1/V2 方案保留在 `docs/plans/`，其中 Contract、分层 Policy、不可变 Context 与逐 Action 授权已被 V3 取代。

## 1. Codex 是 Agent，Web 是观察面

研究沟通、规划、执行和纠错发生在项目 Codex 对话。WebUI 负责显示记录、筛选和管理普通元数据，不成为启动、授权、提交、取消或对账入口。真实任务使用 `workbench-agent` skill；`workbench` 提供状态、边界、自动日志和调度器一致性，不充当逐命令审批门。

## 2. Task 不是 Job

采用 `Project → complex Task → Research Run → Stage → routine Event / milestone Action → Job`。普通命令只写 Event；少量科学里程碑使用 Action。一个 Action 可有零个、一个或多个 Job；Job 必须绑定 originating Action、Run 与 Stage。

## 3. Workflow 只保留骨架

Workflow 保存不可缺少的科学/软件阶段、关键转换、检查点和完成证据。连接、传输、诊断和临时命令只写 Event；科学重试、扫描和提交批次可成为里程碑 Action，避免把研究执行变成僵硬状态机。

## 4. Task Spec 取代 Contract/Policy/多套控制文件

Task Spec 分为：

- Confirmed Envelope：目标关键科学承诺、允许能力/方法/软件、HPC profile、资源、保护路径、完成证据与 researcher gates。
- Working Plan：当前阶段、目录布局、下一批 Action、诊断与重试策略。

数据库是 Task Spec 唯一机器来源，CLI/Web 只渲染它。不再维护 `.workbench/contracts`、分层 `agent_policies` 或 `run_context_versions`。

## 5. 只确认 Envelope 一次

首次执行前，Codex 向研究者展示 Research Plan、Core Workflow、精确 Envelope 与哈希，得到一次明确确认。之后 Codex 在 Envelope 内自主计划和执行，不再逐 Action 确认。

扩展科学承诺、方法/软件、资源、权限、保护路径或完成证据时，必须创建 researcher Pending Item，展示影响并重新确认 Envelope。Working Plan 普通变化不需要研究者批准。

## 6. Plan/Workflow 可纠错，证据不能被静默改写

发现缺漏后先计算影响范围。边界内由 Codex 修订并最小重算；边界外再沟通。旧 Artifact 保留并标记 `valid | suspect | invalid | superseded`，用 provenance 表达替代关系，禁止覆盖历史来伪造连续性。

## 7. Codex Pending 与 Researcher Pending 分开

运行环境、失败诊断、恢复、绘图和边界内纠错面向 `codex`；材料科学选择、Envelope 改变和结论歧义面向 `researcher`。阻塞默认按 Stage 定位，不冻结无关工作。

## 8. Codex 自主安排 Task 内目录

Workbench 只固定 Project 工作根与 Task 写根，不自动创建 Stage 目录。Codex 可根据复杂任务设计任意 Task 内树。HPC 用户根只读；上传、创建目录和作业 workdir 限制在绑定的 Task 写根。

## 9. 产品不注册材料 adapter

执行器只提供材料无关 capability 与边界校验。材料名、Task ID、固定 step、脚本路径、U/J、投影窗口、网格和求解器参数只能出现在项目数据或 Codex 单次 Action spec 中。新增材料/软件路线不修改产品执行代码。

## 10. Task 会话负责日常执行，Action 只记录科学里程碑

Envelope 确认后，`remote exec/upload/download` 自动派生 host/root，在登记边界内直接执行并追加 Event，不创建 Action。直接本地处理也不需要 Action。提交/取消、多 Job 批次或证据验证等科学里程碑才保存规范化 spec、SHA-256、Stage、幂等键与输入快照；Action 是溯源记录，不是微操作许可。

## 11. 远程提交必须可恢复

Job 行在 `bsub` 前以 `prepared` 写入，作业名由稳定 token 生成。`bsub` 返回后立即核对 scheduler ID/name。超时、丢响应或核对失败一律记 `submission_uncertain`，进入 Codex 待处理事项，只能按唯一作业名对账，不能重提。

## 12. 证据与经验分离

证据是用户/Codex 需要查看、下载、处理或绘图的项目 Task 产物；保存文件引用、哈希、有效性和 validator。经验是可复用的条件—症状—处理—适用边界。Codex 自动捕获的是 candidate，不是科学结论；确认经验仍保留来源 Run/Artifact。

## 13. schema v5 迁移 fail closed

v4 正式库的运行控制表为空，因此 v5 可以备份后替换旧 Policy/Context/Review/Promotion 表，保留 Project/Task/Plan/Workflow/Experience。若任何旧运行控制表非空，迁移拒绝启动，要求显式转换方案，避免丢失历史。

## 14. 当前安全边界的含义

Workbench 对自身入口强制 Task 根、HPC binding、capability、资源、输入哈希、幂等和恢复规则。若 Unix 账号本身拥有更宽权限，操作系统级硬隔离仍由集群 ACL、独立账号或容器提供；Workbench 不声称替代系统权限。

## 15. Scheduled Task 唤醒，Stop Hook 守门

长作业不能依赖一次 Codex 回合持续运行。每个 Job 的检查策略由提交它的 Codex 根据真实计算规模判断并固化在 Action spec；Workbench 只计算下一次到期时间与建议 heartbeat cadence。每个有非终态 Job 的 Run 绑定一个当前任务 heartbeat，且只有 Codex 自动化接口确认 ACTIVE 后才能记为 `scheduled`。heartbeat lease 用于发现已暂停或失联的假绑定。最后一个 Job 终止后，Workbench 返回删除指令并保留 reference；Codex 删除自动化、回写 `monitor close` 后才完成。Stop Hook 守住缺失、过期与待清理三种状态，但不轮询、不执行、不创建第二个 Agent。服务不可用时 Hook fail open 并提示下次先运行 doctor。

## 16. 自动重试必须有谱系和预算

替换失败科学 Job 的重试是新的不可变 Action，不覆盖失败 Action。它必须带 `retry_of_action_id`，每个 Action 最多一个 retry successor；服务计算 `retry_attempt` 并拒绝超过 Envelope `maxAutomaticRetries` 的尝试。连接、认证、超时、建目录、检查和传输失败只写 Event，不消耗该预算；`submission_uncertain` 只允许对账。

## 17. 理论研究采用追加式阶段反思循环

理论研究的每个核心阶段都执行记录、反思与下一步判断，同一阶段不限记录条数。`proceed` 前进，`stay` 留在当前阶段，`loop` 回到新发现所影响的最早阶段；回流后的下游完成状态必须重新建立。所有想法及处置保存在追加式 `stage.reflection` Event 中，Working Plan 只保存当前落点和下一批 Actions。该机制负责防止关键问题或启发性想法被静默遗漏，但不自动修改独立的 Research Plan。
