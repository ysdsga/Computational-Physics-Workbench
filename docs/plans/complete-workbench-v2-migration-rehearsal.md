# Workbench V2 数据库迁移与回退演练

> 日期：2026-08-15  
> 基线：`27944358139bfcc7ce289ad1b91cca2454cdb04a`  
> 范围：先只读盘点和隔离演练；研究者随后单独授权正式库备份与迁移。科研目录和真实 HPC 未修改

## 结论

步骤 1、schema v4 复演和正式迁移均通过。正式数据库已在独立在线备份验证后从 `user_version=0`、7 张业务表升级到 v4、19 张业务表；完整性、外键、既有业务行数和第二次应用启动均通过。真实远程能力保持关闭，隔离 pilot 数据未合并。

## 正式库只读基线

| 检查项 | 结果 |
|---|---|
| `PRAGMA user_version` | `0` |
| 业务表数 | `7` |
| `projects` | `3` |
| `tasks` | `6` |
| `research_plans` | `3` |
| `step_progress` | `24` |
| `step_files` | `0` |
| `experiences` | `0` |
| `workflow_templates` | `3` |
| `PRAGMA integrity_check` | `ok` |

正式库带有 WAL/SHM，因此演练源使用 SQLite 在线备份，而不是直接复制单个 `.db` 文件。

## 隔离迁移结果

- 初始一致性快照：`workbench-v0.db`；迁移前 SHA-256 为 `1ADC6C3E3A20F89C196C049D0BFAC8812D5DDA3FA7DE13057BBE696B2D7B5FF1`。
- 使用 V1 服务启动快照后，`user_version` 升为 `2`，表数升为 `14`。
- `PRAGMA integrity_check` 返回 `ok`；`PRAGMA foreign_key_check` 无结果行。
- 原有 3 Project、6 Task、3 ResearchPlan、24 StepProgress 均保留；新增 Agent 表均为空。
- 4 个任务根被唯一解析，2 个旧任务（`111`、`Folder Test`）保持 unresolved 并 fail closed，没有猜测路径或移动目录。
- 对同一副本再次启动服务后，`user_version`、表数、业务行数和迁移前备份哈希均不变，证明迁移可重复启动。

## 备份与回退验证

- 迁移生成的备份：`workbench-v0.before-agent-v1.db`。
- 备份 SHA-256：`23246FAD8D4B089FC8348D8769FED9D4A77B57215DD17F48253824274C01D020`。
- 从该备份生成的回退副本 `restored-v0.db` 仍为 `user_version=0`，`integrity_check=ok`，既有业务行数与正式库基线一致。
- 回退副本 SHA-256 与迁移前备份完全一致。
- 该轮演练结束时正式库仍为 `user_version=0`、7 张表、`integrity_check=ok`；正式迁移发生在后续单独授权后。

## 最终 schema v4 复演

- 正式库在线备份 `workbench-v0.db` 的迁移前 SHA-256：`8852DBACF643BF0F0772CD03AB173D2A8855B8485ED8F561948150D43847FA9A`。
- 副本从 `user_version=0` 升到 `4`，业务表从 7 张升到 19 张；v3 的 action/artifact/evidence 和 v4 的 `experience_promotions` / `experience_promotion_artifacts` 均已建立。
- 既有 3 Project、6 Task、3 ResearchPlan、24 StepProgress、0 StepFile、0 Experience、3 WorkflowTemplate 全部不变；抽查的 5 张 V2/v4 新表均为 0 行。
- `PRAGMA integrity_check=ok`；`PRAGMA foreign_key_check` 无结果行。
- V2 一致性备份 `workbench-v0.before-workbench-v2.db` 的 SHA-256 为 `BFA134E51D6F181C506DDBD96D640F28AEF2F2A36BAEC98CC9CE34322037156E`；第二次启动后哈希不变，副本仍为 v4/19 表。
- 自动化测试另覆盖 V0→V4 重复启动，以及从迁移生成的 V1（`user_version=2`）副本单独升级到 V4。
- 该轮复演结束时正式库仍为 `user_version=0`、7 张表、`integrity_check=ok`；以下正式迁移记录取代该临时门禁状态。

## 正式迁移结果

- 授权原文：`授权备份并迁移正式 data/workbench.db 到 schema v4；暂不授权真实 HPC 作业提交。`
- 用户时间戳 v0 备份：`data/backups/workbench-v0-before-schema-v4-2026-08-15T04-27-22-970Z.db`，SHA-256 `8852DBACF643BF0F0772CD03AB173D2A8855B8485ED8F561948150D43847FA9A`。
- 自动门前备份：`data/workbench.before-agent-v1.db` 为 v0/7 表，SHA-256 `3EAA5F5556023AE3B8A8AF355AA70FF33C4BFF19A6D7E9E1FA0CC00059943654`；`data/workbench.before-workbench-v2.db` 为 v2/14 表，SHA-256 `56A05C6E53B5EBC0F646B76F9BAE52BD9D086C5F52ABC5E73C663C5F38F15506`。
- 正式库迁移后为 v4/19 表；3 Project、6 Task、3 ResearchPlan、24 StepProgress、0 StepFile、0 Experience、3 WorkflowTemplate 不变，12 张 Agent/执行/证据新表均为空。
- 4 个可唯一确认的任务根已回填，2 个旧任务保持 unresolved；6 个任务工作流快照均存在。
- `PRAGMA integrity_check=ok`，无外键违规；第二次应用启动后状态不变。
- 远程能力以关闭状态启动验证；`workbench doctor` 返回 3 个项目，首页、Project GET 和 Review GET 均为 200，正式 review 为 0。

## 当前门禁

正式数据库门已完成。真实 HPC、远程目录写入和科学作业提交仍未授权；下一步必须先恢复具体 Task Context，并对精确 execution manifest 另行沟通和确认。
