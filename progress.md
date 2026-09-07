# Computational Physics Workbench 当前状态

> 核对日期：2026-09-07
> 当前代码：Essential Workbench V3 / SQLite schema v15；正式库未在本轮迁移（此前记录为 v14），启动新版服务时将先备份再执行保守迁移。

## 2026-08-30：理论研究外循环（正式模板已迁移）

- 保留八阶段骨架，在现有步骤落实“研究地图 → 寻找路线 → 推导验证 → 保留失败认识 → 更新地图”的外循环；没有 idea 不能当作目标完成。
- 新理论 Run 的 Envelope 固定原科学目标与回答标准；路线关闭和目标回答分开评估，条件性/诊断结果不能替代未约定的最终解释。
- 追加事件承载稳定路线 ID、父子关系、失败边界与后继问题；`research-map show` 和只读 Agent 页面展示跨 Run 地图，不清除失败，不重写旧 Run。
- schema v14 仅保守升级未定制的全局理论模板；不改独立 Task 快照、研究方案或其他工作流。研究者已单独授权本次正式模板迁移；已有 Task 应用仍需明确指定。
- 回归使用独立临时库，覆盖无想法继续探索、目标偷换阻止、部分结果回流、跨 Run 失败继承、有效证据、历史兼容与保守迁移。
- 本轮验证：45 项测试通过、1 项 Windows 符号链接测试跳过；lint 无错误（保留既有警告）、生产构建与 Skill 校验通过。浏览器全量复测 5/5 通过（首次一项在创建页面时崩溃，复测未再出现）；新地图面板另用隔离演示库核验，失败边界、后继路线与目标缺口均可见，控制台无错误。
- 正式迁移 v13 → v14：先在线一致性备份并在副本预演，再事务更新 16 处说明；保留 8 阶段、27 步和定制内容。其他 4 个模板与所有非模板表的内容指纹一致，包含 8 个 Task、11 个 Run、5 份 Research Plan、6202 条 Event、950 个 Artifact；外键与完整性检查通过。备份和摘要位于 `data/backups/theory-loop-20260830-AIS168/`，不入 Git。
- 正式 API 已返回新版全局模板。因另一个模型任务仍有活跃记录，本次未强行重启常驻后端；新版研究地图 API/结项逻辑须在维护重启后加载，不声称当前旧进程已经启用这些规则。

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
- 核心执行 Skill `workbench-agent` 与 `workbench` CLI 已升级为 V3 恢复/纠错/自治协议；仓库同时提供 `literature-research` 与 `theory-derivation` 科学能力。
- 理论研究模板在每个阶段加入追加式记录与反思；支持不限次数的 `stay/loop/proceed`，并以完成守卫确保回流后的阶段重新闭环。

## 验证基线

- `npm run typecheck` 通过。
- 完整工作区 `npm test` 通过：45 passed，1 个 Windows symlink 用例按环境跳过；Playwright E2E 5 passed。独立提交快照验证：前置工作流 38 passed、理论循环 42 passed，均另有 1 个环境跳过，构建通过；理论循环 lint 无错误，避免依赖未提交的远程执行改动。
- 临时库覆盖 schema v14、新 Task 不创建 Stage 目录、一次 Envelope 确认、Working Plan、主动探索且带证据闭合规则的追加式阶段反思与回流、自主本地 Action、阶段级 Pending、Artifact 纠错、Experience candidate、LSF single-shot、monitor tick、Stop Hook 与 retry budget。
- 正式 HPC 科学作业仍需先为目标 Task 生成 Research Plan + Task Spec，并由研究者确认精确 Envelope；不得用 mock/smoke 冒充科学计算。

## 历史摘要

- 2026-07：React + Express + SQLite 基线、Project/Task/Workflow/Research Plan。
- 2026-08-13 至 08-15：Agent V1/V2、真实 OpenSSH/LSF pilot、证据/经验与只读观察页面。
- 2026-08-16：用 Task Spec 单一控制面取代 Contract/Policy/Context/逐 Action 授权；恢复 Codex 边界内能动性并完成 V3 回归。
