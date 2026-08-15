# Agent 科研环境首个可用版本实施计划

> 状态：V1 已实施；真实 SSH/SFTP/LSF pilot 已于 2026-08-15 完成验收。
> 日期：2026-08-13

## 1. 结论与范围调整

产品方向成立：Workbench 应从“工作流管理器”演进为“Agent 可操作、研究者可审阅的计算科研环境”。但原六阶段更适合作为能力地图，不适合作为交付顺序：它把真实 SSH/LSF 放得过晚，也把证据、远程状态和验收拆成了长期无法端到端验证的横向层。

本计划改为四个可验收里程碑、七个实施步骤：

```text
M1 上下文内核与安全边界（步骤 1-3）
                 ↓
M2 人类评价闭环（步骤 4）  ──────┐
                 ↓               │ 可与 SSH 只读开发并行
M3 真实 SSH/LSF 纵向切片（步骤 5-6）
                 ↓
M4 发布与恢复验收（步骤 7）
```

研究方案采用“双层语义”：

- 项目中的 Markdown 方案始终可以修正；它不是不可更改的真理。
- 每次研究运行保存自己实际采用的方案、合同、工作流和策略版本及哈希。
- 源方案被修改后，运行显示 drift（版本漂移），但不会静默换版本；研究者可通过评价决定“采用修订版并说明原因”。旧版本继续可追溯。

真实 SSH 提前到 M3。开发验收不以 Fake LSF 为准；默认测试仍使用临时数据库和纯函数/协议夹具，另设显式授权的真实 SSH/LSF 集成门。

## 2. 当前实现与受影响范围

### What already exists

| 现有能力 | 当前实现 | 本计划处理 |
|---|---|---|
| Project/Task | `projects`、`tasks` 与项目 `working_dir` | 复用；为 Task 增加稳定、不可随改名漂移的相对根目录 |
| 任务工作流 | `tasks.workflow_snapshot` 已在创建时冻结并可独立编辑 | 直接作为运行上下文的工作流来源，再按运行保存采用版本 |
| 研究方案 | Markdown 位于项目目录，`research_plans` 只存元数据 | 保持源文件可编辑；新增运行采用版本，不复制一套方案 CRUD |
| HPC 配置 | `projects.hpc_config` 保存 host/user/remotePath 等 JSON | 向后兼容读取；作为 SSH profile 初始来源，由 policy 再收紧 |
| 文件访问 | 项目级浏览、读文本、建目录 | 抽取统一路径边界；修复同名前缀目录误判后再供 Agent 能力复用 |
| 测试隔离 | `WORKBENCH_DB_PATH`、随机端口、临时项目目录 | 复用并拆分测试文件；真实 SSH 测试不进入默认 `npm test` |
| 服务结构 | `createApp()`、Express 路由、统一前端 API client | 复用；增加 Agent/Run/Review/Remote 路由与 CLI |

已确认的阻塞点：

1. `server/routes/files.ts` 使用字符串 `startsWith` 判断路径，`C:\root2` 可被误认为属于 `C:\root`；这与 Agent 边界冲突。
2. 任务目录由当前任务名即时推导；任务改名不移动目录，且同名/清洗后同名任务可能共享目录，无法形成稳定授权根。
3. 服务未显式绑定回环地址且启用宽松 CORS；加入 SSH 写能力前必须收紧本地 HTTP 暴露面。
4. 当前没有 run identity、追加式事件、策略版本、评价决定、远程 job 或 CLI。
5. `npm run build` 不检查后端 TypeScript；新增远程执行代码前必须补上后端类型检查门。
6. 研究方案的 `active` 状态不等于某次运行采用的不可变版本，且方案编辑会覆盖文件内容。

主要受影响模块：

- 数据层：`server/db.ts`，新增兼容迁移、索引和备份；`tasks` 增加任务根字段。
- 领域服务：新增 task-root/path boundary、policy merge、run context、event ledger、review、SSH/LSF adapter。
- HTTP：`server/index.ts` 与新的 Agent/Run/Review/Remote 路由；现有 files/tasks/projects 路由做必要的边界接入。
- CLI：新增本地 `workbench` 入口，只调用 HTTP API，不直接读 SQLite。
- 前端契约：`src/types/index.ts`、`src/api/client.ts`、路由和侧边栏。
- UI：最小 Agent 运行/评价页面；现有 HPC 复制粘贴能力暂不删除。
- 测试与文档：拆分 `tests/`，更新 `README.md`、`TESTING.md`、`docs/` 与 `doc/`。

## 3. 本次目标、非目标与验收条件

### 目标

交付一个可真实验证的首个纵向版本：研究者可启动研究运行并采用当前方案/合同/工作流/策略版本；Agent 可通过稳定 CLI 获取上下文、提交评价请求；系统可在显式授权的真实 SSH/LSF 环境中完成“检查能力 → 提交无害最小作业 → 查询/对账 → 读取日志”，全过程写入账本。

### NOT in scope

- 不执行真实 DFT/DMFT 科学计算；本次远程作业只做 1 核、短墙钟的无害 smoke job。
- 不实现 QE/Wannier90/TRIQS/WIEN2k 科学验收器；等真实作业账本稳定后按软件栈逐个接入。
- 不实现持续自主 `agent-cycle`、Codex automation 或多 Agent 调度；先证明单次动作可恢复、可对账。
- 不实现 MCP；CLI + HTTP 契约稳定后再封装。
- 不实现通用工作流引擎、队列、Redis、微服务或向量数据库。
- 不把现有 `experiences` 自动视为“已验证知识”；可信知识状态留到后续里程碑。
- 不提供任意远程 shell；只开放固定、可审计的 inspect/upload/submit/status/log/reconcile 操作。
- 不自动修改 U/J、双计数、相关子空间或其他核心物理模型。

### 验收条件

1. 研究方案可继续编辑；运行能显示当前文件哈希与已采用哈希，采用修订版会生成新上下文版本和决定事件，旧版本仍可读取。
2. `workbench context --task <id>` 输出带 `schemaVersion` 的稳定 JSON，包含项目/任务、稳定任务根、采用的方案/合同/工作流/策略、运行、能力、作业、未决评价和事件游标；缺失项以明确 blocker 返回，不猜测。
3. system/project/task 三层策略按明确的“只能收紧”规则合并；越权主机、路径、资源或操作在执行前被拒绝并记事件。
4. run events 只能追加；评价决定绑定请求创建时的 run/context version，过期请求不能误批准新版本。
5. 默认服务只监听回环地址；无授权 HTTP 请求不能把 SSH/LSF 能力暴露到局域网。
6. 在用户指定的真实 pilot 主机上通过只读 capability probe；经单独确认后提交一个唯一 token 的最小 LSF 作业，持久化 job ID，并由 `bjobs`/`bhist`/`bpeek` 对账。
7. SSH 在提交结果不确定时不自动重提：先按唯一 token 对账；仍无法确定则创建人工评价请求。
8. 所有默认自动化测试只使用临时数据库/目录；真实 SSH 测试必须由独立命令和显式环境开关启用。
9. 旧项目、任务、工作流、研究方案和 HPC 复制粘贴流程保持可用；迁移不删除旧数据，并生成一次性数据库备份。

## 4. 关键数据流与数据模型

### 方案修订与运行上下文

```text
研究方案.md（始终可编辑）       .workbench/contracts/<plan-id>.yaml
          │ 读取、校验、sha256                 │
          └──────────────┬─────────────────────┘
                         ▼
              start run / adopt revision
                         │ 原子写 DB
                         ▼
              run_context_versions（不可变）
               ├─ plan content + hash
               ├─ contract content + hash
               ├─ workflow snapshot + hash
               └─ effective policy + hash
                         │
                         ▼
              research_runs.current_context_version
                         │
          源文件后来改变 ─┴─> context 返回 drift，不静默采用
```

### Agent 与远程执行

```text
workbench CLI
    │ HTTP，仅调用公开 Agent API
    ▼
context service ──> task/project/run/context/policy/reviews/jobs/events
    │
    ├─ read-only context ───────────────────────────────> JSON
    │
    └─ remote action
          │ policy + task root + idempotency 检查
          ▼
       SSH adapter（系统 OpenSSH，无密码/私钥存储、无 agent forwarding）
          ▼
       固定 LSF operation builder
          ▼
       bsub / bjobs / bhist / bpeek
          │
          └─> remote_jobs + append-only run_events + review_requests
```

建议新增/变更的数据结构：

| 实体 | 核心职责 |
|---|---|
| `tasks.task_root_rel` | 相对项目目录的稳定任务根；新任务创建后不随显示名修改 |
| `agent_policies` | system/project/task 作用域、版本、状态、JSON、哈希 |
| `research_runs` | task、状态、当前上下文版本、开始/结束时间 |
| `run_context_versions` | 每次采用的方案、合同、工作流、有效策略快照与哈希 |
| `run_events` | 追加式 fact/inference/decision/conclusion 事件；每个动作可带幂等键 |
| `review_requests` | 暂停原因、选项、建议、资源估算、绑定的上下文版本 |
| `review_decisions` | 研究者决定；一条请求只允许一个最终决定，修订需新请求 |
| `remote_jobs` | action token、LSF job ID、主机、远程路径、状态与最近对账时间 |

所有新表使用外键和索引；有 run 的 Task/Project 默认禁止物理删除，只允许归档。重要快照先存数据库，后续 artifact/evidence 里程碑再导出到任务目录，避免本次同时引入数据库与文件双写一致性问题。

## 5. 实施步骤（按依赖顺序）

### 步骤 1：安全基线、任务根与测试门

实施：抽取统一规范路径包含检查；替换 files 路由的字符串前缀判断；为 Task 增加 `task_root_rel`，新任务创建时生成唯一稳定目录，改名不改根；旧任务只在候选目录唯一且存在时自动回填，否则返回 `task_root_unresolved`；默认监听 `127.0.0.1` 并限制 CORS；补后端 TypeScript 检查与可运行全部 `tests/*.test.ts` 的入口。

完成标准：路径 `..`、绝对路径、同名前缀、大小写/分隔符和符号链接策略均有回归测试；任务改名后根不变；旧库迁移可重复执行且有备份；`npm test`、lint、前后端类型检查通过。

验证：临时 SQLite + 临时目录集成测试；不读写真实 `data/` 或 `repository/`；验证生产服务只在回环地址可达。

### 步骤 2：运行、上下文版本、策略与账本数据层

实施：新增上述七张表/字段、约束与索引；定义有限状态和分类枚举；实现 SHA-256、typed policy 校验和三层安全合并；研究运行启动时一次事务写入 run、context version 和首个事件；方案修订采用新 version，不更新旧快照。

完成标准：同一输入生成稳定哈希；策略下层不能扩大上层主机/路径/资源边界；events 无更新/删除 API；过期 context version 不能被评价决定误用；run 关联数据阻止物理删除。

验证：空库、现役 schema 仿真库、重复启动、迁移中断、无效 JSON/YAML、并发创建/幂等键冲突测试；迁移失败必须保留原库并给出可操作错误。

### 步骤 3：Context/Run/Review API 与 CLI

实施：增加 run start/get/adopt-revision、event append/list、policy version/activate、review create/decide 和聚合 context API；CLI 只通过 HTTP 调用，支持 `context --task` 与机器可读错误/退出码；使用 `schemaVersion` 固定公共契约，并允许用环境变量覆盖本地服务 URL。

完成标准：Agent 无需遍历页面、文件树或 SQLite 即可获取完整上下文；无活动 run、方案缺失、合同无效、任务根未解析等均返回 blocker；重复请求不重复写事件/创建 run。

验证：API 集成测试覆盖 2xx/4xx/409、CLI stdout/stderr 与退出码、服务离线、旧/新 schemaVersion、空结果和 10MB 上限；用 npm `bin`/脚本验证 Windows 本地调用方式。

### 步骤 4：最小 Agent 运行与评价界面

实施：新增 Agent 运行/评价入口，展示当前目标、采用版本与 drift、最近事件、未决请求；支持启动 run、采用方案修订、批准继续、补充计算、驳回、终止；每个决定显示其绑定的方案/合同哈希。保留现有 HPC 页面，不在本步重做完整视觉系统。

完成标准：研究者能从 UI 完成“选择任务与方案 → 启动 run → 查看请求 → 作出绑定版本的决定”；API 失败、过期请求和目录未解析均显示可恢复错误，不静默失败。

验证：组件/服务端渲染测试加一条浏览器级主流程测试；覆盖双击决定、页面停留后数据过期、无请求、API 500 和慢请求状态。

### 步骤 5：真实 SSH 只读能力探测

实施：基于系统 OpenSSH 实现固定 inspect 操作；本地用 `execFile`/`spawn` 参数数组，禁止 `shell: true`；使用用户现有 SSH config/ssh-agent，不存密码或私钥，不启用 agent forwarding；强制主机 allow-list、host key 校验、BatchMode、超时、输出大小限制；检查远程根、`bsub/bjobs/bhist/bpeek/lsid` 和版本。

完成标准：真实 pilot 主机能返回结构化 capability report；未知 host key、认证失败、命令缺失、超时和远程根越界都有清晰结果及事件；只读探测不会创建目录或提交作业。

验证：纯函数测试覆盖参数验证和输出解析；独立 `test:ssh:inspect` 在显式环境变量下连接真实主机。真实探测是本步验收依据，不用 Fake LSF 替代。

### 步骤 6：最小 LSF 提交、记录与对账

实施：上传工作台生成的固定 smoke script 到 policy 允许的远程任务根；以唯一 action token/job name 提交 1 核短作业；持久化 job ID、原始提交输出和状态；依次通过 `bjobs`、`bhist`、`bpeek`/日志对账；提交响应丢失时先按 token 查找，无法确认则标记 `submission_uncertain` 并请求人工评价，绝不自动重提。

完成标准：真实作业从 submit 走到终态，重启服务后仍能恢复；相同幂等键不会产生第二个自动提交；所有远程路径留在任务根；日志和资源信息进入账本。

验证：独立 `test:ssh:lsf-smoke`，需要显式 `WORKBENCH_ALLOW_REMOTE_SMOKE=1`、pilot host/root/queue；固定资源上限；测试创建物保留清单，未经单独确认不批量删除。

### 步骤 7：回归、恢复演练与文档收口

实施：完成迁移/路径/policy/API/CLI/UI/真实 SSH 测试矩阵；用临时副本演练升级和回退；更新架构、接口、数据字典、测试与运行手册；构建单文件前端并验证 `npm start`；记录真实 pilot 的软件/LSF 差异，作为后续 adapter 兼容依据。

完成标准：默认检查全部通过；真实 inspect 和 smoke 验收有事件/作业证据；停止服务后可从自动备份恢复旧库；旧 UI 主流程回归通过；用户可按文档重现 CLI 和 SSH 测试。

验证：`npm test`、`npm run lint`、`npm run build`、后端 typecheck、关键 UI E2E、`test:ssh:inspect`、经授权的 `test:ssh:lsf-smoke`。

## 6. 测试覆盖图与主要失效模式

```text
CODE PATHS                                      USER/AGENT FLOWS
[新增] DB migration                             [新增] 启动研究运行
  ├─ fresh / existing / repeat                    ├─ 正常采用当前版本
  └─ failure -> backup + clear startup error       └─ 缺方案/合同/任务根 -> blocker
[新增] context aggregation                      [新增] 修改研究方案
  ├─ complete context                             ├─ 显示 drift
  ├─ missing/invalid dependency                    └─ 评价后采用新版本，旧版可读
  └─ schema version mismatch                    [新增] 评价请求
[新增] policy authorization                       ├─ 正常决定
  ├─ restrictive merge                            └─ stale/double decision -> 409
  └─ host/path/resource denial                  [新增] 真实 SSH/LSF
[新增] SSH/LSF adapter                            ├─ inspect 成功/认证失败/host key
  ├─ inspect / submit / status / logs              ├─ submit -> job id -> terminal
  ├─ timeout / malformed output                    └─ uncertain -> reconcile/review
  └─ uncertain submission -> no auto-retry
```

| 失效模式 | 测试 | 处理 | 用户可见性 |
|---|---|---|---|
| 旧任务无法确定真实目录 | 临时目录迁移用例 | fail closed，要求一次性解析 | context/UI 明确 blocker |
| 方案编辑与 run 读取竞态 | 哈希漂移/采用事务测试 | 只采用读取并哈希后的完整版本 | 显示 adopted/current hash |
| 下层 policy 扩权 | 属性级合并测试 | 拒绝激活并记事件 | 返回具体冲突字段 |
| 评价页批准了旧快照 | stale version 集成测试 | 409，要求刷新/新请求 | 明确“请求已过期” |
| SSH 等待密码导致挂起 | 真实失败探测 | BatchMode + timeout | 认证失败而非无限等待 |
| host key 改变 | inspect 失败用例 | 不绕过校验 | 显示指纹校验错误 |
| `bsub` 成功但连接断开 | uncertain 提交用例 | token 对账；不自动重提 | 创建评价请求 |
| `bjobs` 已无终态记录 | parser/integration | fallback 到 `bhist` | 显示最终状态或未知原因 |
| CLI 服务不可达/响应版本不符 | CLI 测试 | 非零退出码、stderr JSON | 可脚本化处理 |

计划覆盖后没有“无测试、无错误处理且静默”的已知关键路径；实现评审时若新增此类路径，视为阻断项。

## 7. 兼容性、回归与回退风险

- 数据库：新表和新列为增量迁移；首次 agent-v1 迁移前用 SQLite 一致性备份。旧代码会忽略新表，但有 run 后的删除保护会继续生效；完整降级需停止服务并恢复备份。
- 任务目录：新任务获得稳定根；旧任务不做猜测性移动或重命名。无法唯一回填的任务只阻止 Agent 操作，不影响现有页面查看。
- 研究方案：现有 CRUD/状态保持；运行版本是新增层。编辑源文件不会改写历史 run context。
- 工作流：继续以 `tasks.workflow_snapshot` 为运行路线图；不重置模板、不删除历史 step_progress 或科研目录。
- HPC：现有 `hpc_config` 兼容读取，复制粘贴向导保留。新 SSH adapter 不执行其中任意 module 文本，除非以后成为批准动作的一部分。
- 网络：默认改为回环监听会影响依赖局域网访问的未知用法，这是预期的安全收紧；如确需 LAN，应另加显式 host/token 配置，而不是恢复宽松默认。
- 远程：真实集成受集群版本、登录 shell、LSF 本地定制和历史保留期影响；先做 capability report，再锁定 parser 和兼容分支。
- 回退：不删除真实远程作业或输出；代码回退前停止新的 agent actions，对账所有 `submission_uncertain`，再按备份说明恢复数据库。

## 8. 独立完成与并行验证

| 里程碑/步骤 | 可独立交付 | 依赖 |
|---|---|---|
| M1：步骤 1-3 | 是；可独立验收 context、策略、版本和 CLI，不需要 SSH | 无外部集群依赖 |
| 步骤 4 UI | 是；M1 API 契约固定后可单独工作树开发 | 步骤 2-3 |
| 步骤 5 SSH inspect | 是；只读且可先对一个 pilot 主机验证 | 步骤 1 的安全基线、步骤 2 policy |
| 步骤 6 LSF smoke | 是；形成首个真实远程闭环 | 步骤 5、用户明确授权 |
| 步骤 7 | 否；是所有线路的合并发布门 | 步骤 1-6 |

并行 lanes：

```text
Lane A: 步骤 1 → 2 → 3 → 4      （DB/API/前端评价闭环）
Lane B:          步骤 2 → 5 → 6 （policy 固定后做真实 SSH/LSF）
Lane C:                    步骤 7（合并后回归与文档）
```

步骤 4 与步骤 5 可并行；两者应避免同时修改 `src/types/index.ts`/`src/api/client.ts`，先由步骤 3 固定契约。步骤 6 不应与 policy/schema 继续变更并行。

## 9. 需要研究者决定的关键问题

1. **首个版本范围**：建议确认本计划覆盖到真实 LSF smoke（M1-M3），而不是仍只做原“第一阶段”。这能尽早暴露 OpenSSH、登录 shell 和集群定制问题。
2. **本地服务安全**：建议接受默认仅监听 `127.0.0.1`、限制 CORS；如果你确实需要局域网访问，需要同时决定认证 token 方案。
3. **删除语义**：建议有 research run 的 Task/Project 禁止物理删除、只允许归档；否则账本与证据链会失去归属。
4. **策略继承**：建议 system 是硬上限，project/task 只能收紧；扩权必须形成显式、可审阅的新上层策略版本。
5. **合同格式与位置**：建议使用 `.workbench/contracts/<research-plan-id>.yaml`，引入单一成熟 `yaml` 依赖进行解析；run 保存采用时的原文与哈希。
6. **真实 pilot 参数**（步骤 5 前提供即可）：OpenSSH host alias、允许的远程测试根、LSF queue（若必填）、最大 1 核/1 分钟 smoke 是否获准，以及 host key 首次确认方式。任何科学软件命令都不在本次授权内。

## 10. 外部实现依据

- Node.js 官方文档建议用 `execFile`/`spawn` 直接启动程序，并明确警告不要把未清洗输入交给 shell：<https://nodejs.org/api/child_process.html>
- OpenSSH 手册说明远程命令参数会被拼接后交给远端，并强调 host key 检查；同时指出 agent forwarding 有额外风险：<https://man.openbsd.org/ssh.1>、<https://man.openbsd.org/ssh_config.5>
- IBM LSF 官方文档定义了 `bsub`、`bjobs`、`bhist`、`bpeek` 的职责，适合作为 submit/status/history/live-log 的最小适配面：<https://www.ibm.com/docs/en/spectrum-lsf/10.1.0?topic=started-quick-reference>
- npm 的 `bin` 字段可在 Windows 生成 `.cmd` 入口，用于提供稳定的本地 `workbench` 命令：<https://docs.npmjs.com/cli/configuring-npm/package-json/#bin>

## 11. 实施状态

M1/M2 的本地合同、策略、运行、账本、评价、CLI 与 UI 已通过隔离测试；M3 的系统 OpenSSH/LSF adapter 已在上海超算魔方-III完成真实闭环验收。

### 2026-08-15 真实 pilot 验收记录

- OpenSSH alias、登录用户和批准远程测试根均由研究者本机配置提供并已脱敏。alias 使用用户现有 `ssh-agent` 中的专用 ED25519 key，Workbench 未保存密码、私钥或 agent forwarding 配置。
- capability inspect：通过。规范远程根与批准根一致；`lsid`、`bsub`、`bjobs`、`bhist`、`bpeek`、`bkill` 均可用；调度器为 `IBM Spectrum LSF Standard 10.1`，adapter 可正常解析站点包装器返回的提交响应。
- SFTP 往返：通过。小型测试文件上传后下载，源文件和下载文件 SHA-256 一致；默认禁止覆盖生效。
- 固定 smoke：通过。批准队列、1 核、墙钟上限 1 分钟；Workbench remote job 对应唯一 LSF job，终态 `DONE`，作业输出包含匹配的非认证 action token。具体用户、目录、job ID、节点和 token 不写入版本库。
- 幂等与恢复：相同幂等键重复提交返回同一 remote job/LSF job；服务重启后恢复同一 run、context version 2 和唯一 job，reconcile 再次从 LSF 得到 `DONE`，未产生第二个作业。
- 证据保留：远程测试文件和 `.workbench-smoke/<token>/` 未自动删除；本地使用隔离数据库和根锚定的忽略目录，未触碰正式 `data/workbench.db`、`repository/` 或其他远程项目目录。
- pilot 暴露并修复了三类兼容问题：system policy 的父级合并、同作用域 policy 新版本误作父级、Spectrum LSF banner 解析及真实超时错误分类。对应回归测试已加入。
- 发布门：提交前加固后 `npm test` 17 项中 16 通过、1 项因 Windows 符号链接权限跳过；`npm run typecheck`、`npm run lint`（0 error，10 个既有 warning）、`npm run build`、2 项 UI E2E、真实 `test:ssh:inspect` 和获准的 `test:ssh:lsf-smoke` 均通过。
