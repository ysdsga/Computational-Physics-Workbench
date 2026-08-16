# DFT+DMFT Workbench V3：Codex 自主执行闭环精要化计划

> 状态：待研究者确认，尚未开始实施  
> 日期：2026-08-16  
> 关系：本计划取代 `complete-workbench-v2.md` 中尚未进入真实 HPC pilot 的执行方向；保留已经完成且仍有价值的通用远程能力、作业对账、证据与 Web 观察面。

## 0. 产品结论

Workbench 不采用简单的“项目 → 任务 → 作业”三层模型，也不规定 Task 内部目录树。目标模型是：

```text
Project
  └─ Task（一个复杂研究目标）
       ├─ Research Plan
       ├─ Workflow（只保存核心科学阶段）
       └─ Research Run
            ├─ Task Spec
            │    ├─ Confirmed Envelope（研究者确认的稳定边界）
            │    └─ Working Plan（Codex 可自主修改的执行计划）
            └─ Workflow Stage
                 └─ Action（检查、建目录、传输、执行、分析等）
                      ├─ Remote Job（可为 0、1 或多个）
                      └─ Artifact / Evidence
```

- Job 必须关联具体 Run、Workflow Stage 和产生它的 Action，不能只堆在 Task 根下。
- Workflow 只保存不可缺少的科学骨架；诊断、重试、文件处理和临时计算属于 Action/Working Plan，不膨胀 Workflow。
- Workbench 只确定 Project/Task 的远程访问边界，不规定 `inputs/results/analysis` 等固定目录；Task 根内的目录树由 Codex 按实际路线设计和调整。
- WebUI 是观察和管理科研对象的界面，不是 Agent 大脑，也不是远程执行入口。

最终交互固定为：

```text
研究者 ↔ Codex 讨论研究方案和核心工作流
              ↓
Codex 生成 Research Plan + Task Spec
              ↓
研究者对 Confirmed Envelope 确认一次
              ↓
Codex 在边界内自主规划、改工作计划、排错、监控、下载和分析
              ↓
Workbench 记录 Stage / Action / Job / Evidence / Pending Item / Experience
              ↓
WebUI 展示真实状态，不代替 Codex 决策或执行
```

## 1. 当前实现与受影响范围

### 当前实现

- 正式 `data/workbench.db` 已备份并迁移到 schema v4，原有 Project、Task、ResearchPlan、Workflow 和 StepProgress 已保留；V4 新增的真实运行表尚未承载正式 HPC pilot。
- 已具备通用 OpenSSH/SFTP/LSF 原语、Task 写根与用户目录只读边界、幂等提交/不确定提交对账、Action/Job/Artifact/Evidence 记录、Agent 运行记录、待沟通、证据库、经验库和超算管理页面。
- 当前控制模型过重：Research Contract、三级 Agent Policy、不可变 Context Version、逐 Action manifest 授权、Review request/decision 和 Experience promotion 形成了多套重叠状态机。
- 当前任务创建仍按 Workflow Stage 自动创建阶段目录；这与“Codex 自主设计复杂任务目录树”的目标冲突。

### 受影响模块

- 数据模型与迁移：`server/migrations.ts`、`server/db.ts`。
- Run/Action/Job：`server/services/agentCore.ts`、`agentActions.ts`、`actionExecutor.ts`、`remote.ts`、`agentActions.ts` 对应路由。
- Task 与路径：`server/routes/tasks.ts`、`server/routes/remote.ts`、项目/任务文件 API。
- Codex 唯一入口：`bin/workbench.js`、`skills/workbench-agent/SKILL.md`、`AGENTS.md`。
- 前后端契约：`src/types/index.ts`、`src/api/client.ts`。
- Web 观察面：Agent Run、任务工作流、待沟通、证据、经验、超算和文件浏览页面。
- 回归与文档：`tests/`、`TESTING.md`、`README.md`、`docs/`、`doc/`。

不进行无关的 UI 重做、全仓 DAO 重构、材料专用 adapter 或计算软件注册系统建设。

## 2. 本次目标、非目标和验收条件

### 目标

1. 用一个 Task Spec 取代 Contract、Policy、Context 和逐动作授权的重叠职责。
2. Task Spec 同时支持“一次确认”和“执行中自主修改”：研究边界稳定，工作计划可变。
3. 复杂任务按 Workflow Stage 组织科学主干；每个 Job 可追溯到 Stage 和 Action，但不强制物理目录结构。
4. Codex 在确认边界内可以自主建目录、生成/修改脚本、诊断、重试、监控、下载、处理和绘图。
5. 把安全性集中在访问边界、幂等提交、上传校验、真实运行检查和恢复对账中，而不是用户反复授权。
6. Web 能准确回答：现在做到哪个科学阶段、Codex 做过什么、超算作业在哪里、产生了哪些证据、有什么需要研究者决定。
7. 完成后无需再开发产品功能，即可在 Codex 对话中确认 CaCrO3 pilot 的最终 Task Spec 并进入真实任务。

### 非目标

- 不把所有命令、诊断或重试写进 Workflow。
- 不预先规定 Task 目录模板，不按 Workflow 自动创建阶段目录。
- 不允许 Web 启动/暂停 Agent，或提交、取消、重提和对账作业。
- 不硬编码材料名、Task ID、软件路线、脚本路径或科学参数。
- 不自动决定赝势、U/J、双计数、投影窗口、收敛判据或是否接受科学结论。
- 不开放 Task 写根以外的远程写权限，不保存 SSH 密钥或密码。
- 不引入模型 worker、多 Agent、消息队列或新的关键依赖。

### 总体验收条件

1. 新建复杂 Task 后只确定 Task 根边界；Codex 能在根内创建任意合理目录树，Web 文件页按实际树展示。
2. 一个 Run 只有一个当前 Task Spec：包含 Confirmed Envelope 和 Working Plan；普通计划调整不产生新版本或新授权。
3. 只有改变科学路线/关键科学决定、扩大资源上限、扩大写边界、执行破坏性操作或确认科学结论时，才生成研究者待沟通事项。
4. 每个 Action、Job、Artifact 都关联 Run 和 Workflow Stage；一个 Stage 可以有任意数量的 Action/Job，一个 Action 也可生成多个 Job。
5. 提交流水线至少包含：本地预检 → 上传 → 上传验证 → 只提交一次 → 幂等登记 → 提交后真实性检查 → 持续对账；响应不确定时不重复提交。
6. Codex 会话中断后通过 `workbench doctor/context` 可恢复当前阶段、Working Plan、活动/不确定 Job、待办和最近证据。
7. Web 访问不产生远程 Action/Job/Decision；作业状态明确显示最后对账时间，不伪装实时状态。
8. 临时数据库、模拟集群和浏览器 E2E 全部通过；正式库 v5 迁移有一致性备份和可验证回退路径。
9. 最终演练使用同一通用执行接口跑两个不同结构的 fixture；随后 CaCrO3 pilot 只需确认 Task Spec、连接和资源，不再修改产品代码。

## 3. Task Spec 与自主修改规则

Task Spec 是一个逻辑文档，由数据库保存为唯一事实源，CLI 和 Web 可渲染为 YAML/JSON；不再同步维护第二份 Contract 或 Policy 文件。

### Confirmed Envelope：仅在真正越界时重新确认

- 研究目标、采用的 Research Plan 和核心 Workflow。
- 已确定的关键科学选择与禁止 Codex 自行改变的参数。
- 超算连接、Task 可写根、用户目录只读范围。
- 队列、核数、内存、墙钟、并发数和总消耗上限。
- 允许 Codex 自主执行的动作类别。
- 完成证据、科学关口和需要研究者沟通的条件。

### Working Plan：Codex 可直接修改

- Task 根内的目录树和文件命名。
- 阶段内的操作顺序、命令、脚本实现和诊断方法。
- 不改变科学含义的输入/提交脚本修复。
- 上限内的资源选择、重试和并发安排。
- 日志检查、数据下载、本地处理、绘图和中间验证。
- 为解决工程失败增加、合并或取消的临时 Action。

Working Plan 原地更新；Action/事件时间线自然保留实际发生过的历史，不为每个小修改保存完整 Spec 版本。只有 Confirmed Envelope 实质改变时才递增 `envelope_revision`，保存差异摘要并重新确认。

## 4. 关键数据流与目标模块

```text
Codex 对话
  │ draft/confirm Task Spec，更新 Working Plan
  ▼
workbench CLI（唯一机器入口）
  │
  ├─ Run/Spec：当前阶段、确认边界、可变计划、待沟通
  ├─ Action：Codex 实际执行的操作和结果
  ├─ Remote pipeline：preflight/upload/verify/submit/reconcile
  └─ Evidence/Experience：文件、验证、结论依据和可复用经验
  ▼
SQLite + Task 实际文件树 + 远程 Task 根
  ▼
Web GET 读模型：Stage → Action → Job → Evidence 时间线
```

目标运行数据收敛为：

- `research_runs`：Run 身份、Confirmed Envelope、Working Plan、当前阶段和更新时间。
- `run_actions`：Stage 内的实际动作、输入 spec、结果、错误和幂等键；不再有 proposed/authorized 逐动作门禁。
- `remote_jobs`：关联 Action/Stage 的调度器作业和最近一次真实观察。
- `run_artifacts`：本地/远程文件、图和结果索引。
- `evidence_checks`：仅保留有价值的结构化验证；不承担授权职责。
- `pending_items`：统一 Codex 待办和研究者待沟通事项，以 `audience` 区分。
- `run_events`：保存关键事实、推断、研究者决定和结论，不复制每个 Action 的全部内容。
- `experiences`：增加适用范围、来源 Run/Artifact 和 candidate/confirmed 状态；移除 promotion 状态机。

V4 的 Policy、Context、Review 和 Promotion 表先从运行路径退役。v5 迁移前若发现其中有实际运行数据则转换为只读历史；确认空表后才移除。迁移不得静默丢弃记录。

## 5. 实施步骤（按依赖顺序）

### 步骤 1：冻结精简契约并完成 v4 数据盘点

实施：定义 Task Spec、Envelope 越界规则、Stage/Action/Job 关联和 `pending_items` 最小契约；只读盘点正式 v4 各运行表、活动/不确定 Job 和任务根，不执行远程动作。

完成标准：目标 schema/API/CLI 字段冻结；生成正式库表行数与外部作业盘点；发现活动或不确定作业时停止迁移设计中的破坏性部分。

验证：临时副本执行 schema 设计验证；对两个不同 Workflow fixture 验证同一模型不需要材料专属字段。本步可独立完成。

### 步骤 2：实施 schema v5 和精简 Run/Spec 状态机

实施：把 Confirmed Envelope、Working Plan、当前 Stage 和 envelope revision 纳入 Run；重建简化后的 Action/Job 关联；新增 `pending_items`；扩展 Experience 适用范围和来源；退役 Contract/Policy/Context/Review/Promotion 的运行依赖。保留 Research Plan 与 Workflow 作为独立科研对象。

完成标准：普通 Working Plan 更新无需授权和版本表；越界更新必须产生 researcher pending item；Action/Job/Artifact 的 Stage 外键关系完整；迁移可重复且不丢旧数据。

验证：fresh DB、正式库副本、非空旧控制表 fixture、重复启动、外键和 `integrity_check`；测试 envelope 内/外修改和中断恢复。本步是后续公共依赖。

### 步骤 3：重写 Codex Skill/CLI 的自主执行协议

实施：CLI 支持 draft/show/confirm/update-working-plan/escalate/resume；Skill 规定 Codex 先查询经验并生成 Research Plan + Task Spec，研究者确认 Envelope 一次后自主执行。移除逐 Action 提案/授权和 context hash drift 流程。

只有以下情况暂停：科学路线或关键参数改变、资源/并发上限扩大、Task 写根扩大、破坏性操作、需要研究者接受结论。普通工程错误由 Codex 自主调查修复。

完成标准：全新 Codex 会话只依靠 doctor/context 即可恢复；边界内修改 Working Plan 并继续；越界时准确生成一条待沟通事项，确认后恢复。

验证：Skill/CLI 契约测试覆盖首次确认、普通改计划、科学越界、资源越界、拒绝、会话中断和恢复。本步在步骤 2 后可独立验收。

### 步骤 4：把远程安全收敛到可靠执行流水线

实施：保留材料无关 capability，但把执行固化为 prepare → preflight → upload → verify upload → submit once → idempotent register → post-submit sanity → reconcile/monitor。Action 可在 Task 根内执行通用目录/文件操作；每个 Job 必须给出独立 `remote_workdir`，由 Codex 根据 Stage 设计而非后端套模板。

完成标准：上传错目录、缺文件、脚本错误、重复请求、提交响应丢失、秒退/假完成、会话中断均不会造成盲目重提或错误成功；一个 Stage 可安全管理多个不同目录下的 Job。

验证：模拟 SSH/LSF 故障矩阵、重复/超时/部分上传 fixture、跨 Stage 多 Job fixture；静态测试禁止材料名、固定 Task/Step 和软件专属路径进入执行器。本步不依赖 Web。

### 步骤 5：取消目录模板并重做 Web 观察读模型

实施：Task 创建只建立/登记 Task 根，不再自动建立 Workflow Stage 目录；文件 API 在 Task 根内支持真实树浏览。Web 按 Stage 聚合 Action/Job/Evidence，但文件页展示 Codex 实际创建的树。Agent Run 隐藏 Contract/Policy/Context/manifest 授权术语；待沟通页按项目、任务、状态和 audience 筛选；作业页不提供提交/取消/对账按钮。

完成标准：两个结构完全不同的复杂任务均能正确展示；物理目录不决定 Workflow 关系，数据库记录也不强制目录层级；浏览 Web 不产生远程副作用。

验证：API 路径逃逸回归、旧任务目录兼容、空/深层/中文目录树、Stage 聚合和只读请求 E2E。本步依赖步骤 2，可与步骤 3/4 的后半段并行。

### 步骤 6：证据、待沟通和经验形成闭环

实施：Codex 下载/处理/绘图后登记 Artifact 和必要的 Evidence Check；无法自主判定或越界时生成 Pending Item；验证成功或确认失败原因后沉淀带适用范围的 Experience。执行前自动检索同软件栈、同超算和相关任务经验。

完成标准：证据可以从项目/任务/Stage/Action/Job 追溯到实际文件；researcher pending item 只包含真正需要研究者决定的事项；经验不会仅凭调度器 DONE 自动确认。

验证：证据文件存在性、来源链、候选/确认经验、经验检索适用范围、失败任务和科学结论边界测试。本步依赖步骤 2～4，Web 展示依赖步骤 5。

### 步骤 7：正式启用与真实任务就绪验收

实施：运行全套测试和两个异构 Workflow 演练；重新构建生产 Web；停服务、备份、迁移正式库到 v5并执行 doctor/context。随后在 Codex 对话中为“CaCrO3 非磁 QE → Wannier90 → 自发磁性 One-shot DMFT”生成最终 Research Plan + Task Spec，展示 Envelope 和资源摘要，等待一次确认后即可进入真实任务，不再改产品代码。

完成标准：测试、typecheck、lint、build、API/E2E、迁移完整性和恢复演练通过；正式库无未解释 drift；Web 可旁路看到 Run/Stage/Action/Job/Evidence；真实 pilot 的唯一剩余门是研究者对最终 Task Spec 和实际 HPC 资源的一次确认。

验证：生产启动和硬刷新验收；`workbench doctor/context`；只读连接、Task 根创建能力和调度器查询检查。真实提交仍以最终 Task Spec 确认为界，不用 smoke 代替科学作业验收。

## 6. 兼容性、回归和回退风险

- **正式 v4 数据**：迁移前一致性备份；非空旧控制表必须转换为历史或阻断迁移，不能直接丢弃。
- **旧 Task 目录**：不移动、不重命名、不重新整理；取消模板只影响新 Task，旧目录继续按真实树浏览。
- **Workflow 过度膨胀**：只允许核心科学阶段进入 Workflow；工程操作始终记录为 Stage 下 Action。
- **Codex 自主性越界**：执行器继续强制 Task 写根、只读根、资源上限和 capability 范围；自主修改 Working Plan 不能改变 Confirmed Envelope。
- **提交重复**：Job 提交使用稳定幂等身份；响应不确定只能 reconcile，不能 retry submit。
- **缓存冒充实时状态**：Web 显示最后观察时间；只有 Codex 主动对账才更新外部状态。
- **科学错误自动推进**：工程依赖可自动推进，科学关口必须满足 Task Spec 中的证据条件；无法判断时进入待沟通。
- **回退**：先停止新 Action并对账活动/不确定 Job，再停服务；代码回退到 v4 兼容版本，数据库从 v5 前备份恢复。远程文件和作业不自动删除或取消。

## 7. 需要研究者确认的关键边界

确认本计划即视为采用以下推荐默认值；如有异议应在实施前指出：

1. **Task Spec 唯一事实源**：保存在数据库，CLI/Web 渲染，不再维护独立 Contract/Policy 文件。
2. **自主取消范围**：Codex 可以取消由当前 Run 创建、已确认错误或已被替代且不含唯一结果的 Job；取消其他 Run/用户已有 Job 必须重新沟通。
3. **自主重试范围**：Codex 可在原科学路线、Task 写根和资源上限内修复并重试；扩大资源、改变关键科学输入或改换路线必须沟通。
4. **目录自主权**：Workbench 不规定 Task 内部目录结构，只强制规范化后的 Task 根写边界；Codex 对自己创建的目录和文件负责组织与记录。

## 8. 可独立完成和验证的阶段

| 阶段 | 包含步骤 | 是否可独立验收 | 依赖 |
|---|---:|---|---|
| A：模型与迁移 | 1～2 | 是；临时库完成全部验证 | 无远程依赖 |
| B：Codex 自主协议 | 3 | 是；Skill/CLI 模拟执行 | 依赖 A |
| C：远程可靠流水线 | 4 | 是；模拟 SSH/LSF，不触碰正式 HPC | 依赖 A/B 契约 |
| D：Web 与真实文件树 | 5 | 是；可与 C 并行 | 依赖 A |
| E：证据/经验闭环 | 6 | 部分独立，端到端依赖 B/C/D | 依赖 2～5 |
| F：正式启用与 pilot 就绪 | 7 | 最终集成门 | 依赖全部前序及最终 Task Spec 确认 |

确认后按 `A → B →（C ∥ D）→ E → F` 实施。计划完成的定义不是“页面和表已经存在”，而是 Codex 能在一次边界确认后自主完成复杂工作流，并且可直接进入真实 HPC 科研任务。
