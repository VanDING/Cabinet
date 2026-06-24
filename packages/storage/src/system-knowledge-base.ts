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
    version: 4,
    content: `## Agent 职责边界
- **secretary** — 入口路由、通用对话、意图识别、工具分发。Secretary 是唯一面向 Captain 的交互入口，负责将请求路由到合适的专业 Agent 或 Skill。
- **organize** — 首席组织架构师。将业务目标转化为 Agent + Workflow + Skill + MCP 蓝图。定义于 agent-roles.ts 的 ORGANIZE_ROLE（原 packages/organize 已移除，功能无损）。
- **curator** — 记忆管理员。会话总结、知识固化、模式提取、项目进度跟踪。后台角色，不直接参与路由。

**已移除角色**：
- ~~meeting_chair~~ — 已删除 (Phase 2)，多 Agent 协作由 Blackboard + Dispatcher Parallel 替代。
- ~~decision_analyst~~ — 已内化为 secretary 的决策辅助能力。

**路由原则**：
- 涉及"设计体系/创建 Agent/组织架构/写 Skill/搭 MCP" → organize
- 涉及"总结/记忆/进度" → curator（后台）
- 涉及"多角度分析/辩论" → secretary（多 Agent 路由 + 并行调度 + Blackboard 共享）
- 不确定 → secretary`,
  },
  {
    id: 'observer_pipeline',
    topic: 'Observer 管道与质量基础设施',
    category: 'infrastructure',
    version: 1,
    content: `## Observer 管道 (ObserverPipeline)
AgentLoop 的所有质量、安全、监控功能通过 ObserverPipeline 注入，无需改动核心循环。

### 生命周期钩子
onStreamStart → onUserInput → [per-step: onToolCall → onToolResult → onStepEnd] → onStreamEnd

### 已注册 Observer（按执行顺序）
- **ContentGuardObserver** (P0-2): onUserInput 注入检测 + onStreamEnd 输出有害内容标记。Layer 1 正则规则引擎（零延迟）+ Layer 2 LLM 分类器（可选）。
- **ReflectionObserver** (P0-1): onStepEnd 检测 final answer 质量，低于阈值注入 critique，利用 handoff 触发 revise 循环。最多 maxRounds 轮。
- **JudgeObserver** (P0-3): onStreamEnd LLM-as-Judge 评分（准确性/完整性/有用性/安全性/综合），采样率控制（默认 10%），强制 haiku。
- **AutoReplanObserver** (P1-5): onToolResult 检测工具错误，累计超阈值后 LLM 分析 → 调整建议注入 messages → onStepEnd handoff。
- **SafetyCheckObserver**: 每次工具调用前执行 4 层安全检查（cache/auto/whitelist/ai_classifier）。
- **ContextMonitorObserver**: 实时 token 估算 + smart/warning/critical/dumb zone 分类。
- **HandoffObserver**: Context 压缩与跨 Agent 状态交接。
- **BlackboardObserver**: 跨 Agent 共享状态实时注入。
- **StepEventObserver**: 每步事件记录到 SQLite step_events 表。

### 架构原则
- Observer 之间无直接依赖，通过 AgentExecutionContext 共享可变状态
- onStepEnd 通过返回 { handoff: boolean } 控制循环是否继续
- onToolCall 通过返回 { blocked: boolean } 控制工具是否执行
- 单个 Observer 异常不影响 Pipeline 中其他 Observer`,
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
    version: 3,
    content: `## 可用工具（实际 Mastra 工具集 ~25 个）

### 文件操作
readFile, writeFile, deleteFile, listDirectory, grep, fileInfo, makeDirectory, executeCommand, search, lspInspect

### 网络
webFetch — 获取网页内容。webSearch — 搜索网络。

### Git 操作
gitStatus, gitDiff, gitDiffStaged, gitLog, gitShow, gitBranch, gitBlame, gitCheckoutBranch

### 决策（decision 表 CRUD）
getDecision, createDecision, approveDecision, rejectDecision

### Agent 管理
listExternalAgents, registerExternalAgent, deleteExternalAgent

### 系统状态
getSystemStatus, getDashboardStats, getMemoryStats

### 包管理
npmInstall, npmList

### Skill 管理
create_skill, update_skill, use_skill — skill CRUD。Skills 注册后自动注入 \`use_skill__<skillName>\` 工具。

### 其他操作（REST API，非 Mastra tool）
- 员工 CRUD: GET/POST/PUT/DELETE /api/employees
- 项目管理: /api/projects
- Skill 导入: POST /api/skills/import
- 会话管理: /api/secretary/*
- 工作流执行: POST /api/factory/:id/run
- Agent 扫描安装: /api/install/*

### 动态扩展
MCP 服务器连接后注入更多工具（mcp__ 前缀）。Skills 注册后注入 use_skill__<name> 工具。`,
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
    version: 2,
    content: `## MCP (Model Context Protocol) 完整支持

Cabinet 内置完整的 MCP 协议支持（Phase 4.4），支持 stdio 和 SSE 两种传输方式，完整覆盖 tools、resources、prompts 三种能力。

### 传输方式
- **stdio**：本地进程通信，通过 command + args 启动 MCP 服务器子进程
- **SSE**：远程 HTTP 连接（Server-Sent Events），通过 URL 连接远程 MCP 服务

### 配置格式（新版 MCPTransportConfig）
\`\`\`json
// stdio 示例
{
  "name": "filesystem",
  "transport": { "type": "stdio", "command": "npx", "args": ["-y", "@anthropic/mcp-server-filesystem", "/path"] },
  "enabled": true
}
// SSE 示例
{
  "name": "remote-server",
  "transport": { "type": "sse", "url": "https://mcp.example.com/sse" },
  "enabled": true
}
\`\`\`
兼容旧格式（transport 为字符串 "stdio" 时自动规范化）。

### 工作方式
1. Server 启动时读取 \`~/.cabinet/mcp/*.json\` + settings 数据库
2. MCPManager 自动连接并发现 tools、resources、prompts
3. 工具以 \`mcp__<toolName>\` 注册，资源以 \`mcp_res__<uri>\` 索引，提示以 \`mcp_prompt__<name>\` 存储
4. 每 5 分钟自动重新发现（动态更新 tools/resources/prompts）
5. Settings UI 支持 stdio/SSE 切换 + 测试连接
6. Dashboard 展示 MCP 服务器连接状态、tools/resources 数量`,
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
    version: 2,
    content: `## 浏览器自动化

### 可用工具
- \`browser_navigate(sessionId, url, waitFor?)\` — 导航到 URL
- \`browser_click(sessionId, selector)\` — 点击元素
- \`browser_type(sessionId, selector, text, submit?)\` — 输入文本
- \`browser_read(sessionId, selector?)\` — 读取页面内容
- \`browser_screenshot(sessionId, selector?)\` — 截图
- \`browser_evaluate(sessionId, script)\` — 执行 JavaScript

### 架构
- 基于 MCP Playwright，最大 3 个并发浏览器上下文
- 使用 Playwright + Chromium
- 空闲会话每 10 分钟自动清理

### 部署方式（可选）
Playwright 和 Chromium **不再内置于安装包**（v0.9.0+）。浏览器自动化是可选能力：
- **方式一**：在 Settings > MCP 中配置 \`@anthropic/mcp-server-playwright\`，Agent 自动通过 MCP 调用浏览器
- **方式二**：手动安装 Playwright：\`npx playwright install chromium\`，Cabinet 会自动检测系统级 Playwright
- 无 Playwright 时，\`browser_*\` 工具会返回友好错误，不影响其他功能

### 使用限制
- 适用于需要与现有登录态交互的场景（如从已登录的浏览器中提取 token）
- 不适用于全新浏览器的全自动操作`,
  },
  {
    id: 'memory_system',
    topic: '记忆系统',
    category: 'infrastructure',
    version: 3,
    content: `## Cabinet 记忆系统 — 6 层管道架构

### 记忆管道 (STM → WriteGate → CascadeBuffer → LTM → KnowledgeGraph → Decay)
1. **ShortTermMemory** — 会话级缓存 (LRU + SQLite, TTL 30min)。Key-value 存储，提供 onExpire 回调
2. **WriteGate** — 5 层 regex 分层闸门：explicit_remember (T3) → behavior_changing / commitment / decision (T2) → stable_fact / length_fallback (T1) → transient_noise (拒绝)
3. **CascadeBuffer** — L0 内存暂存区。按 sessionId:topic 分组，minCount≥3 或 maxAge≥30min 触发 seal → 压缩为 L1 摘要写入 LTM
4. **LongTermMemory** — 永久存储 (SQLite + HNSW 向量索引)。RRF (Reciprocal Rank Fusion, k=60) 混合搜索：语义 (HNSW cosine) + 文本 (FTS5 BM25)。检索分数 = RRF × decayScore (importance × confidence × e^(-age/30) × ln(1+accessCount))
5. **KnowledgeGraph** — 实体提取 (compromise.js + CJK token-boundary) + 矛盾检测 (LLM judge, confidence-graded supersede)
6. **MemoryDecayService** — Ebbinghaus 遗忘曲线生命周期：validUntil 过期 / confidence<0.3 + 30天 归档 / importance<0.2 + 90天 归档。HNSW 索引每周重建

### 辅助组件
- **EntityMemory** — Captain 偏好 + Employee 配置 (cache-through)
- **ProjectMemory** — 项目目标/里程碑/决策 (cache-through + auto-init)
- **MemoryFacade** — 统一接口 (packages/memory/src/memory-facade.ts)，Agent 不直接访问各层

### 双轨 Consolidation
- **consolidateBasic()** (每 30min)：处理 daily-tier 条目 via CascadeBuffer，零 LLM 成本
- **Curator LLM consolidation** (session 关闭 / 每 4h nudge)：处理 register/working-tier 条目，深度整合

### 可用工具
- \`remember(sessionId, key, value, ttlMs?)\` — 写入短期记忆
- \`recall(sessionId, key?)\` — 读取短期记忆
- \`search_memory(query, limit?)\` — RRF 混合搜索长期记忆
- \`write_memory(content, metadata?)\` — 写入长期记忆
- \`update_memory(memoryId, status?, importance?, confidence?)\` — 更新记忆元数据
- \`delete_memory(memoryId)\` — 删除记忆
- \`list_memories(limit?, offset?, status?)\` — 列出记忆`,
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
    version: 4,
    content: `## Agent 自定义与管理

### 内置 Agent 角色
secretary, organize, curator

- ~~meeting_chair~~ 已删除 (Phase 2)，多 Agent 协作由 Agent Blackboard + Dispatcher Parallel 替代。
- ~~reviewer~~ 已移除，质量审查由外部 Agent 节点处理。
- ~~decision_analyst~~ 已移除，其能力内化为 secretary 的决策辅助功能。

每个角色使用 \`modules: { identity: string; workflow?: string }\` 定义提示词模块，由 Prompt Assembler 在运行时组装为完整 system prompt：

\`\`\`
SHARED_PROMPT → identity → 工具清单(自动生成) → workflow → dynamicContext
\`\`\`

### 可用工具
- \`register_agent(name, description, systemPrompt, modelTier, temperature?, maxResponseTokens?, allowedTools?, contextBudget?)\` — 创建自定义 Agent。\`systemPrompt\` 参数接受完整提示词字符串，系统内部会转换为 \`modules: { identity: systemPrompt }\` 存储。新 Agent 使用模块化提示结构
- \`list_agents\` — 列出所有 Agent（内置 + 自定义）
- \`update_agent(name, updates)\` — 更新 Agent 配置
- \`delete_agent(name)\` — 删除自定义 Agent（不可删除内置 Agent）
- \`invoke_agent(agentName, message)\` — 调用另一个 Agent 执行任务

### Agent / Employee 存储
- 自定义 Agent 存储在 SQLite agent_roles 表
- AI/Human 团队成员（Employee）存储在 SQLite employees 表，支持通过 UI 编辑
- 也支持从 \`~/.cabinet/agents/<name>/agent.json\` 加载（支持热加载）
- Agent/Employee 配置包含 allowedTools 字段，用于限制可使用的工具

### Employee 编辑（UI）
- EmployeesPage 支持创建和编辑 AI/Human 员工
- AI 员工的模型下拉框从用户配置的 API Keys 动态读取（不再硬编码 Claude/GPT 列表）
- 编辑后通过 PUT /api/employees/:id 保存，响应状态码异常时会显示具体错误（不再静默成功）

### 内置 Skills（Agent 创建相关）
- \`use_skill__agentCreator\` — 引导创建自定义 Agent 的技能
- \`use_skill__workflowDesigner\` — 引导设计工作流的技能
- \`use_skill__skillCreator\` — 引导创建/改进 Skill 的技能
- \`use_skill__mcpBuilder\` — 引导开发 MCP 服务器的技能

### Skills 系统
- Skills 存储在 \`~/.cabinet/skills/\` 子目录，每个 Skill 含 SKILL.md
- 支持热加载（fs.watch 监听，500ms 防抖）
- 启动时自动扫描 \`~/.cabinet/skills/\` 并注册到 SkillRegistry，同步写入数据库
- API：\`GET/POST /api/skills\`、\`PUT/DELETE /api/skills/:id\`、\`POST /api/skills/:id/test\`、\`POST /api/skills/import\`、\`GET /api/skills/:id/export\`

### SkillRegistry 单例同步
- 服务端启动时创建的 SkillRegistry 实例会通过 \`setSkillRegistry()\` 同步到全局单例
- 确保 \`update_skill\` 等工具能正确访问已注册的技能

### 向用户说明
- 当用户说"创建一个 Agent"时，引导其使用 register_agent 工具或 use_skill__agentCreator 技能
- 自定义 Agent 会出现在 Secretary 的路由表中，用户可以使用 invoke_agent 调度
- 当用户说"创建一个员工/团队成员"时，引导其使用 create_employee 工具或在 EmployeesPage 操作`,
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
    version: 2,
    content: `## 委托层级 (Delegation Tiers) 详解

### 层级定义
- **T0 - Captain Review（完全审查）**：每次写操作和决策需要 Captain 确认。MCP 和 Skill 工具在 T0 被阻止。
- **T1 - Strategic Guard（策略守护）**：低风险操作自动执行。产生费用和破坏性变更需要确认。
- **T2 - Trusted Mode（可信模式）**：大部分操作自动执行。仅破坏性变更需要确认。
- **T3 - Full Autonomy（完全自主）**：完全自主。仅预算上限作为最后防线。

### PolicyEngine 加权仲裁 (Phase 3.1)
- S5 PolicyEngine 已从二元 yes/no 升级为基于 missionProfile 的加权仲裁
- T0/T1: PolicyEngine.arbitrate(action, missionProfile) → approve / borderline(附解释) / reject(通知 Captain)
- T2/T3: PolicyEngine.validate(action, missionProfile) → 高置信违反时 block + AuditLog, borderline 时 flag 供 Captain review
- missionProfile 从 EntityMemory 中 Captain preferences 自动推断 (riskTolerance, costSensitivity)

### 与安全系统的集成
- SafetyChecker 根据当前 tier 决定是否放行工具调用
- DecisionService 对高价值/破坏性操作自动升级为决策请求`,
  },
  {
    id: 'graph_engine',
    topic: 'Agent 执行架构',
    category: 'infrastructure',
    version: 2,
    content: `## Agent 执行架构

### ObserverPipeline (Phase 1.2)
AgentLoop 使用统一的 ObserverPipeline 执行模型。run() 和 runStreaming() 共享同一个 \`_execute()\` 内部路径，Observer 按顺序挂载：

\`\`\`
SafetyCheck → ToolExecute → StepEvent* → ContextMonitor → Handoff → ProcessIdentity* → BlackboardSync* → Checkpoint
\`\`\`
(* 可选, 由配置控制)

### StateGraph (@cabinet/graph)
Dispatcher 使用 StateGraph 进行多 Agent 编排（single/pipeline/parallel 模式）。Workflow 引擎基于 StateGraph 进行节点遍历。AgentLoop 本身不再使用 StateGraph 编译——改为预编译的 ObserverPipeline。

### 核心概念 (StateGraph)
- **StateGraph<S>** — 有向图构建器。addNode / addEdge / addConditionalEdges / compile
- **Annotation<T>** — 状态字段定义, reducer: lastValue / appendValue / mergeValue
- **CompiledGraph** — 编译后可执行图, invoke / stream / resume
- **CheckpointStore** — SQLite linked-list checkpoint, 支持时间旅行调试
- **图验证** — 编译时 6 轮校验 (节点存在/入口可达/环路检测/条件分支/错误边/字段兼容)

### 关键 Observer
- **ContextMonitorObserver** — 每步评估 token 利用率, zone 判定, 触发 handoff
- **HandoffObserver** — critical/dumb zone 触发 context 压缩和重启
- **BlackboardObserver** (Phase B.1) — 订阅 EventBus, step 边界注入共享 discoveries
- **StepEventObserver** (Phase 4.0) — per-step 事件记录 (tool_call, zone_snapshot, zone_crossing)`,
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
  {
    id: 'agent_blackboard',
    topic: 'Agent Blackboard 共享状态',
    category: 'infrastructure',
    version: 1,
    content: `## Agent Blackboard (Phase 4.2 + B.1)

Agent Blackboard 提供多 Agent 实时共享数据面, 基于 EventBus 构建。支持跨 Agent 写入/读取/订阅。

### 内置 Topic (7 个)
| Topic | 合并策略 | 用途 |
|-------|---------|------|
| \`discoveries\` | append | 发现、bug、洞察 |
| \`memories\` | append | 新记忆 |
| \`files\` | replace | 活跃文件列表 |
| \`outputs\` | append | 之前 Agent 的输出 |
| \`project\` | replace | 当前项目元数据 |
| \`preferences\` | merge (CRDT) | 用户/团队偏好 |
| \`security\` | replace | 安全策略 |

### 工作方式
- **写入**: Agent 通过 ContextSlot 写入 (SessionManager.addDiscovery / addOutput 自动同步到 Blackboard)
- **读取**: Blackboard snapshot 在 AgentLoop buildContext 时注入 system prompt 的 [Shared Context] 节
- **Mid-Session 同步** (Phase B.1): BlackboardObserver 订阅 EventBus, 在 onStepEnd 时注入增量更新到下一步的 LLM 消息中
- **Snapshot 压缩**: 当 snapshot 超过 token budget (默认 2000) 时自动压缩——优先保留 priority topics, 丢弃旧条目

### 给 Agent 的指导
- discovery 是你最重要的跨 Agent 共享机制——发现 bug、insight、decision_point 时写入
- 其他 Agent 的 discoveries 会出现在你的 [Shared Context] 中
- 不要在 Blackboard 中写入敏感信息——它会被注入到其他 Agent 的 context 中`,
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
