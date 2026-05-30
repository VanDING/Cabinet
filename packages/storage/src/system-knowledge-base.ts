export interface SystemKnowledgeBaseEntry {
  id: string;
  topic: string;
  category: 'infrastructure' | 'capability' | 'constraint' | 'agent';
  content: string;
  version: number;
  metadata?: Record<string, unknown>;
}

export const SYSTEM_KNOWLEDGE_BASE: SystemKnowledgeBaseEntry[] = [
  {
    id: 'directory_structure',
    topic: '数据目录结构',
    category: 'infrastructure',
    version: 1,
    content: `## Cabinet 数据目录结构
用户数据根目录：\`~/.cabinet\`（跨平台，通过 os.homedir() 解析）

子目录：
- \`skills/\` — 技能目录。每个技能一个子文件夹，内含 SKILL.md。API: /api/skills
- \`agents/\` — 自定义 Agent 目录。每个 Agent 一个子文件夹，内含 agent.json。API: /api/agents
- \`projects/\` — 项目索引目录。JSON 文件描述项目元数据。
- \`mcp/\` — MCP 服务器配置文件（*.json）。
- \`backups/\` — 数据库自动备份。
- \`logs/\` — 日志文件（pino-roll 管理，10MB 轮转）。
- \`sessions/\` — 会话持久化数据。
- \`plans/\` — 计划文件。
- \`rules/\` — 规则文件。

**重要**：所有用户数据操作必须基于上述路径，禁止硬编码其他路径。`,
  },
  {
    id: 'scheduler_capabilities',
    topic: '定时调度器',
    category: 'capability',
    version: 1,
    content: `## 内置定时调度器
Cabinet 内置基于 node-cron 的定时任务调度器，支持标准 5 字段 cron 表达式。

可用工具：
- \`schedule_task(name, cron, prompt, recurring)\` — 创建定时任务。\`cron\` 参数使用标准 cron 表达式，如：
  - \`*/5 * * * *\` — 每 5 分钟
  - \`0 9 * * *\` — 每天 9:00
  - \`0 0 * * 0\` — 每周日午夜
- \`list_scheduled_tasks\` — 列出所有活跃任务
- \`cancel_scheduled_task(taskId)\` — 取消任务

任务持久化到 SQLite，server 重启后自动恢复。`,
  },
  {
    id: 'agent_responsibilities',
    topic: 'Agent 分工',
    category: 'agent',
    version: 2,
    content: `## Agent 职责边界
- **secretary** — 入口路由、通用对话、意图识别、工具分发
- **organize** — 首席组织架构师。将业务目标转化为 Agent + Workflow + Skill + MCP 蓝图。统筹设计所有体系化工作（工作流、Agent、Skill、MCP）。不直接执行具体流程。
- **curator** — 记忆管理员。会话总结、知识固化、模式提取、项目进度跟踪。
- **decision_analyst** — 决策分析师。结构化分析、选项评估、风险权衡。
- **meeting_chair** — 会议主持人。多视角辩论、共识合成。
- **reviewer** — 质量审查员。逻辑、证据、完整性检查。

**路由原则**：
- 涉及"设计体系/创建 Agent/组织架构/写 Skill/搭 MCP" → organize
- 涉及"总结/记忆/进度" → curator
- 不确定 → secretary`,
  },
  {
    id: 'system_constraints',
    topic: '系统约束',
    category: 'constraint',
    version: 1,
    content: `## 系统架构约束
- **本地优先**：所有数据存储在本地 SQLite，不依赖外部云服务。
- **零外部依赖**：除 LLM API 调用外，核心功能完全离线运行。
- **单机架构**：当前为单机桌面应用，不支持多租户。
- **安全分级**：T0（完全审查）→ T1（策略守护）→ T2（操作监管）→ T3（完全自主）。
- **预算控制**：内置日/周/月预算限制，超预算时 LLM 调用受控。`,
  },
  {
    id: 'available_tools_overview',
    topic: '可用工具概览',
    category: 'capability',
    version: 1,
    content: `## 核心工具类别
- **文件操作**：read_file, write_file, edit_file, list_directory, search_files
- **记忆管理**：remember, recall, search_memory, write_memory
- **决策流程**：create_decision, query_decisions, get_decision
- **工作流**：create_workflow, run_workflow, list_workflows
- **Agent 管理**：register_agent, list_agents, update_agent
- **调度**：schedule_task, list_scheduled_tasks, cancel_scheduled_task
- **会议**：start_meeting
- **项目**：get_project_context, update_project_summary
- **系统知识查询**：query_system_knowledge, get_system_knowledge`,
  },
  {
    id: 'workflow_node_types',
    topic: 'Workflow 节点类型',
    category: 'capability',
    version: 2,
    content: `## Workflow 支持的节点类型
Workflow 由节点（node）和边（edge）组成 DAG。节点类型必须是以下之一，不能使用自定义类型：

### 流程控制（7 种）
- **start** — 流程起点
- **end** — 流程终点
- **ifElse** — 条件分支，根据 branches 配置或 loopCondition 决定走哪条边
- **loop** — 循环执行，支持 count/condition 两种模式，children 内为循环体
- **parallel** — 并行分支，同时执行多个下游节点
- **merge** — 合并多个上游分支的输出（object/array/concat/firstNotNull）
- **pass** — 透传第一个上游节点的输出

### 执行容器（1 种）
- **agentGroup** — Agent 执行组。内部的 llm/skill/tool 节点由同一个 AgentLoop 执行，保持上下文连贯。通过 role 字段指定 Agent 角色名，persistent 控制是否跨组保留上下文。

### 执行节点（5 种）
- **llm** — 直接调用 LLM 生成内容。prompt 字段传入提示词
- **skill** — 调用已注册的技能（Skill）。skillId 指定技能名
- **tool** — 调用单个工具。toolId 指定工具名，inputMapping 映射参数
- **code** — 执行一段代码。code 字段传入代码字符串，codeTimeout 控制超时
- **workflow** — 调用子工作流。workflowId 指定目标工作流

### AI 节点（2 种）
- **intentClassify** — 意图分类。intents 定义候选意图，输出匹配的标签用于分支路由
- **knowledgeBase** — 知识库检索。kbId/queryTemplate/topK 配置检索参数

### Human-in-the-loop（2 种）
- **approval** — 暂停流程，等待用户审批。审批通过后经 approval polling 恢复执行
- **human** — 暂停流程，等待用户输入任务结果

### 旧名称映射（向后兼容）
旧版 steps 格式中的部分名称已更改：aiAgent → agentGroup, llmCall → llm, condition → ifElse, humanApproval → approval。

### Capabilities 系统
Workflow 定义可包含 capabilities 字段，声明该工作流 Agent 可访问的工具类别：
- files: { read, write } — 文件系统读写
- web: { fetch, http } — 网络请求
- shell — 命令行执行
- knowledge: { search, index } — 知识库检索/索引
- evaluation — 输出评估
未声明的能力会被自动拦截（stub 抛出错误）。

### Cron 集成
Workflow 支持 cron_expression 字段，使用标准 5 字段 cron 表达式。带 cron 的工作流在 server 启动时由 TaskScheduler 自动加载并调度执行。`,
  },
];

import { SystemKnowledgeRepository } from './repositories/system-knowledge-repo.js';

export function syncSystemKnowledge(
  db: import('better-sqlite3').Database,
  baseEntries: SystemKnowledgeBaseEntry[],
): { created: number; updated: number } {
  const repo = new SystemKnowledgeRepository(db);
  repo.ensureTable();

  let created = 0;
  let updated = 0;

  for (const entry of baseEntries) {
    const currentVersion = repo.getVersion(entry.id);
    if (currentVersion === 0) {
      repo.upsert({
        ...entry,
        metadata: JSON.stringify(entry.metadata ?? { source: 'code', autoGenerated: true }),
      });
      created++;
    } else if (entry.version > currentVersion) {
      repo.upsert({
        ...entry,
        metadata: JSON.stringify(entry.metadata ?? { source: 'code', autoGenerated: true }),
      });
      updated++;
    }
  }

  return { created, updated };
}
