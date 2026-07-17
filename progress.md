# DFT+DMFT Workbench 开发进度

> 最后更新：2026-07-17

---

## 项目位置

| 项 | 路径 |
|----|------|
| 项目根目录 | `D:\DFT+DMFT workbench` |
| 后端代码 | `D:\DFT+DMFT workbench\server\` |
| 前端代码 | `D:\DFT+DMFT workbench\src\` |
| SQLite 数据库 | `D:\DFT+DMFT workbench\data\workbench.db` |
| 构建产物 | `D:\DFT+DMFT workbench\dist\index.html`（单文件） |
| 项目记忆 | `D:\Users\AI\workbuddy\DFT+DMFT workbench\.workbuddy\memory\` |
| 参考材料 | `D:\Documents\Obsidian vault\Academic vault\03-Projects\97-DFT+DMFT\自由白板 1.canvas` |

## 启动方式

```bash
cd "D:\DFT+DMFT workbench"
npm start          # 生产：后端服务前端+API → http://localhost:3001
npm run dev:full   # 开发：前后端热更新同时启动
npm run build      # 重新构建前端
```

---

## 技术栈

- **前端**：React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + React Router (HashRouter) + Lucide Icons + vite-plugin-singlefile
- **后端**：Node.js + Express 5 + better-sqlite3 (SQLite)
- **端口**：localhost:3001（后端同时服务 API 和构建后的前端）

---

## 已完成的事项

### 0. 稳定性升级（2026-07-17）✅
- 任务新增稳定 `folder_name`，任务改名不再导致计算目录失联
- 文件 API 使用规范路径和真实路径双重校验，阻止 `..`、同名前缀和符号链接逃逸
- API 使用 Zod 统一校验项目、任务、进度、文件、经验和工作流输入
- 校验任务状态、步骤状态、工作流 ID 和步骤归属
- SQLite 使用 `schema_migrations` 管理兼容迁移，替代宽泛异常吞噬
- 全局 API 错误提示，原先页面静默失败时用户现在可看到错误
- 增加临时数据库集成测试，覆盖旧库迁移、目录稳定、非法输入和路径穿越
- 增加 GitHub Actions CI 与 `npm run check`
- 真实数据库迁移前已生成完整备份并通过 `quick_check`

### 1. 后端搭建 ✅
- Express 5 服务器，端口 3001
- SQLite 数据库初始化，5 张表：`projects`, `tasks`, `step_progress`, `step_files`, `experiences`
- 完整 REST API 路由：
  - `/api/workflows` — 工作流模板列表
  - `/api/projects` — 项目 CRUD
  - `/api/projects/:pid/tasks` — 任务 CRUD（嵌套路由）
  - `/api/tasks/:tid/progress` — 步骤进度 GET/PUT
  - `/api/tasks/:tid/progress/:stepId/files` — 步骤文件关联
  - `/api/projects/:pid/files` — 文件仓库（浏览/创建目录/读取文件）
  - `/api/experiences` — 经验库 CRUD
  - `/api/step-files/:id` — 删除文件关联
- **修复的两个 Express 5 坑**：
  - Router 需要 `{ mergeParams: true }` 才能访问父路由参数
  - 不支持 `app.get('*', ...)`，改用中间件做 SPA fallback

### 2. 前端数据层 ✅
- `src/types/index.ts` — 全部 TypeScript 类型定义（Project, Task, StepProgress, StepFile, Experience, WorkflowTemplate 等）
- `src/api/client.ts` — API 调用封装层（projectsApi, tasksApi, progressApi, stepFilesApi, filesApi, experiencesApi, workflowsApi）
- `src/data/workflows.ts` — 多工作流注册表（当前只有 `dft-dmft-oneshot`，结构支持未来扩展）
  - 5 个阶段：准备 → DFT → Wannier90 → DMFT → 结果检查
  - 19 个步骤（含 2 个可选）
  - 辅助函数：getWorkflow, getStages, getSteps, getStep, getStageForStep, getStepsForStage, getTotalRequiredSteps

### 3. 前端页面和组件 ✅
- **ProjectsPage** — 项目仓库列表，CRUD 项目（名称/材料/描述/工作目录）
- **ProjectDetailPage** — 项目详情，含两个 Tab：
  - 任务列表（CRUD 任务，创建时选工作流模板）
  - 文件仓库（FileBrowser 组件）
- **TaskWorkflowPage** — 任务工作流页（流程图 + 进度追踪 + 步骤详情），绑定到具体 taskId
- **WorkflowPage** — 工作流页（侧边栏直达），支持：
  - 模板预览模式（不选任务，只看流程和步骤说明）
  - 任务进度模式（选任务后追踪进度、改状态、记笔记、关联文件）
- **ExperiencePage** — 经验库（后端持久化，支持标签/搜索/关联步骤）
- **Flowchart** — 交互式 SVG 流程图（接受 workflowId + progressMap 作为 props）
- **StepDetail** — 步骤详情面板（状态切换、笔记、文件关联管理）
- **ProgressBar** — 进度条（总体 + 各阶段百分比）
- **FileBrowser** — 文件浏览器（目录导航、文件查看、创建文件夹）
- **Sidebar** — 侧边栏导航（项目仓库 / 工作流 / 经验库）

### 4. E2E 测试通过 ✅
- 创建项目 → 创建任务 → 设置步骤进度 → 查询进度 → 删除项目（级联删除）
- API 全链路验证通过

---

## 关键决策

1. **从纯前端 localStorage 重构为全栈应用**
   - 用户反馈：笔记、任务、文件需要持久化存储，localStorage 不够
   - 决策：Node.js + Express + SQLite，本地部署无需额外服务

2. **数据模型重新设计**
   - 用户反馈：原来的"任务仓库"概念错误——把工作流步骤当成了独立任务
   - 决策：
     - **项目 (Project)** = 研究一个材料/体系（如"V₂O₃ 电子结构研究"），有工作目录
     - **任务 (Task)** = 一次具体计算运行，创建时选定工作流模板
     - **步骤 (Step)** = 工作流模板定义的 SCF/NSCF/Wannier 等，不是独立任务
   - 原来的"任务仓库"改名为"项目仓库"

3. **文件仓库功能**
   - 用户反馈：每一步都需要文件，需要一个地方管理这些文件
   - 决策：后端直接管理文件系统（浏览目录、读取文件内容、创建文件夹），每个项目有 working_dir

4. **多工作流支持**
   - 用户反馈：以后还要加别的工作流，不只 DFT+DMFT
   - 决策：工作流注册表结构 `WORKFLOWS: WorkflowTemplate[]`，创建任务时选工作流模板

5. **工作流页面保留为侧边栏一级入口**
   - 用户反馈：流程图是最喜欢的功能，重构后找不到了
   - 决策：新增 WorkflowPage，侧边栏直接可达，支持模板预览 + 任务进度两种模式

6. **HashRouter + vite-plugin-singlefile**
   - 决策：兼容本地文件直接打开（file:// 协议），整个前端打包为单 HTML 文件

---

## 未完成的待办

### 高优先级
- [ ] **验证前端 UI 实际效果** — 服务器跑在 localhost:3001，但用户尚未确认预览面板能正常显示。如果预览面板不行，可直接用浏览器打开 `D:\DFT+DMFT workbench\dist\index.html`
- [ ] **后端 server TypeScript 独立编译** — 当前用 tsx 运行时转译，生产环境应该编译为 JS。可加 `server/tsconfig.json` + `tsc` 构建步骤
- [ ] **文件仓库的实际测试** — FileBrowser 组件需要用户设置项目 working_dir 后实际测试目录浏览和文件读取功能

### 中优先级
- [ ] **全电荷自洽 DFT+DMFT 工作流** — 在 `workflows.ts` 中注册第二个工作流模板
- [ ] **其他计算工作流**（DFT-only 等）
- [ ] **文件上传功能** — 当前只能关联已有文件路径，不能上传新文件
- [ ] **批量操作** — 批量修改步骤状态、批量删除任务等
- [ ] **数据导入/导出** — 备份和恢复整个数据库

### 低优先级
- [ ] **UI 细节打磨** — 响应式布局优化、暗色/亮色主题切换
- [ ] **搜索增强** — 经验库全文搜索、步骤内搜索
- [ ] **通知系统** — 任务完成提醒、进度里程碑
- [ ] **多用户支持** — 如果需要在团队中共享

---

## 当前服务器状态

- 后端运行在 `http://localhost:3001`（后台任务，可能已超时停止）
- 重启命令：`cd "D:\DFT+DMFT workbench" && npx tsx server/index.ts`
- 构建命令：`cd "D:\DFT+DMFT workbench" && npm run build`

## 文件结构概览

```
D:\DFT+DMFT workbench\
├── server/
│   ├── index.ts              # Express 入口
│   ├── db.ts                 # SQLite 初始化 + schema
│   ├── tsconfig.json         # 后端 TS 配置
│   └── routes/
│       ├── projects.ts       # 项目 CRUD
│       ├── tasks.ts          # 任务 CRUD
│       ├── progress.ts       # 步骤进度 + 文件关联
│       ├── files.ts          # 文件仓库（浏览/读取/创建目录）
│       ├── experiences.ts    # 经验库 CRUD
│       └── workflows.ts      # 工作流模板列表
├── src/
│   ├── api/client.ts         # 前端 API 调用封装
│   ├── data/workflows.ts     # 多工作流注册表
│   ├── types/index.ts        # TypeScript 类型定义
│   ├── pages/
│   │   ├── ProjectsPage.tsx       # 项目仓库
│   │   ├── ProjectDetailPage.tsx  # 项目详情（任务+文件仓库）
│   │   ├── TaskWorkflowPage.tsx   # 任务工作流（绑定 taskId）
│   │   ├── WorkflowPage.tsx       # 工作流（侧边栏直达，模板预览+任务模式）
│   │   └── ExperiencePage.tsx     # 经验库
│   ├── components/
│   │   ├── Sidebar.tsx       # 侧边栏导航
│   │   ├── Flowchart.tsx     # SVG 交互式流程图
│   │   ├── StepDetail.tsx    # 步骤详情面板
│   │   ├── ProgressBar.tsx   # 进度条
│   │   └── FileBrowser.tsx   # 文件浏览器
│   ├── App.tsx               # 路由
│   ├── main.tsx              # 入口
│   └── index.css             # Tailwind CSS v4
├── data/workbench.db         # SQLite 数据库
├── dist/index.html           # 构建产物（单文件）
├── package.json
└── vite.config.ts
```
