# 第一次使用：从项目到受控 Research Run

这份教程面向第一次接触 Computational Physics Workbench 的研究者。完成后，你会拥有一个 Project、一个绑定工作流的 Task、一份研究方案，以及一个经过你明确确认边界的 Research Run。

Workbench 不是靠 Web 页面自动替你做物理。它把职责拆成三部分：

- 你在 **Codex 对话**中提出研究问题、审阅方案、确认执行边界和判断结论；
- Codex 根据项目内的 `AGENTS.md` 与 `skills/workbench-agent/SKILL.md` 规划和执行；
- Web Workbench 保存并展示 Project、Task、Workflow、Run、Action、Job、Evidence 和时间线。

> 第一次建议选择纯本地、规模很小、结果容易核对的任务。先跑通协作流程，再配置真实 HPC 作业。

## 0. 先分清两个“项目”和两个“任务”

| 名称 | 含义 |
| --- | --- |
| Codex 本地项目 | Codex 可以读取和修改的一组本机文件夹。本仓库目录应设为主文件夹。 |
| Workbench Project | 一个研究体系或课题，拥有独立的 `working_dir`。 |
| Codex 对话任务 | 你与 Codex 围绕一个明确结果展开的一段对话。 |
| Workbench Task | Project 内一次可独立追踪的研究任务，拥有自己的工作流快照和 Task 根目录。 |

通常，一个长期课题对应一个 Workbench Project；一个可以单独验收的科学目标对应一个 Workbench Task；一个 Codex 对话任务尽量只推进一个 Workbench Task 或一个明确阶段。

## 1. 在 Codex 中打开仓库

1. 在 Codex 的 **Projects** 中添加本仓库文件夹，并把它设为主文件夹。
2. 如果你的科研 `working_dir` 位于仓库之外，在项目设置中把该目录也添加为文件夹。仓库仍保持为主文件夹，这样 Codex 会发现项目根的 `AGENTS.md` 和配置，并能按其中的指引读取仓库内 Skills。
3. 从这个 Codex 项目中创建一个新对话任务。

不要把整个磁盘、用户主目录或大型共享目录作为 Workbench 的 `working_dir`。推荐为每个研究项目建立专用目录；真实数据若放在本仓库中，应置于已被 Git 忽略的 `repository/` 下。

Codex 官方的项目与对话说明见 [Projects and chats](https://learn.chatgpt.com/docs/projects)。

## 2. 启动 Workbench

先确认本机安装了 Node.js 22+ 和 npm。

按照 [README 的本地运行说明](../README.md#本地运行)安装依赖并启动开发模式：

```powershell
npm install
npm run dev:full
```

开发模式请打开 Vite 在终端显示的地址，默认为 <http://127.0.0.1:5173>。如果你使用生产式本地运行，应先执行 `npm run build`，再执行 `npm start`，然后打开 <http://127.0.0.1:3001>。

`npm link` 可以把 `workbench` 注册为本机命令；未注册时，Codex 也可以使用 `node bin/workbench.js ...`。正常情况下，这些 CLI 命令由 Codex 根据项目 Skill 调用，不需要研究者逐条输入。

## 3. 创建 Workbench Project

在左侧进入 **项目仓库**，点击 **新建项目**，填写：

- **项目名称**：课题或研究体系的名称；
- **材料/体系**：可选，例如材料、模型或理论对象；
- **描述**：研究背景与大目标的简短说明；
- **工作目录**：专门保存本项目研究文件的绝对路径。

工作目录是本地文件访问边界，不只是显示字段。Research Plan 和每个 Task 的文件都会位于这个目录下。不要把 Workbench 源码根目录当作普通科研数据目录。

## 4. 创建 Task，并在创建时绑定工作流

进入刚创建的 Project，在 **任务** 标签中点击 **新建任务**：

1. 写一个可以独立判断是否完成的任务名称；
2. 用一两句话描述本次任务的目标；
3. 选择最接近的工作流模板；
4. 点击 **创建任务**。

这里的“选择模板”就是绑定工作流。创建时系统会复制一份完整工作流快照给该 Task。以后修改全局模板不会改变已有 Task；在 Task 中点击 **编辑任务流程**，只会修改这一个 Task。

当前公开模板包括：

- One-shot DFT+DMFT；
- 模型 DMFT（TRIQS）；
- 通用理论研究；
- 物理文献复现。

Workbench 只创建稳定的 Task 根目录，不按 Stage 自动建立一套固定文件夹。确认 Run 后，Codex 会在 Task 根内按 Working Plan 设计目录。

打开这个 Task 后，浏览器地址中 `#/task/` 后面的字符串就是后续恢复所需的 Task ID。

## 5. 撰写并关联 Research Plan

进入左侧 **研究方案**：

1. 先在项目筛选器中选择所属 Project；
2. 点击 **新建**，输入方案标题；也可以导入已有 Markdown；
3. 在 **编辑信息** 中把方案关联到刚创建的 Task；
4. 在正文编辑器中写方案并保存。

Research Plan 记录“为什么这样研究”和“怎样判断物理结果”，而不是逐条 shell 命令。推荐至少写清：

```markdown
# 研究问题

## 背景与目标
- 要回答的物理问题
- 成功标准
- 哪些结果仍不足以回答问题

## 假设与适用范围
- 已知事实、待检验假设、近似和适用条件

## 方法与比较设计
- 候选方法/软件路线及选择依据
- 对照组、参数扫描、收敛与不确定度设计

## 输入与来源
- 结构、模型、参数、数据和文献的来源

## 资源与风险
- 本地/HPC 资源预估
- 可能失败的环节和替代路线

## 研究者关口
- 哪些科学选择必须回来询问我

## 完成证据
- 哪些文件、图、数值检查或推导足以支持完成
```

对于理论研究，额外写清接受的答案类型，例如解释、预测、no-go 结论或明确约定的条件定理；不要让“得到了一份诊断清单”悄悄替代原问题。

## 6. 在 Codex 对话中草拟 Run

Web 页面不能启动或授权 Run。回到刚才的 Codex 对话，发送下面这段话，并替换 Task ID：

```text
请先阅读项目根的 AGENTS.md 和 skills/workbench-agent/SKILL.md。

请接管 Workbench Task <task-id>。先运行 workbench doctor 和紧凑 context，
找到并阅读该 Task 关联的 Research Plan 与工作流。请先不要执行真实计算，
而是：
1. 用通俗语言复述研究目标、主要假设、核心 Workflow 和完成证据；
2. 指出仍需要我决定的科学问题；
3. 草拟完整 Task Spec；
4. 展示精确 Confirmed Envelope、资源上限和 SHA-256；
5. 等我明确确认后再开始执行。
```

Codex 会通过 `workbench` CLI 恢复 Task 上下文、读取研究方案和工作流，并建立一个 `draft` Run。此时还没有真实执行授权。

## 7. 审阅并确认 Envelope

确认前至少检查这些内容：

| 检查项 | 你要确认的问题 |
| --- | --- |
| 科学承诺 | 目标、关键假设和物理口径是否准确？ |
| 核心阶段 | Workflow 是否缺少会改变结论的阶段或检查点？ |
| 方法与软件 | 允许的方法和软件栈是否足够且不过宽？ |
| 能力 | 是只允许本地计算，还是包含远程检查、传输、提交与取消？ |
| HPC 与资源 | profile、单作业核数、墙钟、并发数和自动重试上限是否可接受？ |
| 保护路径 | 哪些已有输入、结果或发表材料不能覆盖？ |
| 研究者关口 | 哪些决定必须回来与你讨论？ |
| 完成证据 | 什么结果才算完成，而不只是“程序跑完”？ |

如果内容正确，可以明确回复：

```text
我确认本次 Run 的 Envelope，SHA-256 为 <完整哈希>。
请在该边界内自主执行；遇到需要扩大科学承诺、方法、软件、资源、权限、
保护路径或完成证据的情况时，先停下来让我确认。
```

沉默、“可以试试”或以前对整个课题的宽泛同意都不算确认。确认后，Codex 可以在 Envelope 内自主修改 Working Plan、排错、传输、运行、监控和有限重试，不会为每条普通命令再次询问。

## 8. 观察执行，而不是在 Web 中遥控

确认后可以在 Web 中查看：

- **任务工作流**：核心科学阶段和步骤进度；
- **Agent 运行记录**：Task Spec、当前 Stage、Action、Job、证据检查和完整 Event 时间线；
- **待沟通事项**：区分应由 Codex 自己处理的问题和真正需要研究者决定的问题；
- **证据库**：产物哈希、有效性和 validator 结果；
- **超算管理**：已登记的连接边界、Task 映射与作业快照。

Web 是审阅面，不提供 Run 启动、Envelope 确认、Job 提交/取消或对账按钮。研究者的决定继续在 Codex 对话中形成，再由 CLI 写入账本。

如果对话中断或换了新对话，发送：

```text
请按 skills/workbench-agent/SKILL.md 恢复 Workbench Task <task-id>。
先运行 doctor 和紧凑 context，只读取当前 Run、Envelope 哈希、Working Plan、
待沟通事项和 active/uncertain Jobs，再继续；不要依赖聊天记忆，也不要重复提交。
```

## 9. 你的 Codex 对话是否在 Git 仓库里？

默认不在。

- Codex 对话的 transcript 属于 Codex 对话任务，不会自动变成仓库文件，也不会被 `git commit` 提交；
- Workbench 默认只记录必要的决定摘要、哈希、时间和可选的 Codex task reference，不保存完整聊天正文；
- Workbench 的本地 SQLite 运行数据位于 `data/`，该目录被 `.gitignore` 排除；
- 只有当你或 Codex 明确把内容写成 Markdown/代码文件并将它加入 Git 时，它才会进入仓库历史。

因此，换对话后的恢复来源是 Workbench 账本、Research Plan、Task 文件和 Git 文档，而不是要求新对话“记住”旧聊天。若要公开某次研究过程，建议整理一份去除隐私和密钥的研究摘要，不要直接提交完整聊天记录。

## 10. 需要超算时再配置远程设备

当前版本通过本机 OpenSSH/SFTP 连接远程设备，并正式支持 IBM LSF。最简单的做法是把登录地址、用户名、认证方式、用户根、项目根和 Task 告诉 Codex，让 Agent 检查或生成 SSH alias，并通过 CLI 登记设备与 Task 映射。你只需亲自核对首次 host key、完成密码/MFA，并确认包含远程能力和资源上限的 Task Spec。

Web 没有上传、提交或取消按钮是预期设计：把具体操作告诉 Codex，Agent 会通过受控 CLI 完成并记录。如果 Web 报 `Origin is not allowed by Workbench`，它是浏览器来源白名单问题，不等于 SSH 或科研目录没有权限；CLI 仍可能可用。完整配置、传输命令、故障判断和安全提醒见[远程计算设备：连接、传输与 Agent 协作](REMOTE_COMPUTE.md)。

## 第一次 Run 的完成清单

- [ ] Codex 项目以本仓库为主文件夹，并能访问科研工作目录；
- [ ] Workbench Project 使用专用 `working_dir`；
- [ ] Task 已选择合适模板并拥有独立工作流快照；
- [ ] Research Plan 已保存并关联 Task；
- [ ] Codex 已展示精确 Envelope 和 SHA-256；
- [ ] 研究者已在对话中明确确认；
- [ ] 普通操作出现在 Event 时间线，科学里程碑出现在 Actions；
- [ ] 非终态远程 Job 有当前 Codex 对话的 heartbeat 监控；
- [ ] 完成判断基于证据，而不只是退出码或文件存在。

下一步阅读：[使用指南与研究技巧](USAGE_GUIDE.md)。
