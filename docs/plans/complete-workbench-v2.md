# DFT+DMFT Workbench V2：Codex 驱动的完整纵向闭环实施计划

> 状态：步骤 1～6 已完成；工作流骨架、研究方案采用快照、Agent 运行记录、待沟通筛选、超算管理、证据/经验分离和 Codex 经验检索/沉淀反馈已落实；步骤 7 的正式数据库备份与 schema v4 迁移已完成，真实 HPC pilot 未授权、未执行  
> 调查与修订日期：2026-08-15  
> V1 基线：`2794435 feat(agent): add bounded research environment v1`  
> 前置计划：[`agent-research-environment-v1.md`](agent-research-environment-v1.md)

当前验证基线：`npm test` 25 项（24 通过、1 个平台条件跳过）、Playwright 2/2、typecheck、lint（0 error/10 个既有 warning）和生产构建均通过。正式库已从 V0 升到 schema v4：7→19 张表，既有 3 Project、6 Task、3 ResearchPlan、24 StepProgress 保留，完整性/外键/重复启动和 `workbench doctor` 检查通过；4 个任务根安全回填，2 个无法唯一确认的旧任务保持 unresolved。

## 0. 架构结论

V1 已把合同、上下文、policy、账本、评价和受控 OpenSSH/LSF 原语做成可用基础，但原 V2 计划把 Agent 错放到了 Web/Express 内部，最初实现又把首个材料路线误做成产品 adapter。正确边界是：

- **Codex 项目对话是 Agent 本体**：研究者与 Codex 先讨论研究方案和工作流；Codex 负责推理、提出方案、等待确认并执行获准动作。
- **项目内 skill + `workbench` CLI 是 Codex 的工具层**：Codex 只通过受控 CLI/API 操作 Workbench，不直接读写 SQLite，不绕过 policy 执行任意 SSH/LSF 命令。
- **Express/SQLite 是状态与安全边界**：保存不可变上下文、action、job、artifact、evidence、review 和事件；提供材料无关的 capability contract、确定性路径、权限、幂等与执行边界。
- **禁止任务硬编码**：材料名、Task ID、固定 workflow step、科学脚本路径和软件专属参数由 Codex 从研究上下文写入单次 action spec，不进入执行器、路由或 CLI。
- **Web 是观察面**：Agent 运行记录、待沟通事项、证据库和超算管理展示 Codex 已记录的状态、差异、命令预览、作业和证据，不启动 Agent、不批准方案、不提交、取消或对账。

因此本次不实现 Web runner、后台模型 worker、模型 provider 或 Web“点击启动”。“完整”限定为：**研究者在 Codex 对话中完成沟通和授权，Codex 通过项目工具执行一条真实 DFT+DMFT 路线，Workbench 持久化全过程，Web 准确展示全过程。**

## 1. 当前实现、页面定位与受影响范围

### 已实现基线

- V1 已提交为 `2794435`，当前工作区除本计划外无未提交业务代码。
- 原有工作台支持 Project/Task CRUD、任务独立工作流、步骤进度/笔记/命令/LSF 脚本、文件浏览、研究方案、经验库和旧 HPC 复制粘贴向导。
- Agent V1 支持稳定任务根、YAML 合同、不可变上下文、分层 policy、追加事件、评价、CLI 及固定 SSH/SFTP/LSF 动作。
- V1 收尾已加固任务根不可改写、合同收紧判断、评价幂等、protected paths/smoke 预算、不确定提交恢复和下载原子写入。
- 当前验证：`npm test` 共 17 项，16 通过、1 个 Windows 符号链接用例跳过；typecheck 通过；lint 为 0 error/10 warning；2 条浏览器 E2E 通过，已覆盖合同初始化、task policy、run 启动和评价决定。
- 正式 `data/workbench.db` 已于 2026-08-15 在一致性备份后升级到 `user_version=4`、19 张业务表；所有 V2 执行/证据表初始为空。真实 SSH/LSF 科学作业仍未授权。

### Web 页面当前与目标定位

| 页面 | 当前能力 | V2 目标 |
|---|---|---|
| Agent 运行记录 | 页面可初始化合同、改 policy、启动 run、inspect/smoke | 只读运行账本：显示当前/已采用方案、工作流、blocker、action 命令预览、job、artifact、evidence、事件和数据新鲜度 |
| 待沟通事项 | 页面可批准、补充、驳回、终止 | 按项目/任务/状态筛选的只读沟通队列；决定回到 Codex 对话处理 |
| 证据库 | 与 Experience 混在同页 | 独立管理 run artifact/evidence、本地下载副本与处理/绘图产物的可追溯索引 |
| 经验库 | 人工 Experience CRUD | 区分人工、Codex 候选与证据确认经验；Codex 自动检索、沉淀，研究者确认后提升 |
| 任务工作流 | 人工查看和编辑步骤/进度 | 保留编辑功能；额外只读显示 Codex action/job/evidence 与步骤的关联，不从 Web 触发执行 |
| 超算管理 | 旧复制粘贴提交向导 | 删除旧向导；兼容读取原配置，统一管理项目连接元数据、边界、传输 action 与作业快照；真实执行只由 Codex 经 CLI/capability manifest 发起 |

“Web 只读”特指 Agent 执行、评价和远程作业相关页面；现有 Project、ResearchPlan、Workflow 等管理编辑能力保持兼容，除非研究者另行要求全部只读。

### 主要受影响模块

- 数据与迁移：`server/db.ts`、`server/migrations.ts`。
- Agent/执行服务：`server/services/agentCore.ts`、`agentActions.ts`、`actionExecutor.ts`、`remote.ts`、`pathSafety.ts`；不新增材料或软件栈专用 adapter。
- Codex 工具入口：`bin/workbench.js`、`skills/workbench-agent/SKILL.md`、`skills/workbench-agent/agents/openai.yaml`，以及必要的只读/写入 API。
- Web 读模型：`src/types/index.ts`、`src/api/client.ts`、`AgentRunsPage.tsx`、`ReviewCenterPage.tsx`、`ExperiencePage.tsx`、任务工作流组件。
- 验证与说明：`tests/`、`TESTING.md`、`README.md`、`docs/`、`doc/`、`AGENTS.md`。不进行无关的全仓 DAO 或视觉系统重构。

## 2. 目标、非目标与验收条件

### 目标

1. 研究者和 Codex 在项目对话中先核对研究方案、工作流、物理边界、资源和完成标准；未达成一致时 Codex 不启动 run、不执行 preflight 或远程动作。
2. Codex 通过项目 skill/CLI 读取统一 Context、提交方案/工作流修订、记录用户决定，并执行经过合同/policy/manifest 约束的动作。
3. 建立 `research_run → workflow step → Codex action → execution manifest → remote job → artifact/evidence → review → progress` 的持久数据链。
4. Web 只读、准确地展示上述状态，使研究者能独立核对 Codex 做了什么、为什么做、使用了哪些输入和资源、产生了什么结果。
5. 通用执行接口可由 Codex 驱动不同材料与不同工作流；首个真实纵向验收可选现有 CaCrO3 任务，但它只能作为项目数据/pilot，不能成为产品 route。

### 非目标

- 不在 Express 中启动 Codex CLI、模型 API 或后台 Agent worker；不在 Workbench 保存模型凭据。
- 不通过 Web 启动/暂停 Agent、批准评价、上传/下载、提交/取消/对账作业。
- 不为 QE/W90/TRIQS、WIEN2k/dmftproj 或任一材料建立专用执行分支；通用 capability 接口之外不扩展软件路线注册系统。
- 不猜测或自动修正赝势、U/J、双计数、投影窗口、k 网格、收敛阈值或求解器参数。
- 不开放任意远程 shell，不保存 SSH 私钥/密码，不自动生成最终科学结论。
- 不实现多 Agent、MCP、分布式队列或局域网多用户认证。
- 不移动、覆盖或清理现有 `repository/`、远程计算输出和 pilot 证据。

### 验收条件

1. 正式库升级前后表/行数、外键和 `integrity_check` 可核对；升级失败能从一致性备份恢复；旧项目、任务、方案、进度和项目级 HPC 配置保持可用。
2. 新会话中的 Codex 执行 `workbench context` 后能恢复 run、当前 step、未决沟通、远程 job 和事件游标，不依赖上一段对话记忆。
3. Codex 在修改研究方案/工作流或提交科学作业前，必须在对话中展示差异或 execution manifest 并获得研究者明确确认；确认摘要、context 和 manifest 哈希写入账本，不默认保存完整聊天内容。
4. 每个动作绑定 context version、workflow step、输入/脚本哈希、资源、幂等键、执行者 `codex` 和可选会话引用；实际执行内容与获准 manifest 一致。
5. Codex 可通过同一 CLI capability contract 自主组合 local validator、上传/下载、提交、状态、日志、取消和 uncertain submission 对账；服务或 Codex 会话中断后不重复提交。
6. Agent 运行记录、待沟通事项、证据库及任务步骤只通过 GET/只读调用展示最近记录状态和最后同步时间；超算管理只允许保存连接元数据，不提供执行、批准、上传下载、提交、取消或远程对账按钮。
7. 用户在 Codex 对话中处理 review；Codex 只能在明确用户决定后写入 approve/supplement/reject/terminate 或 researcher conclusion。stale/double decision 被拒绝。
8. 候选真实任务至少完成：正式库 run、输入校验、preflight、远程 capability、一次获准 execution manifest 的提交、终态/日志/证据回收；同时证明产品执行代码不含该任务/材料/脚本的专用分支。是否执行真实科学作业仍需科学与资源授权，未授权时不得用 smoke 冒充科学验收。
9. `npm test`、lint、typecheck、build 和新的 Codex→CLI→API→Web 读模型 E2E 通过；`npm start` 使用新 `dist/` 验收并提醒硬刷新。

## 3. 关键数据流与模块契约

```text
研究者 ⇄ Codex 项目对话
             │ 讨论 Plan / Workflow / 物理边界 / 资源 / 完成标准
             │ 明确确认后
             ▼
项目 workbench-agent skill
             │ 只调用 workbench CLI
             ▼
Workbench HTTP API ──→ SQLite：context/action/event/review/artifact/evidence
             │
             └─→ 通用 capability + 确定性 path/policy/manifest 校验
                       └─→ OpenSSH/SFTP/LSF 受控原语
                                  └─→ 远程 job / 输出
                                             │ Codex 主动 status/reconcile/log
                                             ▼
                                      SQLite 最新观察
                                             │
                                             ▼
                                  Web 只读展示（不发动作）
```

在现有表上增量扩展，建议新增：

- `run_actions`：由 Codex 创建，记录 step、动作类型、状态、context、manifest 哈希、幂等键、执行结果和关联 job；不需要 worker lease。
- `run_artifacts`：只保存任务根/批准远程根内的路径引用、大小、哈希、来源 action/job 和证据类别，不把大文件复制进 SQLite。
- `evidence_checks`：validator 名称/版本、输入 artifact、结构化结果和 pass/warn/fail。
- `remote_jobs`：增加 action/step、execution manifest、脚本和资源哈希；现有 smoke 记录向后兼容。
- review/decision/event 增加可选 `source=codex_conversation`、决定摘要和会话引用；默认不保存聊天全文。

Web 使用独立的只读聚合接口或现有 GET Context；写 API 继续供本地 CLI 使用。页面读取不会触发 SSH/LSF 查询，必须显示“最后由 Codex 对账于何时”，避免把缓存状态伪装成实时状态。

## 4. 实施步骤（按依赖顺序）

### 步骤 1：以已提交 V1 为基线演练正式库迁移

实施：固定 `2794435` 为 V1 基线；对 `data/workbench.db` 做一致性只读盘点和单独备份，在临时副本上运行 V1/V2 迁移、稳定任务根回填和应用启动，生成迁移/回退报告，不先触碰正式库。

完成标准与验证：临时副本升级可重复、`integrity_check`/外键通过，3 Project/6 Task/3 Plan/24 progress 不丢失；中文路径和无法解析的旧任务根 fail closed；回退后旧库可由 V1 基线只读打开。运行默认测试、typecheck、lint。本步可独立完成。

### 步骤 2：固定 Codex action、artifact/evidence 与 CLI 契约

实施：增加上述表、约束、索引和 V2 `user_version`；定义 action 生命周期（proposed/authorized/executing/waiting_remote/waiting_user/succeeded/failed/cancelled）、execution manifest、artifact/evidence schema。扩展 CLI，使 Codex 能读取/修订 plan、workflow、contract、context，记录用户决定，创建/执行 action 及查询结果。

完成标准与验证：每个 action 可追溯到 run/context/step；相同幂等键不产生第二个 action/job；非法状态跃迁、stale context、路径/资源越界返回结构化错误。覆盖 fresh/现役仿真/重复/中断迁移、CLI 退出码和崩溃后重试。本步固定公共契约，是后续依赖。

### 步骤 3：把项目 skill 变成 Codex 的强制操作协议

实施：扩展 `workbench-agent` skill 和 `AGENTS.md` 路由：每次先获取 Context；先在对话中讨论并展示 plan/workflow/manifest；只有用户明确确认后才写入决定或执行；远程动作只走 CLI，不直接 `ssh`/`bsub`/SQLite；每个新会话先对账 running/uncertain jobs；所有事实、推断、决定分开记录。

完成标准与验证：用一个全新 Codex 对话按 skill 可从 Task 恢复上下文，能在未确认时停住，确认后生成稳定 CLI 调用；模拟缺 Context、方案 drift、用户拒绝、会话中断和恢复。skill/CLI 契约测试不依赖真实集群。本步在步骤 2 后可独立验收。

### 步骤 4：实现材料无关的 action capability executor

实施：公开 `local.process`、`remote.inspect`、`files.upload/download`、`job.submit/cancel` 的统一 spec；Codex 根据采用的研究方案/工作流选择具体 validator、脚本、输入、路径与资源。服务建立输入/脚本快照并绑定 context/step/manifest 哈希，只负责 allowlist、path、policy、resource、幂等和状态机。移除 CaCrO3 专用路由、CLI、服务和固定脚本映射，也移除绕过 manifest 的 task 级 remote 写入口。

完成标准与验证：Codex 只能执行哈希与获准 manifest 一致的动作；失败不会越过 review；不支持的 capability/命令明确阻断；响应丢失只对账不重提。两个不同材料、不同 workflow 的测试使用同一 `local.process` 接口，通用 LSF fixture 验证 single-shot/uncertain reconcile，静态测试禁止产品执行面出现材料/任务/固定科学脚本。本步依赖步骤 2/3，不需要 Web。

### 步骤 5：把 Agent、待沟通、证据和超算页面改成分层观察面

实施：移除 Agent 页面中的合同/policy/run/inspect/smoke 写控件和评价决定按钮；新增 action/job 详情、命令预览、manifest/hash、artifact、validator、事件、待沟通筛选和最后同步时间。拆分证据库与经验库；删除旧超算提交向导，以超算管理维护连接元数据并只读展示 policy、传输和作业。任务工作流节点只读显示关联 action/job/evidence，并明确其只是核心骨架。

完成标准与验证：浏览 Web 不产生新的 event/action/job/decision；刷新页面只读取 SQLite 已记录状态；状态过期清晰可见；项目/任务切换不串数据。E2E 对请求进行断言，确保 Agent 相关页面没有 POST/PUT/DELETE，并覆盖空、active、waiting_user、uncertain、failed 和 completed 状态。本步在步骤 2 后可与步骤 3/4 并行。

### 步骤 6：完成 Codex 对话中的 review、结论与经验沉淀

实施：Codex 遇到科学边界、资源、异常或不确定提交时创建 review，并在对话中向用户展示旧新 context/manifest/resource diff、证据和建议；收到明确决定后由 CLI 写入并继续或停止。研究者明确给出 conclusion 后，Codex 才记录 researcher conclusion；经再次确认可提升为 Experience，并保留来源 run/artifact 哈希。

完成标准与验证：没有用户确认时 CLI/skill 不写 researcher decision/conclusion；stale、double decision 和 source drift 可恢复；Web 只展示决定。测试覆盖各 gate、决定分支、拒绝/补充后的行为、终止时活动 job 提示和审计链。本步依赖步骤 2/3，端到端验收依赖步骤 4/5。

### 步骤 7：正式库启用与 Codex 驱动的真实 pilot（数据库完成，HPC 待授权）

实施：停服务、备份并迁移正式库；在本 Codex 项目对话中与研究者确认候选任务的方案、任务工作流、计算分支、资源和完成标准；由 Codex 通过 CLI 解析 Task 根、绑定方案/合同、启动 run，并根据实际项目文件生成通用 local/remote capability spec。研究者审阅 Codex 展示的 execution manifest 并明确确认后，Codex 才提交首个科学作业，随后主动对账、取日志、登记 artifact/evidence 并推进步骤。若选择 CaCrO3，它仍只是首个 pilot 数据，执行路径与其他材料完全相同。Web 只用于旁路核对。

完成标准与验证：满足第 2 节全部验收条件；默认门为 test/lint/typecheck/build/E2E，远程门为 Codex 经 CLI 完成 inspect/transfer/submit/reconcile/log；新 Codex 会话能恢复同一 run/job。若科学作业未获授权，只能标记为“科学执行待批准”，不能宣称真实 DFT 验收。本步是唯一写正式数据库和远程测试根的阶段。

## 5. 兼容性、回归与回退风险

- **正式库跨版本**：正式库已升级为 v4；保留用户时间戳 v0 备份、Agent V1 门前 v0 备份和 Workbench V2 门前 v2 备份。回退必须先停服务并对账外部作业；当前没有正式 remote job。
- **控制面混淆**：Express 不得启动或托管 Codex；Web 前端不得调用 Agent 写 API。代码评审和 E2E 都要检查此边界。
- **Codex 会话中断**：聊天上下文不是状态源；run/action/job/review 必须持久化，新会话先 `workbench context` 和 reconcile。
- **用户决定归属**：Codex 只能在用户明确回复后记录 researcher decision/conclusion；保存决定摘要、哈希和可选会话引用，默认不保存完整聊天。
- **CLI 绕过风险**：skill 和 `AGENTS.md` 必须禁止直接 SQLite、`ssh`、`bsub` 和未批准脚本；capability executor 继续在执行点强制 policy、path、resource 和 manifest，远程写动作不保留直通 API。
- **任务硬编码风险**：新增材料时不得修改执行器、路由或 CLI；如需改变产品代码才能执行新 Task，即视为架构回归并由静态/跨工作流测试阻断。
- **任务根与中文路径**：旧任务根无法唯一确认时 fail closed，由 Codex 与用户沟通后调用受控 root API，不移动目录。
- **外部状态风险**：远程 job 会比 Codex 对话存活更久；Web 只显示最后观察，Codex 查询时对账；submit 响应丢失不自动重提。
- **连接配置被误认成权限**：超算管理中的 OpenSSH alias/远程根只是项目元数据；只有 Codex 经采用 policy、精确 manifest 和明确确认后执行的动作才进入证据链。
- **科研数据风险**：不删除、不覆盖现有输入输出；任何参数、脚本或生产资源变化均先在对话中确认。
- **回退**：停止发起新的 Codex action，对账 running/uncertain job，再停止服务；代码和数据库分别回退，SQLite 从迁移前备份恢复，远程作业/输出不自动删除。

## 6. 已确定边界与仍需研究者决定的问题

### 已确定

1. Agent 位于 Codex 项目对话，不位于 Web、Express 或后台 worker。
2. Agent 相关 Web 页面只读；执行、沟通和授权在 Codex 对话完成。
3. Codex 通过项目 skill + `workbench` CLI/API 操作，Workbench 是状态、安全和审计层。
4. 正式库已获研究者明确授权并迁移到 schema v4；未合并隔离 pilot 数据。

### 仍需决定

1. **真实脚本授权模型**：建议对每个科学 step 的 immutable execution manifest 明确确认；manifest 固定脚本、输入、队列、核数、墙钟和路径。已确认 manifest 内的状态查询/日志/证据登记无需重复授权。
2. **首个真实 pilot 任务**：可以选择现有 CaCrO3 复现任务，也可以选择其他材料；选择只影响 Codex 生成的 spec/manifest，不改变产品支持范围或执行代码。
3. **决定记录隐私**：建议只保存用户决定摘要、时间、context/manifest 哈希和可选 Codex task 引用，不保存完整对话正文。
4. **真实 HPC 授权**：步骤 7 剩余部分需确认 OpenSSH alias、批准远程根、queue、S0 SCF 核数/墙钟，以及是否允许首个科学作业。

## 7. 可独立完成和验证的阶段

| 阶段 | 可独立交付/验证 | 依赖与并行关系 |
|---|---|---|
| A：步骤 1 | 是；正式库副本迁移和回退报告 | 无外部集群依赖 |
| B：步骤 2 | 是；schema/API/CLI/action 契约 | 依赖 A；完成后冻结公共契约 |
| C：步骤 3 | 是；Codex skill 操作协议 | 依赖 B；可与 E 并行 |
| D：步骤 4 | 是；材料无关 capability executor | 依赖 B/C；不依赖 Web、不触碰正式库 |
| E：步骤 5 | 是；Web 只读观察面 | 依赖 B；可与 C/D 并行 |
| F：步骤 6 | 部分独立；review 契约可先做 | 依赖 B/C；端到端依赖 D/E |
| G：步骤 7 | 否；最终集成与真实验收门 | 依赖 A-F 和研究者的数据库/HPC 明确授权 |

确认本计划后，按 A → B →（C ∥ E）→ D → F → G 推进。任何需要科学判断或远程写入的动作都回到 Codex 对话等待研究者确认，Web 始终只是可核对的观察面。
