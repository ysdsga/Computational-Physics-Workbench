# 任务与任务工作流

本文记录当前已经实现的 Task 行为。Task 表示某个 Project 下的一次具体计算运行。

## 创建任务

创建任务时必须选择一个工作流模板。后端会完成以下工作：

1. 保存任务及其来源模板 ID（`workflow_id`）。
2. 把所选模板的完整内容复制到任务自己的 `workflow_snapshot`。
3. 分配并保存稳定的 `task_root_rel`，在 `{task_root_rel}/{stageId}/` 下创建各阶段目录。

`workflow_id` 只记录任务由哪个模板创建；任务运行时使用的是 `workflow_snapshot`，不会继续实时读取全局模板。

任务显示名修改不会改变 `task_root_rel`。旧任务只在同名候选目录可唯一确认时自动回填；否则返回 `task_root_unresolved: true`，必须通过 `PUT /api/tasks/:taskId/root` 选择已有目录或明确创建新目录。任务根会规范化为项目下的非空子目录，一经解析不能通过 API 改写；系统不会自动移动、合并或重命名科研目录。

## 查看和编辑

- 任务详情页显示任务自己的工作流，并提供“编辑任务流程”入口。
- 工作流页面选择某个任务后，显示并编辑该任务自己的工作流；模板预览模式仍编辑全局模板。
- 任务工作流只保留核心科学/软件骨架：必要阶段、关键转换、检查点和完成证据。运行中的命令、重试、传输、参数扫描批次和临时诊断保存在 action/event 下。
- 任务工作流支持修改名称、描述、阶段、步骤、子步骤、命令、输入输出文件和 LSF 脚本模板；只有骨架变化时才应修改节点。
- 保存通过 `PUT /api/tasks/:taskId/workflow` 完成，只更新当前任务。

任务新增阶段后，后端会补建缺少的阶段目录。删除阶段或步骤不会删除已有目录、计算文件、步骤进度或文件关联；不再存在于工作流中的历史进度暂时不会显示。

## 与模板的关系

- 修改全局模板只影响之后创建的任务。
- 修改任务工作流不会影响全局模板或其他任务。
- 当前没有自动同步、跟随模板更新或“重置到最新模板”的行为。

## 旧任务兼容

升级前创建的任务没有保存创建时的模板版本。数据库迁移会把这些任务迁移时所对应的当前模板复制为初始任务工作流。完成复制后，它们与新任务一样独立。

## 研究运行

Task 可以启动研究运行。启动前必须满足：稳定任务根已解析、ResearchPlan 属于同一 Project、研究合同存在且绑定当前方案哈希。同一 Task 同时最多有一个 `active` 或 `waiting_review` 运行。

启动运行时，系统在一个事务中创建 `research_runs`、首个不可变 `run_context_versions` 和 `run.started` 事件。上下文版本保存当时采用的研究方案、合同、任务工作流和有效 policy 全文及哈希；之后编辑源方案不会改写历史版本，统一 Context 会报告 current/adopted 哈希和 drift。

方案修订如果保持在当前科学、权限和资源边界内，会创建新上下文版本并记录 decision event；删除已有参数边界、必需阶段、证据义务或改变科学目标同样视为扩大边界。越界时运行进入 `waiting_review`，评价请求以运行内幂等键绑定旧上下文，重试不会生成重复卡片。只有研究者在 Codex 对话中明确陈述后，CLI 才能通过专用 conclusion 接口写入结论；通用事件接口不能绕过该门禁。

每个可执行动作绑定当前 context、最近的核心 workflow step 和 immutable manifest。授权摘要同时绑定 manifest SHA-256；任何输入、脚本、资源、路径或采用上下文变化都要求重新提案和确认。成功动作可登记 artifact 和 validator evidence。Codex 可把验证过的成功/失败模式先沉淀为候选 Experience；研究者确认结论后才能提升为不可变、证据绑定的 Experience。

可执行动作使用统一 capability contract。具体材料、脚本、输入与参数由 Codex 从当前研究方案和这个 Task 的独立 workflow snapshot 生成，不由后端按材料/Task/step 硬编码匹配。新增材料或改变研究路线不需要注册专用执行器。

## 运行后的保护和远程边界

- Task 一旦被 `research_runs` 引用，DELETE 返回 `409 RUN_HISTORY_PROTECTED`；研究者仍可把 `status` 更新为 `archived`。
- 同一保护同时适用于所属 Project 和采用的 ResearchPlan，避免账本和证据失去归属。
- Agent 上传、下载使用的本地路径必须是稳定 Task 根内的相对路径；`task_root_unresolved` 会阻止启动运行和远程动作。
- 远程动作还要求 active task policy、当前运行已采用有效 policy，以及批准的 OpenSSH alias、远程根和操作。

## 相关数据

- `tasks.workflow_id`：来源模板 ID。
- `tasks.workflow_snapshot`：完整任务工作流 JSON。
- `tasks.task_root_rel`：项目工作目录内稳定任务根，也是 Agent 文件传输的本地端边界。
- `projects.hpc_config.taskBindings[]`：按 HPC profile 保存 Task 的单段远程目录名；绝对 Task 写根由 profile 的 `projectRoot` 与该相对名组合，两个 Task 不能共用同一写根。
- 远程端同时受连接元数据和有效 policy 约束：`remoteReadRoot` 是用户只读范围，`remoteProjectRoot` 是既有项目目录，`remoteWriteRoot` 是当前 Task 唯一写入/作业根。三者不一致时拒绝远程 action。
- `research_runs` / `run_context_versions`：Task 的研究执行身份和不可变采用上下文。
- `step_progress`：按 `task_id + step_id` 保存状态、笔记、自定义命令和 LSF 脚本。
- `step_files`：保存步骤关联的文件路径引用，不存储文件内容。

数据库字段和 HTTP 请求格式分别见 [`../doc/数据字典.md`](../doc/数据字典.md) 与 [`../doc/接口清单.md`](../doc/接口清单.md)。
