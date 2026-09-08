# 远程计算设备：连接、传输与 Agent 协作

这份指南面向第一次把 Workbench 连接到超算的研究者。**推荐做法不是自己逐项配置，而是把必要信息告诉 Codex，让 Agent 代你检查和配置。** 当前公开版本的参考路径是本机 OpenSSH/SFTP + IBM LSF；Slurm 和 PBS 尚未正式支持，配置时会被拒绝，不能只把调度器名称改掉就使用。

Workbench 不保存密码、私钥或一次性验证码。Web 只保存连接元数据、Task 目录映射并展示已经记录的状态；真正的连接、传输、提交、监控和对账由当前 Codex 对话中的 Agent 通过 `workbench` CLI 完成。

## 最简单的方式：让 Agent 配置

你只需要准备这些信息：

- 超算登录地址，或计算中心给你的 SSH 登录命令；
- 用户名，以及使用密钥、密码、MFA 还是跳板机；
- 你在超算上的用户根和希望使用的项目目录；
- Workbench Project 和 Task；
- 调度器类型。当前正式支持的是 IBM LSF。

不要在对话里粘贴密码或私钥内容。然后把下面这段话发给 Codex：

```text
请帮我为 Workbench 配置这台超算：
- 登录地址或现有 SSH 命令：<填写>
- 用户名：<填写>
- 认证方式：<密钥/密码/MFA/跳板机>
- 超算用户根：<填写>
- 远程项目目录：<填写>
- Workbench Project/Task：<填写名称或 ID>
- 调度器：<例如 LSF>

请先检查本机现有 OpenSSH 和 ~/.ssh/config，不要覆盖已有配置，也不要把秘密写入
项目或 Workbench。若需要新增 SSH alias，请先展示拟修改内容；需要接受 host key、
输入密码或完成 MFA 时停下来让我操作。连接验证成功后，用 workbench hpc configure
登记 profile 和 Task 映射，再草拟包含远程能力与资源上限的 Task Spec 给我确认。
未经我确认 Envelope，不要上传、提交或取消作业。
```

Agent 可以完成绝大多数工作：发现已有 SSH 配置、生成安全的 alias、在获得文件权限后修改用户 SSH 配置、做只读连接检查、通过 `workbench hpc configure` 登记设备与 Task 映射，并继续准备 Task Spec。你通常只需要参与三类关口：

1. 核对首次连接的主机指纹；
2. 输入密码、完成 MFA 或解锁本机密钥；
3. 审阅并确认最终 Envelope、资源上限和写入边界。

如果你已经能在终端执行 `ssh <别名>` 登录，配置会更简单：直接把别名、用户根、项目根和 Task ID 告诉 Agent 即可。下面的内容主要用于理解 Agent 在做什么，以及连接失败时排障。

## 先理解四层边界

| 层级 | 示例 | 权限 |
| --- | --- | --- |
| 本机 Codex 项目 | Workbench 仓库与研究 `working_dir` | 由 Codex 项目文件夹和本机权限决定 |
| 超算用户根 | `/public/home/username` | 只读检查和下载的最大边界 |
| 超算项目根 | `/public/home/username/project-a` | 当前 Project 的远程只读边界 |
| 超算 Task 根 | `/public/home/username/project-a/task-001` | 当前 Task 唯一允许写入、上传和运行作业的远程根 |

远程项目根必须是用户根的子目录，Task 根必须是项目根下的单层直属目录。用户根和项目根需要预先存在，Agent 只会按已确认能力创建 Task 根。不同 Task 不能共享同一个远程 Task 根。保存这些路径只是登记事实，不会自动授权 Agent 执行。

## 1. 需要时手动检查 OpenSSH

先在 PowerShell 中确认系统能找到 OpenSSH：

```powershell
Get-Command ssh,sftp
```

正常情况下可以让 Agent 检查或生成配置。需要手动排障时，在你自己的 `C:\Users\<用户名>\.ssh\config` 中检查类似内容：

```sshconfig
Host my-lsf
  HostName login.example.edu
  User your_username
  IdentityFile C:/Users/<用户名>/.ssh/id_ed25519_hpc
  IdentitiesOnly yes
```

如果学校要求跳板机，可在自己的 SSH 配置中增加 `ProxyJump`。不要把密码、私钥内容、Cookie、令牌或完整的私有主机信息写进仓库、Issue、Research Plan 或 Workbench 的备注字段。

第一次连接应由你在普通终端中亲自完成：

```powershell
ssh my-lsf
```

核对学校或计算中心公布的 host-key 指纹，再决定是否接受；完成登录后退出。Workbench 使用严格 host-key 检查和非交互认证，不会替你自动接受未知主机，也不会弹窗索取密码。若超算使用密码、MFA 或短期证书，请先按计算中心的办法在系统 SSH/认证代理中建立可用会话。

## 2. 登记计算设备

Agent 可以用 `workbench hpc configure` 完成登记；你也可以进入 Web 的 **超算管理**，先选择 Project，然后新增连接：

- **显示名称**：便于人识别，例如“学校 LSF 集群”；
- **OpenSSH 别名**：上一步的 `Host`，例如 `my-lsf`；
- **用户只读根**：例如 `/public/home/username`；
- **远程项目根**：必须位于用户根之下，例如 `/public/home/username/project-a`；
- **调度器**：当前选择 IBM LSF；
- **说明与登录边界**：可以记录队列政策、登录节点用途等，但不要记录秘密。

这里填写的是连接和目录边界，不是账号认证。Workbench 最终调用的是本机 `ssh my-lsf` 和 `sftp my-lsf`，所以别名必须在运行 Workbench/Codex 的同一台电脑、同一用户环境中可用。

## 3. 为 Workbench Task 绑定远程目录

让 Agent 配置时，它会把 profile 与 Task 映射一起写入；手动操作时，仍在 **超算管理** 页面选择具体 Task、连接 profile，并填写一个安全的 **任务目录名**，例如 `task_2026_001`。

任务目录名只能是一层目录名，不能包含 `/`、`\\`、`..` 或换行。保存后，Workbench 会派生出完整 Task 写根：

```text
/public/home/username/project-a/task_2026_001
```

不要把已有的共享赝势目录、软件安装目录、用户根或项目根本身绑定为 Task 写根。共享输入可以从用户根或项目根读取/下载，但写入、上传、提交和取消只发生在 Task 根内。

## 4. 把远程能力写入 Task Spec 并确认

Research Plan 中先写清计算规模、软件、队列限制、输入来源、预计耗时、完成证据和异常时的研究者关口。然后让 Codex 草拟 Task Spec。需要使用哪些能力，就让 Envelope 精确列出哪些能力：

- `remote.inspect`：检查连接、目录和远端命令；
- `remote.task-root.create`：创建已绑定的 Task 根；
- `files.upload` / `files.download`：受边界约束的传输；
- `job.submit` / `job.cancel`：通过专用 Action 提交或取消 LSF 作业。

Envelope 还应绑定正确的 HPC profile，并写明单作业核数、wall-time、最大并发作业数、自动科学重试上限和保护路径。你确认精确 Envelope 哈希后，Agent 才能执行这些远程能力。

## 5. 让 Agent 检查连接并传输文件

通常无需研究者手动输入 CLI。可以在 Codex 对话中说：

```text
请按 skills/workbench-agent/SKILL.md 接管 Workbench Task <task-id>。
先运行 doctor 和紧凑 context，核对已确认 Envelope、HPC profile 与 Task binding。
如果都匹配，请检查远程连接和 LSF 能力，初始化 Task 根，并把本地 inputs 下的
输入文件传到远程 Task 根；不要覆盖已有文件。完成后告诉我记录了哪些 Event。
```

Agent 使用的受控命令包括：

```powershell
workbench remote session --task <task-id>
workbench remote init --task <task-id>
workbench remote exec --task <task-id> --scope task --access read --command "pwd; ls -la"
workbench remote upload --task <task-id> --local inputs/model.in --remote inputs/model.in
workbench remote download --task <task-id> --remote results/output.dat --local results/output.dat
```

路径均为相对于本地或远程 Task 根的路径。上传时远程父目录可以在边界内创建；下载时本地父目录可以创建。目标已存在时默认拒绝，只有明确判断旧文件可替换后才使用 `--overwrite`。普通连接、检查、建目录和传输会记录为 Event，不需要创建 Action，也不消耗科学重试额度。

从用户根或项目根下载共享的只读文件时，Agent 可以显式使用 `--scope user` 或 `--scope project`；远程写命令只能使用 `--scope task --access write`。普通远程命令通道禁止直接运行 `bsub`、`bkill`、`qsub`、`qdel`、`sbatch` 或 `scancel`，调度器状态改变必须通过可追踪的 Job Action。

## 6. 提交与长作业监控

当前版本只正式支持 LSF。提交脚本至少应声明 `#BSUB -n` 和 `#BSUB -W HH:MM`，而且不得超过已确认 Envelope 的核数、wall-time 和并发上限。

每个 `job.submit` Action 还应根据本次任务的规模、阶段、历史耗时和队列情况写明预计耗时、首次检查时间、RUN/PEND 检查间隔及依据。首次出现非终态 Job 后，Codex 会为当前对话创建或复用一个 heartbeat；所有 Job 终态且没有后续 Job 时，必须删除 heartbeat 并把关闭结果写回 Workbench。

提交响应不确定时，Agent 只能按已记录的唯一作业身份查询和对账，不能再次提交来“试试看”。科学重试必须创建新的 Action 并保留 `retry_of` 来源链。

## Web 做不了时，直接告诉 Codex Agent

Web 的职责是创建普通元数据和审阅记录，不是完整的文件管理器、终端或调度器控制台。因此，下面这些情况不一定是故障：

- 页面没有远程执行、上传、下载、提交、取消或对账按钮；
- 浏览器不能访问某个本地/远程文件；
- Web 只能看到记录，不能继续某个已确认 Run。

这时可以直接在当前 Codex 对话中说：

```text
Web 当前无法完成 <具体操作>。请按 workbench-agent 协议先恢复 Task <task-id>，
核对 confirmed Envelope 和目录边界；如果操作已在边界内，请用本地终端或
workbench remote exec/upload/download 完成并记录 Event。如果不在边界内，
请告诉我具体差异并创建 researcher 待沟通事项，不要绕过权限。
```

这是把操作交给系统中的 Agent 执行，不是绕过安全限制。以下错误不能用“让 Agent 自己干”规避：Envelope 尚未确认、HPC profile 不匹配、能力未授权、路径越界、保护路径冲突、资源超限或调度器不受支持。

## `Origin is not allowed by Workbench`

这个错误来自浏览器的来源白名单，不代表科研目录、SSH 或超算账号没有权限。当前版本的默认白名单只包含开发页面：

```text
http://localhost:5173
http://127.0.0.1:5173
```

因此，生产式页面 `http://localhost:3001` 或 `http://127.0.0.1:3001` 在某些浏览器请求中可能被服务拒绝。这个默认值目前保留不改。可选处理方式有两种：

1. 使用 `npm run dev:full`，并打开终端显示的 `5173` 地址；
2. 启动服务前显式配置所有允许的完整 Origin。

PowerShell 示例：

```powershell
$env:WORKBENCH_ALLOWED_ORIGINS="http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001"
npm start
```

该变量会**替换**默认列表，不是追加；请一次列出需要的全部来源。Origin 必须精确匹配协议、主机名和端口，不要为了省事使用任意公网来源。修改环境变量后需要重启服务。

如果 Web 因 CORS 暂时无法操作，但本地 Workbench 服务仍在运行，可以把具体任务告诉 Codex Agent。CLI 默认直接连接 `http://127.0.0.1:3001`，不受浏览器 CORS 限制；Agent 可以在已确认边界内继续读取状态和执行受控操作。若连 CLI 也显示服务不可达，则应先恢复 Workbench 服务，而不是继续远程提交。

## 常见故障判断

| 现象 | 优先检查 | 含义 |
| --- | --- | --- |
| `Origin is not allowed by Workbench` | 页面地址和 `WORKBENCH_ALLOWED_ORIGINS` | 浏览器来源配置问题，不是 HPC 权限 |
| host-key verification failed | 是否亲自核对并登记正确指纹 | Workbench 不会自动信任新主机 |
| permission denied / authentication failed | `ssh <alias>` 在同一用户环境是否可非交互使用 | SSH 账号、密钥、MFA 或认证代理问题 |
| profile/binding mismatch | 当前 Task、profile、远程根和 Envelope | 登记边界与已确认授权不一致 |
| path escape / protected path | 相对路径、符号链接和保护路径 | 操作越出 Task 或保护边界 |
| file exists | 是否真的需要覆盖 | 默认防止覆盖已有输入或结果 |
| scheduler unsupported | profile 的调度器类型 | 当前版本仅支持 LSF |
| submission uncertain | 已记录 Job 的 name/id 和对账状态 | 只能对账，禁止盲目重提 |
| Web 没有操作入口 | 改在 Codex 对话中下达具体任务 | Web 是审阅面，Agent 是执行者 |

返回[第一次使用教程](GETTING_STARTED.md)，或继续阅读[使用指南](USAGE_GUIDE.md)。
