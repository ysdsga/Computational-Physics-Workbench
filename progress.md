# DFT+DMFT Workbench 当前状态

> 核对日期：2026-08-19
> 当前实现：Essential Workbench V3 / SQLite schema v10。

## 权威入口

- 项目规则与 Agent 边界：`AGENTS.md`
- 架构：`docs/ARCHITECTURE.md`、`doc/架构图.md`
- Task 行为：`docs/TASKS.md`
- 数据库与接口：`doc/数据字典.md`、`doc/接口清单.md`
- 实施计划：`docs/plans/essential-workbench-v3.md`

## 当前功能

- Project、复杂 Task、独立核心 Workflow、步骤进度、文件浏览与 Research Plan。
- Task 创建只固定根目录；Codex 根据 Working Plan 自主安排 Task 内文件树。
- Task Spec = Confirmed Envelope + Working Plan；研究者确认 Envelope 一次，Codex 在边界内自主 Action/Job/排错/重试/下载分析。
- 通用 capability executor：local process、remote inspect、Task root create、upload/download、LSF submit/cancel；产品没有材料专用 adapter。
- Job 绑定 Run + Stage + originating Action；提交前落库、提交后 scheduler sanity check，不确定响应只对账不重提。
- 长 Job 使用“当前 Codex 任务 heartbeat Scheduled Task 唤醒 + Workbench 持久账本 + Stop Hook 守门”；PEND/RUN 自适应保存 `next_check_at`，Web 显示排队原因、最后进展和下次检查。
- 自动重试必须显式 `--retry-of`，形成不可分叉谱系并由 Envelope `maxAutomaticRetries` 硬性限制。
- Agent 运行记录、待沟通事项、超算管理、证据库、经验库均已分离；Agent Web 面只观察，不执行。
- Artifact 支持 valid/suspect/invalid/superseded；Experience 支持 manual/candidate/confirmed、适用边界与来源。
- 唯一 `workbench-agent` skill 与 `workbench` CLI 已升级为 V3 恢复/纠错/自治协议。
- 理论研究模板在每个阶段加入追加式记录与反思；支持不限次数的 `stay/loop/proceed`，并以完成守卫确保回流后的阶段重新闭环。

## 验证基线

- `npm run typecheck` 通过。
- `npm test` 通过：30 passed，1 个 Windows symlink 用例按环境跳过；Playwright E2E 5 passed。
- 临时库覆盖 schema v10、新 Task 不创建 Stage 目录、一次 Envelope 确认、Working Plan、主动探索且带证据闭合规则的追加式阶段反思与回流、自主本地 Action、阶段级 Pending、Artifact 纠错、Experience candidate、LSF single-shot、monitor tick、Stop Hook 与 retry budget。
- 正式 HPC 科学作业仍需先为目标 Task 生成 Research Plan + Task Spec，并由研究者确认精确 Envelope；不得用 mock/smoke 冒充科学计算。

## 历史摘要

- 2026-07：React + Express + SQLite 基线、Project/Task/Workflow/Research Plan。
- 2026-08-13 至 08-15：Agent V1/V2、真实 OpenSSH/LSF pilot、证据/经验与只读观察页面。
- 2026-08-16：用 Task Spec 单一控制面取代 Contract/Policy/Context/逐 Action 授权；恢复 Codex 边界内能动性并完成 V3 回归。
