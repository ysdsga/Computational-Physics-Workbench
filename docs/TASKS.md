# 任务、工作流与研究运行

本文记录 schema v8 的当前行为。Task 是 Project 内一次复杂研究任务，不等于单个调度器 Job。

## Task 与目录边界

创建 Task 时，系统：

1. 保存来源模板 `workflow_id`。
2. 把完整模板复制到 `workflow_snapshot`，供该 Task 独立修订。
3. 分配稳定 `task_root_rel`，只创建 Task 根目录。

Workbench 不再按 Workflow Stage 自动创建子目录。Codex 根据当前 Working Plan 自主安排 Task 根下的目录树。Task 改名不会改变根目录；根一旦解析就不能通过 API 改写，也不会自动移动科研数据。

旧 Task 只在项目工作目录中存在唯一、可确认的同名目录时自动回填；否则保持 `task_root_unresolved: true`，通过 `PUT /api/tasks/:taskId/root` 绑定已有目录或明确创建新根。

## 核心 Workflow

Task 使用自己的 `workflow_snapshot`。全局模板只影响之后创建的 Task；修改 Task Workflow 不影响模板或其他 Task。

Workflow 只保存不可缺少的科学/软件骨架：阶段、关键转换、检查点与完成证据。试跑、连接、上传下载和排错命令只写 Event；参数扫描、科学重试和提交批次可成为里程碑 Action；它们都不应成为大量 Workflow 节点。

Research Plan 或 Workflow 可以纠错。修改前判断影响范围：若不改变 Confirmed Envelope，Codex 可修订并做最小重算；若改变科学承诺、方法/软件、资源、权限或完成证据，则先创建 researcher 待沟通事项并重新确认 Envelope。任何受影响 Artifact 都要保留并标记有效性。

## Research Run 与 Task Spec

数据层级为：

```text
Project
└─ Task
   ├─ Research Plan
   ├─ Core Workflow
   └─ Research Run
      └─ Task Spec
         ├─ Confirmed Envelope
         └─ Working Plan
            └─ Workflow Stage
               ├─ routine Event
               └─ milestone Action
                  ├─ zero / one / many Remote Jobs
                  └─ Artifacts / Evidence
```

同一 Task 最多一个开放 Run（`draft | active | waiting_researcher`）。创建 draft 时校验 Research Plan 同属一个 Project、核心阶段存在、能力有效、资源为正整数，以及远程能力使用的 HPC profile 与 Task 目录映射已登记。

Confirmed Envelope 包含：

- 核心阶段与目标关键科学承诺；
- 允许的 capability、方法和软件栈；
- HPC profile、资源/并发/自动重试上限；
- Task 相对保护路径；
- 完成证据与 researcher gates；
- Codex 在边界内编辑 Working Plan、重试和取消自己作业的自治声明。

研究者在 Codex 对话中确认精确 Envelope 一次后，Run 进入 `active`。Workbench 返回规范化 Envelope SHA-256，并只保存确认摘要、时间与可选 conversation reference。之后普通命令直接在 Task 会话内执行并记 Event；里程碑 Action 也不再单独请求研究者授权。

Working Plan 保存当前阶段、目录布局、下一批 Action 和诊断策略。Codex 可以在 Envelope 内持续更新它；每次更新记录 decision Event 和幂等键，不增加 Envelope revision。

`theoretical-research` 的每个核心阶段末尾都有“记录、反思与下一步判断”。同一阶段不限反思条数：`stay` 保持当前阶段，`loop` 回到发现所影响的最早阶段，`proceed` 才关闭阶段并前进。反思通过专用接口与 Working Plan 转移原子记录；回流会使目标及下游阶段的旧关闭状态失效。标记为 `explore` 的想法必须在后续事件中明确探索、证伪、暂缓或转后续任务，不能靠省略绕过完成判断。该循环不会自动修改 Research Plan；是否修订方案仍按现有 Plan/Envelope 纠错边界处理。

## Task 会话、Action、Job 与纠错

`remote exec/upload/download` 自动派生已确认的连接和目录边界，执行结果进入 Event 时间线，不创建 Action。Codex 可直接处理本地 Task 文件；连接、认证、超时、建目录、检查和传输失败不计入科学重试预算。调度器提交/取消不允许从通用 shell 绕过。

科学里程碑 Action 必须绑定 Run、核心 Stage、动作类型、不可变 JSON spec、SHA-256 和幂等键；可选绑定核心 step、parent Action 与 retry source。替换失败科学 Job 的重试用单链 `retry_of_action_id + retry_attempt` 表达，服务拒绝分叉和超过 Envelope 自动重试上限的 Action。旧兼容执行 capability 仍由通用执行器提供：

`local.process`、`remote.inspect`、`remote.task-root.create`、`files.upload`、`files.download`、`job.submit`、`job.cancel`。

材料名、固定 Task/step、脚本路径和科学参数来自 Research Plan/Workflow/Action spec，不进入产品分支。输入变化时创建新 Action，不改写原 spec。

Action 状态为：

```text
ready → executing
          ├─ waiting_remote → executing / waiting_codex / succeeded / failed / cancelled
          ├─ waiting_codex  → executing / waiting_researcher / succeeded / failed / cancelled
          ├─ waiting_researcher → executing / failed / cancelled
          └─ succeeded / failed / cancelled
```

一个 Action 可关联零个、一个或多个 Job。每个 Job 同时绑定 Run、Stage 和 originating Action。LSF 提交先写 `prepared` 记录，再校验远端文件哈希并调用 `bsub`；返回后立即核对 scheduler ID/name。响应不确定时保存 `submission_uncertain` 和 Codex 待处理事项，只能对账，不能重提。

首次记录非终态 Job 时创建一个 Run monitor。每个 Job 的提交规格保存 Codex 选择的预计耗时、首次检查、RUN/PEND 间隔和判断依据；`required` 表示需要创建/恢复自动化，`scheduled` 表示已确认 ACTIVE，`complete` 且仍有 `automation_ref` 表示 Job 已全部终止但自动化等待删除回执。Scheduled Task 唤醒 Codex 后执行 tick；tick 只检查到期 Job、不自动重提，并返回 create/resume/update/keep/delete 指令。heartbeat lease 与 Stop Hook 检查真实持续唤醒，`monitor close` 在删除成功后清除 reference。Web 只展示这些状态。

Artifact 有 `valid | suspect | invalid | superseded` 四种有效性。纠错时保留旧文件和来源链，通过有效性与 `superseded_by_id` 表达替代关系，然后只重算受影响范围。

## 待沟通与远程边界

- audience `codex`：运行环境、失败诊断、恢复、绘图与边界内纠错，由 Codex 主动处理。
- audience `researcher`：真正改变科学结论或 Envelope 的事项，只在 Codex 对话中解决。
- `detail.blocksRun=true` 可以只阻塞其 `stage_id`；其他 Stage 可继续。

HPC profile 登记 OpenSSH alias、用户只读根和项目根；Task binding 登记项目根下单段 Task 目录名。读取/下载可在用户根内，写入、上传、目录创建和 Job workdir 只能在 Task 写根内。Web 配置连接但不执行远程动作。

## 历史保护

被 Research Run 引用的 Project、Task 与 Research Plan 不能物理删除，只能归档。Event 没有更新/删除接口。测试必须使用注入的临时数据库和临时目录。

字段与请求格式见 [`../doc/数据字典.md`](../doc/数据字典.md) 和 [`../doc/接口清单.md`](../doc/接口清单.md)。
