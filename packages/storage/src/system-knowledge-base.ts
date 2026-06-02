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
    version: 2,
    content: `## 完整工具目录（约 85 个）

### 文件操作（15 个）
read_file, write_file, edit_file, apply_patch, move_file, copy_file, make_directory, file_info, list_directory, glob, grep, recent_files, watch_file, index_project, delete_file

### 网络请求（4 个）
web_fetch, http_request, fetch_github_repo, fetch_webpage_clean

### Shell 执行（1 个）
execute_command — 执行 shell 命令，返回 { stdout, stderr, exitCode }。有安全拦截机制。

### 记忆管理（7 个）
remember, recall, search_memory, list_memories, write_memory, update_memory, delete_memory

### 决策流程（6 个）
create_decision, approve_decision, reject_decision, query_decisions, get_decision, get_decision_audit

### 工作流（8 个）
create_workflow, update_workflow, delete_workflow, list_workflows, get_workflow, run_workflow, get_workflow_run, list_workflow_runs

### Agent 管理（5 个）
register_agent, update_agent, delete_agent, list_agents, invoke_agent

### 项目（5 个）
create_project, list_projects, set_project_context, get_project_context, update_project_summary, add_milestone

### 调度（3 个）
schedule_task, list_scheduled_tasks, cancel_scheduled_task

### 会议（1 个）
start_meeting

### 系统操作（6 个）
read_clipboard, write_clipboard, send_notification, start_process, kill_process, show_open_dialog

### 文档处理（4 个）
read_pdf, read_docx, read_xlsx, read_pptx

### 归档（2 个）
read_zip, extract_zip

### 浏览器自动化（6 个）
browser_navigate, browser_click, browser_type, browser_read, browser_screenshot, browser_evaluate

### 通信工具（2 个）
fetch_rss, send_email

### 知识检索 RAG（3 个）
index_document, search_documents, clear_index

### 评估（1 个）
evaluate

### LSP 代码分析（4 个）
workspace_symbol, go_to_definition, find_references, diagnostics

### 系统知识查询（2 个）
query_system_knowledge, get_system_knowledge

### 任务委派（3 个）
delegate_task, get_task_status, list_active_tasks

### 状态/健康（3 个）
get_status, get_dashboard_stats, get_memory_stats

### 事件（2 个）
get_recent_events, publish_notification

### Skill（2 个）
use_skill, update_skill

### 其他（4 个）
create_employee, get_captain_preferences, set_captain_preferences, set_project_context

**动态扩展**：MCP 服务器连接后自动注入更多工具（以 mcp__ 为前缀）。Skills 注册后注入 use_skill__<name> 工具。`,
  },
  {
    id: 'workflow_node_types',
    topic: 'Workflow 节点类型',
    category: 'capability',
    version: 3,
    content: `## Workflow 支持的节点类型
Workflow 由节点（node）和边（edge）组成 DAG。节点类型必须是以下之一，不能使用自定义类型。

### 流程控制（7 种）
- **start** — 流程起点
- **end** — 流程终点
- **ifElse** — 条件分支。使用 \`branches\` 数组，每个分支包含 \`label\`、\`priority\` 和 \`conditions\`（条件数组，每个条件有 \`field\`、\`operator\`、\`value\`、\`logic\` AND | OR）。匹配第一个满足所有条件的分支。回退：\`defaultBranch\` 或 legacy \`loopCondition\` 表达式。
- **loop** — 循环执行。配置：\`loopType\`: count | condition；\`loopCount\`（count 模式时的次数）；\`loopCondition\`（condition 模式时的表达式）；\`loopMaxIterations\`（安全上限，默认 1000）；\`loopOutputMode\`: array | last | merge（控制迭代结果收集方式）。循环体为 children 内的节点。
- **parallel** — 并行分支，同时执行多个下游节点。\`failStrategy\`: failAll（任一失败则抛错） | continue（收集全部结果）。\`waitStrategy\` 字段已预留但未生效。
- **merge** — 合并多个上游分支的输出。\`mergeStrategy\`: object（默认，以输入节点 id 为 key） | array（值为数组）。\`concat\` 和 \`firstNotNull\` 已预留但尚未实现。
- **pass** — 透传第一个上游节点的输出

### 执行容器（1 种）
- **agentGroup** — Agent 执行组。内部的 llm/skill/tool 节点由同一个 AgentLoop 执行，保持上下文连贯。
  - \`role\`（必填）：Agent 角色名，如 secretary、organize。
  - \`persistent\`（默认 true）：是否跨组保留上下文。
  - \`systemPrompt\`：覆盖该角色的默认 system prompt。
  - \`model\`：覆盖模型选择。
  - \`allowedTools\`：限制该组可使用的工具列表。

### 执行节点（5 种）
- **llm** — 直接调用 LLM 生成内容。
  - \`prompt\`：提示词（必填）。
  - \`temperature\`、\`maxTokens\`、\`outputFormat\`（text | json | markdown）：可选，当前引擎已预留但未读取。
- **skill** — 调用已注册的技能。\`skillId\` 指定技能名。\`inputMapping\` 映射参数。
- **tool** — 调用单个工具。\`toolId\` 指定工具名。\`inputMapping\` 映射参数；值以 \`{{\` 开头时会被解析为变量引用（如 \`"{{nodeId.output}}"\`）。
- **code** — 执行一段代码。\`code\` 字段传入代码字符串，\`codeTimeout\` 控制超时（默认 5000ms）。
- **workflow** — 调用子工作流。\`workflowId\` 指定目标工作流。

### AI 节点（2 种）
- **intentClassify** — 意图分类。
  - \`intents\`：候选意图数组，每项含 \`name\`、\`description\`、\`examples\`。
  - \`intentThreshold\`：最低置信度阈值。
  - 输出匹配的标签，通过边 label 路由到对应分支。
- **knowledgeBase** — 知识库检索。
  - \`kbId\`、\`queryTemplate\`、\`topK\`、\`scoreThreshold\`。

### Human-in-the-loop（2 种）
- **approval** — 暂停流程，等待用户审批。
  - \`approvalTitle\`、\`options\`（选项数组）。
  - 审批通过后经 continueRun 恢复执行。
- **human** — 暂停流程，等待用户输入任务结果。
  - \`humanDeadline\`：截止日期。
  - 完成后经 continueRun 恢复执行。

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
  {
    id: 'mcp_capabilities',
    topic: 'MCP 扩展',
    category: 'capability',
    version: 1,
    content: `## MCP (Model Context Protocol) 完整支持

Cabinet 内置完整的 MCP 协议支持，通过 stdio 传输连接外部 MCP 服务器，动态发现并注册工具。

### 配置方式（三选一）
1. **Web UI**：Settings → MCP Tab → 添加/测试/启用/禁用 MCP 服务器
2. **HTTP API**：
   - \`GET /api/settings/mcp-servers\` — 查看所有服务器状态和配置
   - \`PUT /api/settings/mcp-servers\` — 批量更新配置。请求体：\`{ configs: [...] }\`
   - \`POST /api/settings/mcp-servers/test\` — 测试单个服务器连接
3. **手动文件配置**：
   - 在 \`~/.cabinet/mcp/\` 目录放置 \`*.json\` 配置文件
   - 或在 \`~/.cabinet/settings.json\` 中添加 \`mcpServers\` 字段

### 配置格式
每个 MCP 服务器的 JSON 配置：
\`\`\`json
{
  "name": "唯一名称",
  "transport": "stdio",
  "command": "可执行文件路径",
  "args": ["参数1", "参数2"],
  "enabled": true,
  "env": { "KEY": "value" }
}
\`\`\`
\`env\` 字段可选，支持 \${VAR} 环境变量替换。

### 工作原理
1. Server 启动时读取 \`~/.cabinet/mcp/*.json\` + settings.json 中的 \`mcpServers\` 字段
2. MCPManager 自动连接 \`enabled: true\` 的服务器
3. 连接成功后调用 \`client.listTools()\` 发现该服务器提供的工具
4. 工具以 \`mcp__<toolName>\` 命名注入到 ToolExecutor，所有 Agent 均可调用
5. \`PUT /api/settings/mcp-servers\` 更新配置后会立即重连变更的服务器

### MCP 工具的安全分类
MCP 工具自动归类为 moderate 风险级别。在 T0 (Captain Review) 模式下调用需要确认。

### 内置 MCP Builder 技能
系统预置了 mcpBuilder 技能（通过 use_skill__mcpBuilder 或直接说"帮我开发 MCP 服务器"触发），可指导从零开发新的 MCP 服务器。

### 给 AI Agent 的指导
- 当用户说"安装 MCP server"时，不要猜测 — Cabinet 原生支持 MCP，引导用户到 Settings → MCP Tab 或使用 API
- 如果你有 shell 访问权限，可以帮用户编写 \`~/.cabinet/mcp/<name>.json\` 配置文件
- 如果你需要调用 MCP 工具但不确定是否已配置，用 query_system_knowledge 或 get_system_knowledge 查询`,
  },
  {
    id: 'settings_management',
    topic: '设置管理',
    category: 'capability',
    version: 1,
    content: `## 设置管理

### API Keys 管理
- \`GET /api/settings/api-keys\` — 列出所有已配置的 API Key（含脱敏预览）
- \`POST /api/settings/api-keys\` — 添加 API Key。Body: { provider, apiKey, keyType?, baseUrl?, model? }
- \`DELETE /api/settings/api-keys/:id\` — 删除 API Key
- \`POST /api/settings/api-keys/:id/test\` — 测试 API Key 连接
- \`POST /api/settings/preferred-key\` — 设置当前活跃的 API Key

### 支持的 LLM Provider
anthropic, openai, google, deepseek, qwen, moonshot, zhipu, baichuan

### 模型配置
- \`GET /api/settings/model-config\` — 获取 modelMapping（tier → model 映射）+ provider 配置
- \`PUT /api/settings/model-config\` — 更新。Body: { providers?, modelMapping? }
- modelMapping 默认值：deep_reasoning → anthropic/claude-opus-4-7, default → anthropic/claude-sonnet-4-6, fast_execution → anthropic/claude-haiku-4-5

### 预算管理
- \`GET /api/settings/budget\` — 获取 { daily, weekly, monthly } 限制（人民币）
- \`PUT /api/settings/budget\` — 更新预算限制。超预算时 LLM 调用受控。

### 委托层级
- \`GET /api/settings/delegation-tier\` — 获取当前层级
- \`PUT /api/settings/delegation-tier\` — 设置层级（T0/T1/T2/T3）
- T0 (Captain Review)：每次写操作和决策需确认
- T1 (Strategic Guard)：低风险自动，高风险需确认
- T2 (Trusted Mode)：大部分自动，仅破坏性操作需确认
- T3 (Full Autonomy)：完全自主，仅预算限制

### MCP 服务器管理
- \`GET /api/settings/mcp-servers\` — 查看所有 MCP 服务器状态
- \`PUT /api/settings/mcp-servers\` — 批量更新 MCP 配置，立即重连
- \`POST /api/settings/mcp-servers/test\` — 测试单个 MCP 服务器连接

### 存储位置
所有设置持久化到 \`~/.cabinet/settings.json\`。API Keys 额外加密存储在 SQLite api_keys 表（AES-256）。`,
  },
  {
    id: 'shell_execution',
    topic: 'Shell 命令执行',
    category: 'capability',
    version: 1,
    content: `## Shell 命令执行

### 可用工具
- \`execute_command(command, timeout?)\` — 执行 shell 命令，返回 { stdout, stderr, exitCode }
- \`start_process(command, args?, cwd?)\` — 后台启动进程（使用 spawn，返回 PID）
- \`kill_process(pid)\` — 终止进程（拒绝 PID < 100 的系统进程）

### 安全限制
- 危险命令自动拦截：rm -rf /、dd、fork bomb、直接写 /dev/sda、mkfs、管道到 shell 执行（curl|bash 模式）
- 仅允许白名单内环境变量传递（PATH, HOME, USER, TEMP, SHELL, LANG 等约 25 个）
- 执行超时默认 60 秒
- 输出上限 10MB
- 内网 IP 地址保护（localhost/内网 IP 的 HTTP 请求被阻止）

### 系统操作工具
- \`read_clipboard\` — 读取系统剪贴板
- \`write_clipboard(text)\` — 写入系统剪贴板
- \`send_notification(title, message)\` — 桌面通知（使用 node-notifier）
- \`show_open_dialog(title?, defaultPath?)\` — 原生文件选择对话框（仅桌面模式）

### 向用户说明
当你被问到"你能运行 shell 命令吗"时，明确告知：
- Cabinet 支持受限的 shell 执行，有安全拦截机制
- 危险操作（如 rm -rf、直接磁盘写入）被自动阻止
- 如果你的 Agent 角色没有 shell 权限（由 allowedTools 决定），引导用户通过 Settings API 调整`,
  },
  {
    id: 'document_processing',
    topic: '文档处理',
    category: 'capability',
    version: 1,
    content: `## 文档处理能力

### 支持的文档格式
- \`read_pdf(filePath, pages?)\` — 读取 PDF（使用 pdf-parse，仅提取文本，无表格/图片支持）
- \`read_docx(filePath)\` — 读取 DOCX（使用 mammoth，提取原始文本，无样式/图片提取）
- \`read_xlsx(filePath, sheet?)\` — 读取 XLSX（使用 xlsx，支持 sheet 选择，返回二维数组）
- \`read_pptx(filePath)\` — 读取 PPTX（使用 adm-zip 解析 XML，提取幻灯片文本，无备注提取）

### 归档操作
- \`read_zip(filePath)\` — 列出 ZIP 文件内容（adm-zip）
- \`extract_zip(filePath, targetDir)\` — 解压 ZIP 到目标目录

### 文件类型检测
- 自动检测 MIME 类型（.png, .jpg, .pdf, .mp3, .mp4, .zip 等）
- 自动识别文本文件（约 60 种扩展名）
- 二进制文件以 base64 编码返回
- 文件大小上限 50MB
- BOM 自动处理（UTF-8 with BOM）
- GBK 编码回退尝试

### 局限性
PDF/DOCX/PPTX 仅提取文本，不支持表格解析、图片提取、样式保留。`,
  },
  {
    id: 'browser_automation',
    topic: '浏览器自动化',
    category: 'capability',
    version: 1,
    content: `## 浏览器自动化

### 可用工具
- \`browser_navigate(sessionId, url, waitFor?)\` — 导航到 URL
- \`browser_click(sessionId, selector)\` — 点击元素
- \`browser_type(sessionId, selector, text, submit?)\` — 输入文本
- \`browser_read(sessionId, selector?)\` — 读取页面内容
- \`browser_screenshot(sessionId, selector?)\` — 截图
- \`browser_evaluate(sessionId, script)\` — 执行 JavaScript

### 架构
- 基于 BrowserPool（@cabinet/harness），最大 3 个并发浏览器上下文
- 使用 Playwright CDP (Chrome DevTools Protocol)
- 空闲会话每 10 分钟自动清理

### 使用限制
- 需要用户先启动 Chrome 浏览器调试模式并配置端口
- 适用于需要与现有登录态交互的场景（如从已登录的浏览器中提取 token）
- 不适用于全新浏览器的全自动操作`,
  },
  {
    id: 'memory_system',
    topic: '记忆系统',
    category: 'infrastructure',
    version: 1,
    content: `## Cabinet 记忆系统

### 四种记忆类型
1. **短期记忆 (ShortTermMemory)**：Key-value 存储，会话级别，可选 TTL 过期
2. **长期记忆 (LongTermMemory)**：持久化到 SQLite，支持语义搜索（embedding）和文本回退搜索
3. **实体记忆 (EntityMemory)**：用户/Agent 偏好、决策历史、统计信息
4. **项目记忆 (ProjectMemory)**：项目目标、里程碑、关键决策、摘要

### 可用工具
- \`remember(sessionId, key, value, ttlMs?)\` — 写入短期记忆
- \`recall(sessionId, key?)\` — 读取短期记忆（不传 key 则获取全部）
- \`search_memory(query, limit?)\` — 搜索长期记忆（语义搜索 + 文本回退）
- \`write_memory(content, metadata?)\` — 写入长期记忆
- \`update_memory(memoryId, status?, importance?, confidence?)\` — 更新记忆元数据
- \`delete_memory(memoryId)\` — 删除记忆
- \`list_memories(limit?, offset?, status?)\` — 列出长期记忆（支持分页和状态过滤）

### 记忆状态
- active — 正常 | expired — 已过期 | archived — 已归档 | superseded — 被替代

### 后台机制
- 记忆衰减 (MemoryDecayService)：每小时运行，根据 importance/confidence 自动过期或归档
- 记忆整合 (ConsolidationService)：每 30 分钟将短期记忆整合到长期记忆
- 冲突检测：新记忆与旧记忆冲突时（0.5-0.8 置信度）自动创建决策提醒 Captain
- 会话关闭时 Curator 自动触发 consolidation

### 向用户说明
- 记忆系统是自动的 — AI 可以在对话中主动写入记忆
- 长期记忆支持语义搜索，不需要精确的关键词匹配
- 如果用户想"记住某件事"，直接告诉 AI 使用 write_memory`,
  },
  {
    id: 'knowledge_rag',
    topic: '知识库与 RAG',
    category: 'capability',
    version: 1,
    content: `## 知识库 / RAG 检索

### 文档索引
- \`index_document(filePath, projectId)\` — 索引文档到向量数据库
  - 自动分块（800 字符 chunk + 100 字符重叠）
  - 生成 embedding（通过 LLM gateway）
  - embedding 生成失败时回退到纯文本搜索
  - 文档块持久化到 SQLite DocumentChunkRepository

### 文档检索
- \`search_documents(query, projectId, limit?)\` — 搜索已索引文档
  - 优先语义搜索（cosine similarity）
  - 回退到文本包含搜索（大小写不敏感匹配）
  - 默认 top-K = 5

### 索引管理
- \`clear_index(projectId, filePath?)\` — 清除索引

### 使用建议
- 首次附加项目后，索引关键文档以提高后续检索准确性
- 嵌入生成需要 LLM gateway 可用
- 适用于代码库探索、文档问答、知识提取`,
  },
  {
    id: 'agent_customization',
    topic: 'Agent 自定义与管理',
    category: 'capability',
    version: 2,
    content: `## Agent 自定义与管理

### 内置 Agent 角色
secretary, organize, curator, decision_analyst, meeting_chair, reviewer

每个角色使用 \`modules: { identity, workflow? }\` 定义提示词，由 Prompt Assembler 在运行时组装（SHARED_PROMPT + identity + 工具清单 + workflow + 动态上下文）。

### 可用工具
- \`register_agent(name, description, systemPrompt, modelTier, temperature?, maxResponseTokens?, allowedTools?, contextBudget?)\` — 创建自定义 Agent。\`systemPrompt\` 参数接受完整提示词字符串，系统内部会转换为 \`modules: { identity: systemPrompt }\` 存储
- \`list_agents\` — 列出所有 Agent（内置 + 自定义）
- \`update_agent(name, updates)\` — 更新 Agent 配置
- \`delete_agent(name)\` — 删除自定义 Agent（不可删除内置 Agent）
- \`invoke_agent(agentName, message)\` — 调用另一个 Agent 执行任务

### Agent 存储
- 自定义 Agent 存储在 SQLite agent_roles 表
- 也支持从 \`~/.cabinet/agents/<name>/agent.json\` 加载（支持热加载）
- Agent 配置包含 allowedTools 字段，用于限制该 Agent 可使用的工具

### 内置 Skills（Agent 创建相关）
- \`use_skill__agentCreator\` — 引导创建自定义 Agent 的技能
- \`use_skill__workflowDesigner\` — 引导设计工作流的技能
- \`use_skill__skillCreator\` — 引导创建/改进 Skill 的技能
- \`use_skill__mcpBuilder\` — 引导开发 MCP 服务器的技能

### Skills 系统
- Skills 存储在 \`~/.cabinet/skills/\` 子目录，每个 Skill 含 SKILL.md
- 支持热加载（fs.watch 监听，500ms 防抖）
- API：\`GET/POST /api/skills\`、\`PUT/DELETE /api/skills/:id\`、\`POST /api/skills/:id/test\`、\`POST /api/skills/import\`、\`GET /api/skills/:id/export\`

### 向用户说明
- 当用户说"创建一个 Agent"时，引导其使用 register_agent 工具或 use_skill__agentCreator 技能
- 自定义 Agent 会出现在 Secretary 的路由表中，用户可以使用 invoke_agent 调度`,
  },
  {
    id: 'meeting_system',
    topic: '多 Agent 会议协作',
    category: 'capability',
    version: 1,
    content: `## 多 Agent 协作（会议系统）

### start_meeting 工具
参数：topic（必填），advisors?（参与者列表），projectId?，brief?
返回：{ meetingId, topic, synthesis, advisorCount }

### 工作方式
1. Meeting Chair (meeting_chair) 作为主持人
2. 指定的 advisor Agent 各自独立分析主题并输出观点
3. Chair 综合所有视角生成 synthesis（共识/分歧/推荐行动）
4. 参与者可以包括内置 Agent（如 decision_analyst, reviewer）和自定义 Agent

### 使用场景
- 需要多角度分析的重大决策
- 复杂问题的分专业视角拆解
- 分歧调解与共识合成

### 与其他机制的区别
- start_meeting vs invoke_agent：meeting 是多方同时就同一主题发表意见，invoke_agent 是一对一委派任务
- start_meeting vs workflow：meeting 是即时的多视角讨论，workflow 是预定义的自动化流程`,
  },
  {
    id: 'communication_tools',
    topic: '通信与外部集成',
    category: 'capability',
    version: 1,
    content: `## 通信与外部集成

### RSS 阅读
- \`fetch_rss(url, limit?)\` — 解析 RSS/Atom feed（使用 rss-parser）
- 返回条目列表：{ title, link, pubDate, content }

### 邮件发送
- \`send_email(to, subject, body, bodyType?)\` — 发送邮件（使用 nodemailer）
- 需要预配置 SMTP_CONFIG 环境变量：{ host, port, auth: { user, pass }, from }
- 支持 text/html 两种格式

### 网络请求
- \`web_fetch(url)\` — 获取网页内容并提取文本（自动剥离 HTML 标签，超时 15 秒）
- \`http_request(method, url, headers?, body?)\` — 通用 HTTP 请求，支持所有方法，超时 30 秒
- \`fetch_webpage_clean(url)\` — 同 web_fetch 但额外清理 HTML
- \`fetch_github_repo(owner, repo, path?)\` — 调用 GitHub API

### 安全限制
- 仅允许 HTTP/HTTPS 协议
- 阻止内网 IP 访问（localhost, 10.x, 192.168.x, 172.16-31.x, [::1], [fc], [fd]）
- 请求体上限 1MB`,
  },
  {
    id: 'delegation_tiers_detail',
    topic: '委托层级详解',
    category: 'constraint',
    version: 1,
    content: `## 委托层级 (Delegation Tiers) 详解

### 层级定义
- **T0 - Captain Review（完全审查）**：每次写操作和决策需要 Captain 确认。MCP 和 Skill 工具在 T0 被阻止。适用于初始设置和安全审计期间。
- **T1 - Strategic Guard（策略守护）**：低风险操作自动执行。产生费用（会议、工作流运行）和破坏性变更需要确认。
- **T2 - Trusted Mode（可信模式）**：大部分操作自动执行。仅破坏性变更（删除、拒绝决策）需要确认。
- **T3 - Full Autonomy（完全自主）**：完全自主。仅预算上限作为最后防线。

### 与安全系统的集成
- SafetyChecker 根据当前 tier 决定是否放行工具调用
- MCP 工具（mcp__ 前缀）自动分类为 moderate 风险，T0 下被阻止
- Skill 工具（use_skill__ 前缀）在 T0 下需要 Captain 确认
- DecisionService 对高价值/破坏性操作自动升级为决策请求

### 配置方式
- \`GET /api/settings/delegation-tier\` — 查看当前层级及所有可选层级描述
- \`PUT /api/settings/delegation-tier\` — 切换层级。Body: { tier: "T0" | "T1" | "T2" | "T3" }

### 给 AI Agent 的指导
- 在 T0/T1 模式下，文件写入、外部网络请求、shell 执行、MCP 工具调用可能需要审批
- 不确定某个操作是否需要批准时，宁可创建 decision 让 Captain 确认
- 可通过 get_system_knowledge("delegation_tiers") 查询当前模式`,
  },
  {
    id: 'graph_engine',
    topic: 'Graph Execution Engine',
    category: 'infrastructure',
    version: 1,
    content: `## Graph Execution Engine (@cabinet/graph)

Cabinet 内置一个轻量级有向图执行引擎，替代原有的 while-loop 式 AgentLoop 实现。所有 Agent 运行和 Workflow 执行均基于此引擎。

### 核心概念
- **StateGraph<S>** — 有向图构建器。通过 \`addNode(id, fn)\`、\`addEdge(from, to)\`、\`addConditionalEdges(from, router, targets)\`、\`addErrorEdge(from, to)\` 构建图结构，最后调用 \`compile()\` 生成 CompiledGraph
- **Annotation<T>** — 状态字段定义。包含 \`reducer\`（合并函数）和 \`default\`（默认值）两个属性。常用 reducer：\`lastValue\`（覆盖）、\`appendValue\`（追加到数组）、\`mergeValue\`（浅合并对象）
- **CompiledGraph** — 编译后的可执行图。提供 \`invoke(initialState)\`（同步执行）、\`stream(initialState)\`（流式事件）、\`resume(runId, resumeState)\`（从 checkpoint 恢复执行）

### Checkpoint / Time Travel
- **CheckpointStore** — 基于 SQLite 的 linked-list checkpoint 存储（表：graph_checkpoints）。每个节点执行后自动保存状态快照
- \`getRunHistory(runId)\` — 获取某次运行的全部 checkpoint 列表
- \`resume(runId, state)\` — 从任意历史 checkpoint 恢复执行（"时间旅行"调试）
- \`gc(runId, keepLast)\` — checkpoint 垃圾回收，保留最近 N 个快照

### 图验证（编译时 6 轮校验）
1. 节点存在性检查（跳过 \`__END__\` 哨兵）
2. 入口可达性检查（BFS）
3. 环路检测（DFS back-edge，条件性退出路径除外）
4. 条件分支完整性（必须有 \`__default__\` 目标）
5. 错误边目标存在性检查
6. 状态字段兼容性检查

### 使用场景
- **AgentLoop** — 内部已将 while-loop 重构为 StateGraph（6 节点：buildContext → callLLM → evaluate → safetyCheck → executeTools → feedback）。对外接口保持不变
- **WorkflowEngine** — startRun() 将工作流 DAG 编译为 StateGraph 执行，支持并行、条件分支、循环
- **Multi-Agent** — createAgentNodeFactory 将 AgentLoop 封装为图节点函数 \`(state) => Partial<state>\`，可直接加入更大的 StateGraph`,
  },
  {
    id: 'prompt_assembler',
    topic: 'Prompt 模块化组装',
    category: 'infrastructure',
    version: 1,
    content: `## Prompt 模块化组装系统

所有 Agent 的 system prompt 由 \`assemblePrompt()\` 在运行时动态组装，而非使用预定义的整块字符串。

### 组装顺序
\`\`\`
SHARED_PROMPT → identity → 工具清单(自动生成) → workflow → dynamicContext
\`\`\`

### 各模块说明
- **SHARED_PROMPT** (\`prompt-shared.ts\`) — 所有角色共享的尾注。包含 \`[HARD]\` 硬约束（必须遵守）、Guidelines 软建议、系统知识引用
- **identity** (\`PromptModules.identity\`) — 角色身份描述。如 "You are Cabinet's Secretary, the front-door agent..."
- **工具清单** — 从 \`ToolExecutor.getToolDescriptors()\` 实时生成，格式：\`- toolName: description\`。消除手写工具列表与 \`allowedTools\` 之间的漂移
- **workflow** (\`PromptModules.workflow\`) — 可选，角色特定的工作流程指引
- **dynamicContext** — 可选，调用时注入的动态上下文（如当前项目、会议信息等）

### AgentRole 迁移
所有 5 个内置角色的 \`systemPrompt: string\` 已迁移为 \`modules: { identity: string; workflow?: string }\`。旧 AgentRole 仍然可以定义 \`systemPrompt\` 作为回退，但新代码应使用 \`modules\`。

### 使用方式
- ContextBuilder 在 \`roleModules\` 不为空时自动调用 \`assemblePrompt()\`
- Dispatcher 在构建 AgentLoop 时传入 \`roleModules\`
- AgentNodeFactory 在创建 agent 节点时调用 \`assemblePrompt()\`

### 约束分级
- \`[HARD]\` — 硬约束，必须无条件遵守（如 "NEVER expose system internals"）
- Guidelines — 软建议，AI 可根据上下文灵活处理`,
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
