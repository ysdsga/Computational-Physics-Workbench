# 架构说明

本文说明当前已经实现的任务独立工作流架构。系统整体分层和完整路由列表仍可参考 [`../doc/架构图.md`](../doc/架构图.md)。

## 工作流数据流

```text
src/data/workflows.ts
        │ 内置默认、首次播种、模板重置
        ▼
workflow_templates
        │ 创建任务时复制一次
        ▼
tasks.workflow_snapshot
        │ 任务页面、进度条、流程图、步骤详情、HPC 向导读取
        ▼
当前任务的独立工作流
```

模板和任务之间没有运行期同步。`tasks.workflow_id` 只保留来源关系，任务显示和执行所需的阶段、步骤、命令及文件定义来自 `workflow_snapshot`。

## 后端

`server/db.ts` 为 `tasks` 表提供 `workflow_snapshot` 字段，并通过可重复启动的 `ALTER TABLE` 兼容旧数据库。

`server/routes/tasks.ts` 负责：

- 新建任务时读取模板并保存完整快照。
- 读取任务时把数据库中的 JSON 解析为响应字段 `workflow`，不向前端暴露原始 `workflow_snapshot` 字符串。
- 对缺少快照的旧任务，以迁移时的当前来源模板补齐一次。
- 通过 `PUT /api/tasks/:taskId/workflow` 校验并保存任务工作流。
- 保存任务工作流后补建新增阶段目录，不删除已有目录或计算数据。

任务工作流校验保证阶段 ID 可安全作为目录名、阶段和步骤 ID 不重复，并且每个步骤引用已存在的阶段。

## 前端

`Task.workflow` 是前端使用的完整任务工作流对象。以下组件直接接收该对象，不再根据模板 ID 重新查询全局上下文：

- `Flowchart`
- `ProgressBar`
- `StepDetail`
- `HpcWizard`

`TemplateEditor` 支持两种已经实现的模式：

- 模板模式：保存到 `workflow_templates`，可重置为内置默认模板。
- 任务模式：保存到当前任务快照，不显示模板重置操作。

`WorkflowPage` 在模板预览模式使用 `WorkflowContext` 中的全局模板；选择任务后改用该任务的 `workflow`。`TaskWorkflowPage` 和 `HPCPage` 始终使用所选任务的工作流。

## 数据安全边界

- 数据库迁移不重建 `tasks` 表，也不删除任务、进度或文件关联。
- 工作流节点删除只改变任务快照，不删除项目工作目录中的内容。
- 自动化测试使用 `WORKBENCH_DB_PATH` 和临时项目目录，不写入真实数据库或科研目录。
