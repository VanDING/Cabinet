# Cabinet 完整开发文档 v2.0

> **产品名称**：Cabinet  
> **核心哲学**：Can do everything, but should do one thing.  
> **技术栈**：TypeScript 全栈 + Tauri 桌面端  
> **开发策略**：分层递进，从底层基础设施到上层用户界面，每层产出完整、可独立验证的模块。先跑通全栈骨架，再逐层丰富血肉。

---

## 一、项目概述

### 1.1 产品定位

Cabinet 是为超级个体和一人公司打造的开源AI协作框架。用户是 **Captain**，系统是 Captain 的内阁团队。核心价值在于：系统在内部消化大部分决策噪音，只把方向、边界和例外提交给 Captain。最终理想是用户只需做决策确认。

### 1.2 核心原语

| 原语             | 定义                                                                  |
| :--------------- | :-------------------------------------------------------------------- |
| **Organization** | Captain的"一人公司"实例，顶层命名空间                                 |
| **Project**      | 围绕特定业务目标组织所有活动的容器                                    |
| **Employee**     | 可调度单元，行为管道 + 人格外衣双层模型（AI管道 / HumanNode两种形态） |
| **Skill**        | 原子化能力单元，采用 SKILL.md 标准定义，可创建、注册、发现、组合      |
| **Workflow**     | 定义多个 Employee/Skill 之间的协作流程                                |
| **Decision**     | 需要 Captain 介入的决策点，不可变，有审计链。分为 L0-L3 四级授权      |
| **Memory**       | 四层记忆：短期/长期/实体/项目，各层职责明确无重叠                     |

### 1.3 核心界面

| 界面          | 定位                                  |
| :------------ | :------------------------------------ |
| **Dashboard** | 默认首页，全局状态感知 + 轻量决策入口 |
| **Cabinet**   | 秘书对话与会议室界面                  |
| **Office**    | 决策深度审阅与裁决                    |
| **Factory**   | 工作流配置与运行                      |

---

## 二、技术选型

| 维度         | 选型                           | 理由                                                                         |
| :----------- | :----------------------------- | :--------------------------------------------------------------------------- |
| **语言**     | TypeScript 5.x                 | 前后端统一，LLM SDK 覆盖完整，AI 工具生成代码质量高                          |
| **运行时**   | Node.js 22+                    | 适合 I/O 密集型 LLM 调用，原生 ESM 支持                                      |
| **包管理**   | pnpm + monorepo                | 高效管理多包依赖                                                             |
| **后端框架** | Hono + Zod                     | 高性能 HTTP 服务，类型安全校验                                               |
| **API 协议** | REST + WebSocket               | REST 用于 CRUD 和审批，WebSocket 用于实时推送                                |
| **桌面端**   | Tauri 2.x                      | 打包为原生桌面应用，内置自动更新支持                                         |
| **前端框架** | React 19 + Vite                | 快速构建交互式界面                                                           |
| **UI 组件**  | Radix UI + Tailwind CSS        | 可定制、无障碍、暗色模式友好                                                 |
| **LLM 接入** | Vercel AI SDK + 自研轻量路由层 | 纯 TypeScript，零外部运行时依赖；统一接口适配 Anthropic/OpenAI/Google 等 SDK |
| **主存储**   | SQLite（better-sqlite3）       | 本地优先、零配置、WAL 模式                                                   |
| **向量存储** | hnswlib-node (HNSW)            | 基于 HNSW 算法的本地向量索引，纯 TypeScript/Node.js，无外部服务依赖         |
| **测试**     | Vitest + Playwright            | 单元测试 + E2E                                                               |
| **CI/CD**    | GitHub Actions                 | 自动化测试与构建                                                             |

### 2.1 技术选型说明：为什么不用 Python/LiteLLM

LiteLLM 是优秀的 Python 多模型网关，但在全栈 TypeScript 项目中引入 Python 运行时会导致：

- 桌面应用打包需捆绑 Python，安装包体积膨胀且增加平台兼容性问题
- 两套依赖管理体系（pip + pnpm），版本同步和错误排查复杂度翻倍
- 调试链路跨越两个语言运行时

替代方案：**Vercel AI SDK** 提供统一的 `generateText` / `streamText` 接口，已适配 Anthropic、OpenAI、Google、DeepSeek、Qwen、Moonshot、Zhipu、Baichuan 等 8 家主流提供商。自研轻量路由层（`ModelRouter`）在此基础上按角色分流模型，保持接口统一。此方案零外部运行时依赖，与 Tauri 桌面端打包兼容。

---

## 三、项目结构

```
cabinet/
├── pnpm-workspace.yaml
├── package.json                      # 根配置
├── tsconfig.base.json                # 共享 TS 配置
├── apps/
│   ├── desktop/                      # Tauri 桌面端
│   │   ├── src-tauri/               # Rust 壳（Tauri 原生）
│   │   ├── src/                     # React 前端
│   │   └── package.json
│   └── server/                       # Node.js 后端服务
│       ├── src/
│       │   ├── index.ts             # 入口
│       │   ├── routes/              # API 路由
│       │   └── middleware/          # 中间件
│       └── package.json
├── packages/
│   ├── types/                        # @cabinet/types
│   │   ├── src/
│   │   │   ├── index.ts             # 导出所有类型
│   │   │   ├── primitives.ts        # 核心原语：Organization, Project, Employee, Skill, Workflow, Memory
│   │   │   ├── decisions.ts         # Decision, DecisionType, DecisionStatus, DecisionLevel(L0-L3)
│   │   │   ├── events.ts            # MessageEnvelope, MessageType, payload 类型
│   │   │   └── boundaries.ts        # 硬限制常量
│   │   └── package.json
│   ├── events/                       # @cabinet/events
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── bus.ts               # EventBus 接口
│   │   │   ├── sqlite-store.ts      # SQLite 持久化实现
│   │   │   ├── memory-bus.ts        # 内存实现（测试用）
│   │   │   └── causation.ts         # 因果链追踪
│   │   └── package.json
│   ├── storage/                      # @cabinet/storage
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── connection.ts        # SQLite 连接池
│   │   │   ├── migrations/          # 迁移脚本
│   │   │   ├── backup.ts            # 自动备份与恢复
│   │   │   └── repositories/        # 数据访问层
│   │   │       ├── organization.ts
│   │   │       ├── project.ts
│   │   │       ├── employee.ts
│   │   │       ├── decision.ts
│   │   │       ├── skill.ts
│   │   │       └── event-log.ts
│   │   └── package.json
│   ├── gateway/                      # @cabinet/gateway
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── llm-gateway.ts       # LLM 网关接口（generateText, streamText, listModels）
│   │   │   ├── ai-sdk-adapter.ts    # Vercel AI SDK 适配器
│   │   │   ├── model-router.ts      # 模型路由（角色→模型映射）
│   │   │   ├── fallback.ts          # 回退链
│   │   │   ├── cost-tracker.ts      # 成本追踪
│   │   │   └── budget-guard.ts      # 预算管控（日/周/月上限 + 告警）
│   │   └── package.json
│   ├── agent/                        # @cabinet/agent
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── agent-loop.ts        # TAOR 核心循环
│   │   │   ├── context-builder.ts   # 上下文构建器
│   │   │   ├── checkpoint.ts        # 检查点保存与恢复
│   │   │   ├── tool-executor.ts     # 工具调用执行器
│   │   │   ├── retry.ts             # 重试策略（指数退避，按错误类型分类处理）
│   │   │   └── safety.ts            # 运行时四级安全检查
│   │   └── package.json
│   ├── memory/                       # @cabinet/memory
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── orchestrator.ts      # MemoryOrchestrator（统一调度四层记忆）
│   │   │   ├── short-term.ts        # 短期记忆（会话上下文，内存缓存 + SQLite）
│   │   │   ├── long-term.ts         # 长期记忆（HNSW 向量索引语义检索）
│   │   │   ├── entity.ts            # 实体记忆（Captain偏好、员工配置）
│   │   │   ├── project.ts           # 项目记忆（项目上下文、里程碑、关键决策）
│   │   │   └── consolidation.ts     # 后台记忆整合
│   │   └── package.json
│   ├── secretary/                    # @cabinet/secretary
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── secretary-agent.ts   # 秘书Agent主逻辑
│   │   │   ├── intent-parser.ts     # 意图解析
│   │   │   ├── decision-card.ts     # 决策卡片生成
│   │   │   ├── session-manager.ts   # 会话管理
│   │   │   └── greeting.ts          # 问候与摘要生成
│   │   └── package.json
│   ├── meeting/                      # @cabinet/meeting
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── meeting-service.ts   # 会议服务
│   │   │   ├── cost-estimator.ts    # 会议成本预估（会前给出Token消耗估算）
│   │   │   ├── debate-protocol.ts   # 辩论协议
│   │   │   ├── parallel-reasoning.ts# 并行推理
│   │   │   └── cross-validator.ts   # 交叉验证
│   │   └── package.json
│   ├── decision/                     # @cabinet/decision
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── decision-service.ts  # 决策管理
│   │   │   ├── level-classifier.ts  # L0-L3 自动分级逻辑
│   │   │   ├── state-machine.ts     # 状态机
│   │   │   ├── escalation.ts        # 分级授权与升级
│   │   │   └── audit-log.ts         # 审计日志
│   │   └── package.json
│   ├── workflow/                     # @cabinet/workflow
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── engine.ts            # 工作流引擎（17 种统一节点类型）
│   │   │   ├── blueprint-validator.ts # 蓝图校验器
│   │   │   ├── condition-evaluator.ts # 条件表达式求值
│   │   │   └── scheduler.ts         # 任务调度器
│   │   └── package.json
│   ├── harness/                      # @cabinet/harness（后执行评估层）
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── evaluator.ts         # 评估者Agent（独立质量评估）
│   │   │   ├── quality-gate.ts      # 质量闸门（H-E-I格式校验、重试判定）
│   │   │   ├── escalation.ts        # 升级协议（质量不达标→通知Captain）
│   │   │   ├── teach-back.ts        # 高风险操作Teach-back确认
│   │   │   ├── observability.ts     # 可观测性采集（指标、追踪、日报）
│   │   │   ├── auto-adjuster.ts     # 自动调参（温度、模型、预算）
│   │   │   ├── preference-learner.ts# Captain 偏好学习
│   │   │   ├── subconscious-loop.ts # 潜意识循环（后台洞察生成）
│   │   │   ├── browser-verifier.ts  # 浏览器验证器
│   │   │   └── garbage-collector.ts # 垃圾回收（孤儿数据清理）
│   │   └── package.json
│   ├── organize/                     # @cabinet/organize（组织架构设计）
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── planner.ts           # 组织蓝图规划器
│   │   └── package.json
│   └── ui/                           # @cabinet/ui（共享UI组件）
│       ├── src/
│       │   ├── index.ts
│       │   ├── decision-card.tsx     # 决策卡片组件
│       │   ├── secretary-chat.tsx    # 秘书对话组件
│       │   ├── dashboard-summary.tsx # Dashboard摘要组件
│       │   ├── workflow-canvas.tsx   # 工作流画布组件
│       │   └── navigation.tsx        # 导航栏组件
│       └── package.json
├── tests/
│   ├── e2e/                          # E2E 测试（Vitest）
│   ├── browser/                      # Playwright 浏览器测试
│   └── bench/                        # 性能基准测试
├── docs/
│   ├── site/                         # VitePress 文档站点
│   │   ├── guide/                    # 用户指南（architecture, development, contributing）
│   │   ├── concepts/                 # 核心概念（agents, decisions, memory-layers）
│   │   └── api/                      # API 文档（secretary, decisions, workflows, meetings, memory, gateway）
│   ├── design-subagent-interaction.md # 子代理交互设计文档
│   ├── signing-guide.md              # Tauri 代码签名指南
│   └── superpowers/                  # 实现计划与规格
│       ├── plans/                    # 开发计划（按日期归档）
│       └── specs/                    # 设计规格（按日期归档）
└── scripts/
    ├── publish.sh                    # 发布脚本
    └── fix-empty-catches.mjs         # 代码修复工具
```

### 3.1 包职责边界（关键区分）

以下三处容易混淆，开发时必须严格遵守职责划分：

| 安全/验证组件                   | 所属包            | 触发时机                       | 职责                                                    |
| :------------------------------ | :---------------- | :----------------------------- | :------------------------------------------------------ |
| `agent/safety.ts`               | @cabinet/agent    | Agent 循环中**每次工具调用前** | 四级安全检查：缓存规则→自动模式→白名单→AI分类器         |
| `harness/quality-gate.ts`       | @cabinet/harness  | Agent **输出完成后**           | 输出质量评估："假设-证据-影响"格式校验，未达标→触发重试 |
| `workflow/blueprint-validator.ts` | @cabinet/workflow | 工作流**蓝图校验**             | 节点连通性、循环检测、schema 校验                       |

**一句话区分**：Agent Safety 管"能不能做"，Harness 管"做得好不好"，Workflow Gate 管"能不能传给下一步"。

---

## 四、第一阶段：基础设施

**目标**：建立系统的"骨骼和神经"——核心类型、事件总线、持久化存储。所有上层模块依赖于此。

### 4.1 @cabinet/types — 核心类型定义

**产出物**：`packages/types/src/`

所有核心原语的 TypeScript 类型定义，是整个系统的类型基础。

**验收标准**：

- 所有原语类型定义完整，有 JSDoc 注释
- 关键接口（EventBus, LLMGateway, ToolRegistry 等）作为 TypeScript interface 导出
- Decision 状态机类型完整（所有状态、转换条件）
- Decision L0-L3 级别枚举定义完整，包含分级判定所需元数据
- Workflow 节点类型定义支持 17 种节点
- 编译无错误

**关键文件**：

_primitives.ts_：Organization, Project, Employee, Skill, Workflow, Memory 等核心实体的类型定义。Employee 需同时支持 AI 管道和 HumanNode 两种形态。

_decisions.ts_：Decision 实体、DecisionType（strategic/action/execution/anomaly/evolution）、DecisionLevel（L0-L3）、DecisionStatus 状态机。

**L0-L3 分级定义**：

| 级别   | 名称     | 判定依据                                                         | 处理方式                                   |
| :----- | :------- | :--------------------------------------------------------------- | :----------------------------------------- |
| **L0** | 自动执行 | 影响范围≤单次工具调用；无副作用或副作用可逆；成本<$0.01          | 静默执行，仅记录日志                       |
| **L1** | 自动决策 | 影响范围限于当前会话；可选方案≤3个且均有明确评估标准；成本<$0.10 | 自动选择最优方案，结果写入会话摘要         |
| **L2** | 确认决策 | 影响跨会话或涉及外部系统；可选方案>3个或存在价值取舍；成本>$0.10 | 生成决策卡片推送 Captain，等待确认         |
| **L3** | 升级决策 | 影响组织级配置或安全边界；涉及资金/权限/数据删除；成本>$1.00     | 立即暂停执行，通过所有可用渠道通知 Captain |

_events.ts_：MessageEnvelope 格式、MessageType 枚举（16 种消息类型）、各类 payload 类型（DecisionRequest, TaskOrder, DeliberationProposal 等）。

_boundaries.ts_：硬限制常量——最大辩论轮次、单次发言 Token 上限、重试次数、超时时间、成本上限等。

### 4.2 @cabinet/events — 事件总线

**产出物**：`packages/events/src/`

| 组件                 | 说明                                                 |
| :------------------- | :--------------------------------------------------- |
| **EventBus 接口**    | publish, subscribe, unsubscribe, getCausationChain   |
| **SqliteEventStore** | 事件持久化到 SQLite，支持按 correlationId 查询因果链 |
| **MemoryEventBus**   | 内存实现，用于单元测试                               |

**事件格式**：每条消息包含 messageId, correlationId, causationId, timestamp, messageType, payload。不可变，仅追加写入。

**验收标准**：

- 发布/订阅基础流程通过单元测试
- 因果链查询：给定一个 messageId，能追溯到完整的因果链
- 事件回放：存储的事件可按时间戳排序回放
- 多个订阅者同时接收事件，互不干扰

### 4.3 @cabinet/storage — SQLite 持久化

**产出物**：`packages/storage/src/`

| 组件              | 说明                                                                    |
| :---------------- | :---------------------------------------------------------------------- |
| **connection.ts** | SQLite 连接池管理（better-sqlite3），WAL 模式                           |
| **migrations/**   | 迁移脚本，支持版本控制和回滚                                            |
| **backup.ts**     | 定时自动备份（可配置间隔），支持一键恢复                                |
| **repositories/** | Organization, Project, Employee, Decision, Skill, EventLog 的数据访问层 |

**数据库表设计（初始迁移）**：

| 表名            | 字段                                                                                                                        | 说明               |
| :-------------- | :-------------------------------------------------------------------------------------------------------------------------- | :----------------- |
| `organizations` | id, name, captain_id, created_at                                                                                            | 组织实例           |
| `projects`      | id, organization_id, name, description, status, created_at                                                                  | 项目容器           |
| `employees`     | id, project_id, name, role, kind, pipeline_config, persona, permission_level                                                | AI/Human Employee  |
| `decisions`     | id, project_id, type, level(L0-L3), status, title, description, options, chosen_option, captain_id, created_at, resolved_at | 决策记录（不可变） |
| `event_log`     | id, message_id, correlation_id, causation_id, type, payload, timestamp                                                      | 事件日志（不可变） |
| `skills`        | id, name, description, kind, input_schema, output_schema, prompt_template, version, status                                  | 技能定义           |
| `workflows`     | id, project_id, name, definition, status, created_at                                                                        | 工作流定义         |
| `api_keys`      | id, provider, encrypted_key, key_type, created_at, last_used_at                                                             | API Key 加密存储   |
| `audit_log`     | id, entity_type, entity_id, action, actor, changes, timestamp                                                               | 通用审计日志       |

**验收标准**：

- 迁移脚本可重复执行（幂等）
- 所有 Repository 的基本 CRUD 操作通过单元测试
- 连接池正常工作，支持 WAL 模式
- Decision 的不可变性在 Repository 层有约束
- 备份脚本可生成完整数据库快照，恢复流程可验证

**备份策略**：

- 默认每 6 小时自动备份（可配置）
- 保留最近 7 个备份，循环覆盖
- 备份文件命名：`cabinet_backup_YYYYMMDD_HHMMSS.db`
- 恢复命令：`cabinet restore --file <backup_path>`

---

## 五、第二阶段：Agent 核心

**目标**：构建系统的"大脑"——Agent 执行循环、LLM 网关、记忆系统。产出可独立运行的 Agent。

### 5.1 @cabinet/gateway — LLM 网关

**产出物**：`packages/gateway/src/`

| 组件                | 说明                                                          |
| :------------------ | :------------------------------------------------------------ |
| **LLMGateway 接口** | generateText, streamText, listModels                          |
| **AISDKAdapter**    | 基于 Vercel AI SDK 统一适配 Anthropic/OpenAI/Google 等提供商  |
| **ModelRouter**     | 根据角色（deep_reasoning / fast_execution / default）路由到不同模型 |
| **FallbackChain**   | 主模型不可用时自动切换到备用模型（可配置优先级链）            |
| **CostTracker**     | 记录每次调用的 Token 消耗和费用                               |
| **BudgetGuard**     | 日/周/月预算上限，达到阈值自动告警或拦截                      |

**预算管控规则**：

| 层级   | 默认值  | 行为                                                     |
| :----- | :------ | :------------------------------------------------------- |
| 日预算 | $5.00   | 达 80% 时 Dashboard 显示提醒；达 100% 时拦截非 L3 级调用 |
| 周预算 | $25.00  | 达 80% 时推送秘书消息                                    |
| 月预算 | $100.00 | 可在设置中配置，达上限后所有 LLM 调用需 Captain 确认     |

**验收标准**：

- 可完成一次 LLM 调用并返回结构化响应
- 模型回退链生效：主模型超时→自动切换备用模型
- 成本日志可查询，Dashboard 可展示日/周/月消耗
- 预算上限触发提醒和拦截
- 支持 function calling 格式的工具调用

### 5.2 @cabinet/agent — Agent 执行循环

**产出物**：`packages/agent/src/`

**TAOR 循环**（借鉴 Claude Code 设计哲学）：

```
循环 {
  1. 构建上下文（从记忆系统加载）
  2. 调用 LLM 网关
  3. 若无工具调用 → 返回结果
  4. 若有工具调用 → 执行工具（经四级安全检查）
  5. 反馈工具结果到模型 → 继续循环
}
```

| 组件               | 说明                                                    |
| :----------------- | :------------------------------------------------------ |
| **AgentLoop**      | 核心循环，模型驱动，框架只负责执行。支持 `run()` 和 `resume()` 带检查点恢复 |
| **ContextBuilder** | 从记忆系统加载上下文，组装消息列表                      |
| **ContextMonitor** | 上下文窗口监控（Smart/Warning/Critical/Dumb 四区模型，阈值 40%/60%/80%） |
| **ContextHandoff** | 上下文交接（会话压缩、跨 Agent 状态传递）               |
| **ToolExecutor**   | 执行工具调用，返回结构化结果                            |
| **Checkpoint**     | 保存循环状态，支持崩溃恢复                              |
| **RetryStrategy**  | 按错误类型分类重试（见下方说明）                        |
| **Safety**         | 运行时四级安全检查（缓存规则→自动模式→白名单→AI分类器） |
| **AgentRoleRegistry** | 5 个内置角色注册表（secretary/meeting_chair/curator/reviewer/organize） |
| **AgentDispatcher** | Agent 调度器，支持 single / pipeline / parallel 三种执行模式 |
| **SkillRegistry**  | 技能注册表，支持 L1/L2/L3 渐进式披露                    |
| **MCPManager**     | MCP 服务器管理器，通过 stdio 连接外部 MCP 服务器，动态注册工具 |
| **InteractiveSubAgent** | 交互式子代理，支持多轮会话、中途用户输入、事件驱动状态同步 |

**重试策略**：

| 错误类型                               | 重试次数 | 退避策略            | 示例         |
| :------------------------------------- | :------- | :------------------ | :----------- |
| 瞬时错误（网络超时、429限流）          | 3 次     | 指数退避：1s→4s→16s | LLM API 超时 |
| 可恢复错误（工具执行失败）             | 2 次     | 固定间隔 2s         | 文件读取失败 |
| 不可恢复错误（参数校验失败、权限不足） | 0 次     | 直接失败            | API Key 无效 |

**验收标准**：

- 可完成单步任务：输入 → Agent 推理 → 工具调用 → 返回结果
- 多步任务（需要多次工具调用）能正确完成
- 崩溃恢复：模拟崩溃后，从检查点恢复继续执行
- 工具调用经过四级安全检查
- 瞬时错误自动重试，不可恢复错误立即终止并记录上下文
- 高风险操作执行前进行 Teach-back 确认

### 5.3 @cabinet/memory — 记忆系统

**产出物**：`packages/memory/src/`

| 层级     | 组件                   | 存储              | 功能                                    | TTL/生命周期       |
| :------- | :--------------------- | :---------------- | :-------------------------------------- | :----------------- |
| 短期记忆 | short-term.ts          | 内存缓存 + SQLite | 当前会话上下文，自动过期                | 会话结束时清理     |
| 长期记忆 | long-term.ts           | SQLite + HNSW     | 跨会话语义检索（HNSW 向量索引），按项目隔离 | 永久保留，手动清理 |
| 实体记忆 | entity.ts              | SQLite            | Captain偏好、员工配置、人格外衣         | 随实体生命周期     |
| 项目记忆 | project.ts             | SQLite            | 项目目标、里程碑、关键决策、上下文摘要  | 随项目生命周期     |
| 整合服务 | consolidation.ts       | 后台定时任务      | 去重、合并、提炼关键信息，短期→长期迁移 | 每 30 分钟运行     |
| 知识图谱 | knowledge-graph.ts     | SQLite            | 实体关系图谱，支持关联推理              | 永久保留           |
| 记忆衰减 | memory-decay.ts        | 后台定时任务      | 低价值记忆自动衰减和清理                | 每小时运行         |
| 写入闸门 | write-gate.ts          | 内存              | 记忆写入前的质量过滤和去重              | 实时               |
| 级联缓冲 | cascade-buffer.ts      | 内存              | 批量写入缓冲，减少 SQLite 压力          | 实时               |
| 项目隔离 | project-isolation.ts   | 内存 + SQLite     | 多项目间记忆完全隔离                    | 随项目生命周期     |

**四层记忆关系**：

- **短期记忆**是"当前在说什么"——热数据，高频读写
- **长期记忆**是"以前学过什么"——冷数据，语义检索（HNSW 向量索引）
- **实体记忆**是"Captain 是谁、顾问怎么配置"——配置数据，低频读写
- **项目记忆**是"这个项目在做什么"——中频数据，跨会话持久化，为 Agent 提供项目上下文
- **知识图谱**记录实体间关系，支持跨层关联查询
- **记忆衰减**自动降低低价值记忆的检索权重

**验收标准**：

- 短期记忆：会话内上下文正确传递
- 长期记忆：语义搜索返回相关历史信息（HNSW 索引）
- 实体记忆：Captain 偏好可读写
- 项目记忆：切换项目后，Agent 自动加载对应项目的上下文和关键决策
- 后台整合：可手动触发记忆去重和从短期到长期的提炼迁移
- 知识图谱：可查询实体间关系路径
- 项目隔离：项目 A 的记忆不会泄漏到项目 B

---

## 六、第三阶段：核心业务

**目标**：构建 Cabinet 独有的业务逻辑——秘书、会议、决策、工作流、Harness。每个模块在集成前已完整实现并测试。

### 6.1 @cabinet/secretary — 秘书 Agent

**产出物**：`packages/secretary/src/`

| 组件                      | 功能                                                         |
| :------------------------ | :----------------------------------------------------------- |
| **SecretaryAgent**        | 秘书主逻辑，继承/组合 AgentLoop                              |
| **IntentParser**          | 自然语言 → 结构化意图（决策请求/会议请求/询问状态/知识查询） |
| **DecisionCardGenerator** | 意图 → 决策卡片草案（包含关键维度、选项、影响分析）          |
| **SessionManager**        | 多会话管理，上下文持久化                                     |
| **GreetingService**       | 每日问候、摘要生成（由事件驱动）                             |

**验收标准**：

- 输入"帮我分析是否该进入母婴市场"→ 识别为决策请求 → 生成包含关键维度的决策卡片
- 输入"帮我组织财务和市场顾问讨论预算"→ 识别为会议请求 → 列出可参会顾问 + 预估会议成本
- 输入"帮我设计一个工作流"→ 识别为技能调用意图 → 路由到 organize Agent 或调用 workflowDesigner 技能
- 多轮对话上下文保持
- 每日摘要可由事件驱动生成
- 技能调用意图可被正确识别并路由到对应的 built-in skill

### 6.2 @cabinet/meeting — 会议机制

**产出物**：`packages/meeting/src/`

| 组件                  | 功能                                             |
| :-------------------- | :----------------------------------------------- |
| **MeetingService**    | 管理会议生命周期（创建→推理→产出→关闭）          |
| **CostEstimator**     | 会前预估 Token 消耗和费用，超阈值需 Captain 确认 |
| **DebateProtocol**    | 同步推理 + 交叉验证协议                          |
| **ParallelReasoning** | 多 Agent 并行推理                                |
| **CrossValidator**    | 对比输出差异，形成共识与少数派报告               |

**协议**（四阶段会议流程）：

1. **Chair 阶段**：Meeting Chair 接收议题，解析用户意图，确定所需分析视角，构造结构化 Brief
2. **Advisor 阶段**：各 Advisor 子代理基于 Brief 并行独立推理，完成各自领域的深度分析
3. **Reviewer 阶段**：Reviewer 代理对所有 Advisor 输出进行独立质量审查，检查逻辑完整性、证据质量、风险评估和事实准确性
4. **Extraction 阶段**：提取共识、差异点和少数派报告，生成最终交付物

**成本控制**：

| 参数                | 默认值 | 说明                           |
| :------------------ | :----- | :----------------------------- |
| 最大顾问数          | 5      | 单次会议最多并行顾问           |
| 最大辩论轮次        | 3      | 超时自动产出                   |
| 单次发言 Token 上限 | 4,096  | 超过截断并标记                 |
| 会议预算上限        | $2.00  | 预估超过此值需确认             |
| 反刍检测阈值        | 0.85   | 语义相似度超过此值视为重复论点 |

**成本控制**：

| 参数                | 默认值 | 说明                           |
| :------------------ | :----- | :----------------------------- |
| 最大顾问数          | 5      | 单次会议最多并行顾问           |
| 最大辩论轮次        | 3      | 超时自动产出                   |
| 单次发言 Token 上限 | 4,096  | 超过截断并标记                 |
| 会议预算上限        | $2.00  | 预估超过此值需确认             |
| 反刍检测阈值        | 0.85   | 语义相似度超过此值视为重复论点 |

**验收标准**：

- 3 个模拟顾问可并行推理同一议题
- 产出包含共识部分和少数派报告
- 最大轮次限制生效（硬编码 3 轮）
- 反刍检测：语义相似度检查阻止重复论点
- 会前成本预估与实际消耗偏差不超过 30%
- 预算超限时正确触发确认流程

### 6.3 @cabinet/decision — 决策管理

**产出物**：`packages/decision/src/`

| 组件                | 功能                                               |
| :------------------ | :------------------------------------------------- |
| **DecisionService** | 创建、查询、审批、驳回决策                         |
| **LevelClassifier** | L0-L3 自动分级逻辑                                 |
| **StateMachine**    | 决策状态流转（PENDING→APPROVED/REJECTED→ARCHIVED） |
| **Escalation**      | L3 决策立即升级，多渠道通知 Captain                |
| **AuditLog**        | 决策操作完整审计日志                               |

**L0-L3 自动分级算法**：

```
classifyLevel(input):
  1. 提取特征：影响范围、副作用可逆性、选项数量、成本估算、涉及实体类型
  2. 匹配规则（按优先级）：
     - 涉及资金/权限/数据删除/组织配置 → L3
     - 跨会话影响 OR 选项>3 OR 存在价值取舍 OR 成本>$0.10 → L2
     - 影响限于当前会话 AND 选项≤3 AND 成本≤$0.10 → L1
     - 影响限于单次调用 AND 无副作用 AND 成本<$0.01 → L0
  3. 不确定时升级一级（宁可多打扰，不可漏升级）
```

**状态机**：

```
PENDING ──Captain审批──▶ APPROVED ──归档──▶ ARCHIVED
   │                        │
   └──Captain驳回──▶ REJECTED ──归档──▶ ARCHIVED
   │
   └──超时(可配)──▶ EXPIRED ──归档──▶ ARCHIVED
```

所有状态转换不可逆，ARCHIVED 状态的决策不可修改。

**验收标准**：

- 决策状态机正确流转，不可变约束生效（已归档决策不可修改）
- L0/L1 决策自动处理，不在待决策列表显示
- L2 决策生成决策卡片，等待 Captain 确认
- L3 决策立即升级，触发通知
- 审计日志记录每次状态变更
- 分级准确率目标：L2+ 不遗漏（宁可误升级不错过），L0 不误判

### 6.4 @cabinet/workflow — 工作流引擎

**产出物**：`packages/workflow/src/`

| 组件                 | 功能                             |
| :------------------- | :------------------------------- |
| **WorkflowEngine**   | 拓扑排序执行，按序/并行调度节点  |
| **BlueprintValidator**| 工作流蓝图校验（节点连通性、循环检测、schema 校验） |
| **ConditionEvaluator**| 条件表达式求值引擎               |

**17 种统一节点类型**：start, end, agentGroup, llm, skill, tool, code, workflow, ifElse, loop, parallel, merge, pass, intentClassify, knowledgeBase, approval, human

**验收标准**：

- 线性工作流（A→B→C）正确执行
- 条件分支按预期选择路径
- 并行节点同时执行，全部完成后汇合
- HumanNode / approval 节点暂停并发送决策请求，收到审批后继续
- 节点失败时支持重试和超时处理
- 蓝图校验可检测不可达节点、循环依赖和类型不匹配

### 6.5 @cabinet/harness — 驾驭与质量保障

**注意**：Harness 是**后执行评估层**，不参与实时执行流程。它与 Agent 包的安全检查职责完全不同，详见 [3.1 包职责边界](#31-包职责边界关键区分)。

**产出物**：`packages/harness/src/`

| 组件                  | 功能                                                                   |
| :-------------------- | :--------------------------------------------------------------------- |
| **Evaluator**         | 独立 Agent 对关键输出进行质量评估                                      |
| **QualityGate**       | "假设-证据-影响"(H-E-I)格式校验；未达标→自动重试→3次后标记"低质量"返回 |
| **Escalation**        | 连续低质量输出时通知 Captain                                           |
| **TeachBack**         | 高风险操作前要求 AI 复述任务目标，确认理解一致                         |
| **ObservabilityCollector** | 会话级指标采集（Token 消耗、工具调用、延迟）                      |
| **AutoAdjuster**      | 自动调参（温度、模型选择、预算分配）基于历史表现                      |
| **PreferenceLearner** | Captain 偏好学习（风险容忍、决策风格、关注维度）                      |
| **SubconsciousLoop**  | 后台潜意识循环，定期生成洞察和模式识别                                |
| **BrowserVerifier**   | 浏览器验证器（截图对比、视觉回归检查）                                |
| **GarbageCollector**  | 孤儿数据清理（未引用的决策、过期的会话、废弃的 workflow）             |

**验收标准**：

- Evaluator 可评估 Agent 输出是否满足 H-E-I 格式
- 质量未达标 → 自动重试 → 3 次后标记为"低质量"但仍返回（不阻塞流程）
- Teach-back 确认流程可被测试覆盖
- 连续 3 次低质量输出时触发通知
- 可观测性指标可生成日报/周报
- 偏好学习能识别 Captain 的重复决策模式

---

## 七、第四阶段：用户界面

**目标**：为所有核心业务能力提供可交互的界面。

### 7.1 @cabinet/ui — 共享 UI 组件

**产出物**：`packages/ui/src/`

| 组件                 | 功能                                                  |
| :------------------- | :---------------------------------------------------- |
| **DecisionCard**     | 决策卡片（轻量版/完整版），支持一键审批，显示成本预估 |
| **SecretaryChat**    | 秘书对话视图，支持流式消息和成本消耗实时显示          |
| **DashboardSummary** | Dashboard 摘要面板（待决策数、今日消耗、项目状态）    |
| **WorkflowCanvas**   | 工作流画布（拖拽节点、连线）                          |
| **Navigation**       | 左侧导航栏（Dashboard / Cabinet / Office / Factory）  |

### 7.2 apps/desktop — 桌面端

**产出物**：`apps/desktop/`

**技术栈**：React + Vite + Tauri 2.x

**路由**：

- `/dashboard` — Dashboard 首页
- `/cabinet` — 秘书对话 + 会议室
- `/office` — 决策深度审阅
- `/factory` — 工作流管理

**Tauri 更新机制**：使用 Tauri 内置 updater 插件，检查 GitHub Releases 获取更新。

**验收标准**：

- 四个路由页面均可正确渲染
- Dashboard 显示秘书摘要和待决策卡片（连接后端 API）
- Cabinet 对话支持流式响应
- Office 可查看完整决策上下文并完成审批
- Factory 可查看工作流列表和运行状态
- Tauri 打包后双击可运行（桌面应用）
- Tauri updater 可检测并安装更新

### 7.3 apps/server — 后端服务

**产出物**：`apps/server/`

**技术栈**：Hono + Zod

**核心 API 端点**：

| 端点                             | 方法            | 描述                                     |
| :------------------------------- | :-------------- | :--------------------------------------- |
| `/api/secretary/chat`            | POST            | 向秘书发送消息（流式响应，SSE）          |
| `/api/meetings`                  | POST            | 创建会议（返回预估成本）                 |
| `/api/meetings/:id/status`       | GET             | 查询会议状态（含实际成本）               |
| `/api/decisions`                 | GET/POST        | 获取待决策列表 / 创建决策                |
| `/api/decisions/:id`             | GET             | 获取决策详情（深度审阅）                 |
| `/api/decisions/:id/approve`     | POST            | 审批决策                                 |
| `/api/decisions/:id/reject`      | POST            | 驳回决策                                 |
| `/api/workflows`                 | GET/POST        | 列出 / 创建工作流                        |
| `/api/workflows/:id/run`         | POST            | 启动工作流                               |
| `/api/agents`                    | GET/POST        | 列出 / 注册 Agent                        |
| `/api/skills`                    | GET/POST        | 列出 / 注册技能                          |
| `/api/employees`                 | GET/POST        | 列出 / 创建员工                          |
| `/api/projects`                  | GET/POST        | 列出 / 创建项目                          |
| `/api/memory`                    | GET/POST        | 查询 / 写入记忆                          |
| `/api/files`                     | GET/POST        | 文件上传 / 下载                          |
| `/api/knowledge`                 | POST            | 知识库索引 / 查询                        |
| `/api/dashboard/summary`         | GET             | 获取 Dashboard 摘要数据                  |
| `/api/harness/evaluate`          | POST            | 手动触发质量评估                         |
| `/api/observability/metrics`     | GET             | 获取可观测性指标                         |
| `/api/settings`                  | GET/PUT         | 查询/修改系统设置                        |
| `/api/auth/verify`               | POST            | 验证 Captain 身份（本地密码/PIN）        |
| `/api/health`                    | GET             | 健康检查                                 |

---

## 八、第五阶段：集成与打磨

### 8.1 认证与安全

**Captain 身份认证**：

- 桌面端：本地 PIN 码或系统生物识别（通过 Tauri API）
- API Key 管理：AES-256-GCM 加密存储于 SQLite `api_keys` 表
- 无网络认证依赖——完全本地化

**API Key 管理流程**：

1. Captain 在 Settings 界面输入各 LLM 提供商的 API Key
2. 系统使用 AES-256-GCM 加密后存入 `api_keys` 表
3. 运行时解密到内存，不落盘
4. 支持 Key 轮换：新 Key 添加后，旧 Key 可标记为"待删除"

### 8.2 集成测试

**E2E 核心闭环**：

1. Captain 在 Dashboard 看到秘书摘要（含昨日消耗统计）
2. 点击输入框进入 Cabinet 对话，提出议题
3. 秘书解析意图，预估决策成本，推送决策卡片草案
4. 如需多方视角，发起会议（显示成本预估，超阈值请求确认）
5. 会议产出方案，秘书推送决策卡片到对话中
6. Captain 进行轻量审批（或在 Office 深度审阅后审批）
7. Factory 接收任务指令，执行工作流
8. 执行结果返回，确认回执插入对话流
9. 全流程成本记录可追溯

### 8.3 性能标准

| 指标           | 目标                    |
| :------------- | :---------------------- |
| Dashboard 加载 | < 1 秒                  |
| 对话消息响应   | < 3 秒（不含 LLM 推理） |
| 决策审批操作   | < 500ms                 |
| 事件吞吐量     | > 1000 events/s         |
| 备份耗时       | < 5 秒（100MB 数据库）  |

### 8.4 安全审计清单

- [ ] API Key 加密存储（AES-256-GCM），运行时仅存内存
- [ ] 审计日志完整可查询，覆盖：决策变更、API Key 变更、工作流执行、备份操作
- [ ] 四级安全检查（Agent 运行时）全部生效
- [ ] 输入校验（Zod schema）覆盖所有 API 端点
- [ ] SQL 注入防护（better-sqlite3 参数化查询）
- [ ] 备份文件不包含未加密的 API Key

### 8.5 可观测性

| 维度               | 方案                                                                       |
| :----------------- | :------------------------------------------------------------------------- |
| **日志**           | 结构化 JSON 日志，输出到 `~/.cabinet/logs/`，按日滚动                      |
| **指标**           | 关键指标（LLM 调用次数、Token 消耗、决策处理数）记录到 SQLite `metrics` 表 |
| **Dashboard 展示** | 今日消耗、本月消耗、活跃项目数、待决策数、Agent 运行状态                   |

---

## 九、开发原则

### 9.1 分层递进的核心原则

1. **先接口，后实现**。每个模块先定义 TypeScript interface，编写测试，再写实现。这确保模块边界清晰，可替换、可 mock。

2. **单元测试先行**。每个模块的接口定义完成后，立即编写单元测试。测试文件与源文件在同一层级，命名 `*.test.ts`。

3. **模块独立可验证**。每个模块完成后，不依赖未完成的模块即可运行其单元测试。依赖通过 mock 或测试桩提供。

4. **零技术债**。每个模块实现完成后直接达到生产标准。这包括完整的错误处理、日志记录和文档注释。不允许出现"稍后再修"的代码。

5. **类型安全**。所有 API 边界用 Zod schema 校验；所有跨模块消息通过 @cabinet/types 定义的类型传递。禁止 `any` 类型。

6. **错误处理**。每个异步操作必须有 try-catch 包裹，错误需记录上下文信息（时间戳、操作名、输入参数摘要、错误消息、堆栈）。

7. **分层递进，不全则退**。每层完成后跑通全栈集成测试后才进入下一层。发现上层需求驱动下层修改时，先补下层测试再改实现。

### 9.2 关键设计决策

| 决策       | 选择                                                     | 理由                                                |
| :--------- | :------------------------------------------------------- | :-------------------------------------------------- |
| Agent 循环 | 模型驱动，框架极简                                       | 相信模型能力，框架只提供执行主干                    |
| 事件总线   | 自研，SQLite 持久化                                      | 不可变、可追溯、可回放、零外部依赖                  |
| 记忆系统   | 短期 + 长期 + 实体 + 项目四层                            | 区分热数据（上下文）和冷数据（知识），项目级隔离    |
| 会议协议   | 四阶段流程（Chair→Advisor→Reviewer→Extraction）+ 成本预估 | 结构化推理、独立审查、高质量产出，会前透明化成本    |
| 决策管理   | 不可变状态机 + L0-L3 自动分级                            | 完整审计链，自动处理低风险决策减少打扰              |
| 安全架构   | 三层防护：Agent运行时 + Harness后评估 + Workflow节点验证 | 职责清晰，无重叠，覆盖执行前中后                    |
| LLM 接入   | Vercel AI SDK + 自研路由                                 | 纯 TypeScript，零外部运行时，Tauri 打包友好         |

### 9.3 测试策略

| 测试层级 | 覆盖率目标                                                      | 工具                |
| :------- | :-------------------------------------------------------------- | :------------------ |
| 单元测试 | > 85% 行覆盖率                                                  | Vitest              |
| 集成测试 | 跨模块核心链路（事件发布消费、Agent完整循环、决策状态机全路径） | Vitest + 测试数据库 |
| E2E 测试 | 核心闭环（秘书对话→决策→审批→执行）                             | Playwright          |
| 契约测试 | 事件发布/消费一致性、模块间 interface 契约                      | Vitest              |

### 9.4 常见错误模式（必须遵守的规避纪律）

以下错误模式在 AI 辅助编码中高频出现，开发过程中需主动规避：

| 常见错误                 | 表现                                                           | 纪律约束                                                                    |
| :----------------------- | :------------------------------------------------------------- | :-------------------------------------------------------------------------- |
| **绕过接口直接调用**     | 业务代码直接 `import { Anthropic }` 而非通过 `LLMGateway` 接口 | 所有外部依赖必须通过接口封装，核心代码只依赖接口                            |
| **测试先行但实现无边界** | 先写测试，但在实现时同时写了测试不覆盖的额外逻辑               | 实现阶段只写让测试通过的代码，额外功能需先补测试                            |
| **类型定义散落**         | 相同的 Decision 类型在多个包中重复定义                         | 所有共享类型必须在 @cabinet/types 中统一定义                                |
| **状态机流转不完整**     | 只处理正常路径，忽略异常状态转换                               | 每个状态转换必须处理 3 条路径：正常、异常、边界                             |
| **日志缺失上下文**       | `console.log("error")` 无时间、无操作、无输入参数              | 错误日志必须包含：时间戳、操作名、输入参数摘要、错误消息                    |
| **模块间隐式耦合**       | 模块 A 通过全局变量或未定义接口的方式依赖模块 B                | 所有跨模块通信通过 EventBus 或显式接口调用                                  |
| **职责边界模糊**         | 同一概念（如安全检查）在多个包中实现且职责不清                 | 参考 [3.1 节职责边界表](#31-包职责边界关键区分)，任何新增功能必须先界定归属 |

### 9.5 内置技能（Built-in Skills）

系统提供 4 个内置技能，用于辅助组织设计和系统扩展：

| 技能                | 标识符                | 用途                                     |
| :------------------ | :-------------------- | :--------------------------------------- |
| **Workflow Designer** | `workflowDesigner`    | 工作流设计助手，指导节点类型选择和流程编排 |
| **Agent Creator**     | `agentCreator`        | 自定义 Agent 创建助手，验证配置规则       |
| **Skill Creator**     | `skillCreator`        | SKILL.md 编写助手，生成标准格式技能定义   |
| **MCP Builder**       | `mcpBuilder`          | MCP 服务器开发助手                        |

内置技能通过 `use_skill__*` 工具调用，由 Organize Agent 在六步方法中按需触发。

### 9.6 MCP 集成

MCP（Model Context Protocol）是连接外部工具生态的标准协议。系统通过 `MCPManager` 管理 MCP 服务器：

- **连接方式**：stdio（本地进程）
- **动态注册**：MCP 服务器连接后，其工具自动注册到 `ToolExecutor`
- **配置位置**：`~/.cabinet/config.json` 中的 `mcp_servers` 数组
- **安全级别**：动态/MCP 工具默认风险级别为 `moderate`，受 SafetyChecker 四级安全检查约束

### 9.7 Skills 生命周期管理

Skill 是系统的原子能力单元，采用 SKILL.md 标准定义，完整生命周期如下：

```
创建 → 注册 → 测试 → 发布 → 使用 → 更新/废弃
```

| 阶段     | 说明                                                                               | 责任人                |
| :------- | :--------------------------------------------------------------------------------- | :-------------------- |
| **创建** | 编写 SKILL.md 定义文件（名称、描述、输入schema、输出schema、Prompt模板、工具列表） | Captain / AI 辅助生成 |
| **注册** | 将 Skill 注册到系统的 Skill Registry，分配唯一 ID 和版本号                         | 系统自动              |
| **测试** | 用示例输入验证 Skill 输出符合 schema 和质量预期                                    | Harness Evaluator     |
| **发布** | Skill 状态从 draft 变为 active，可被 Workflow 和 Agent 调用                        | Captain 确认          |
| **使用** | Workflow 和 Agent 通过 SkillRegistry 按名称/能力查找并调用                         | 运行时                |
| **更新** | 新版本保留旧版本，已运行中的 Workflow 不受影响                                     | 系统自动              |
| **废弃** | 标记为 deprecated，不再被新 Workflow 引用，已有引用发出迁移提醒                    | Captain 确认          |

---

## 十、附录：架构图

### 10.1 数据流图（核心闭环）

```
Captain 输入 → [Cabinet 对话界面] → SecretaryAgent (意图解析)
                                         │
                                    ┌────┴────┐
                                    │ 会议请求？│
                                    └────┬────┘
                                         │ 是
                                    MeetingService
                                    (成本预估 → 主-子代理并行推理)
                                         │
                                    DeliberationProposal
                                         │
                                    DecisionService
                                    (L0-L3 自动分级)
                                         │
                              ┌──────────┴──────────┐
                              │ L0/L1 自动处理       │ L2/L3 上浮到 Captain
                              └──────────┬──────────┘
                                         │
                              Dashboard / Office 界面
                              (轻量审批 / 深度审阅 / 成本透明)
                                         │
                                    Captain 裁决
                                         │
                                    Factory 执行
                                    (WorkflowEngine → BlueprintValidator)
                                         │
                                    Harness 后评估
                                    (质量闸门 → 不达标重试 → 达标放行)
                                         │
                                    事件总线广播
                                    (状态回执插入对话流)
```

### 10.2 模块依赖图

```
┌──────────────────────────────────────────────┐
│                    用户界面                    │
│     Dashboard / Cabinet / Office / Factory    │
├──────────────────────────────────────────────┤
│          秘书 / 会议 / 决策 / 工作流           │
│                    + Harness                  │
├──────────────────────────────────────────────┤
│                Agent 核心循环                 │
├──────────────────────────────────────────────┤
│          LLM 网关 / 四层记忆 / 重试策略        │
├──────────────────────────────────────────────┤
│           事件总线 / SQLite 存储 / 备份        │
├──────────────────────────────────────────────┤
│            @cabinet/types (类型基础)          │
└──────────────────────────────────────────────┘
```

**依赖方向**：上层依赖下层，下层绝不依赖上层。同级模块通过事件总线解耦。核心类型包被所有层依赖。

### 10.3 三层安全/质量防护示意

```
Agent 执行流程:

  工具调用请求
       │
       ▼
  ┌─────────────────────┐
  │ agent/safety.ts     │  ← 第一层：能不做？（运行时安全检查）
  │ 缓存→自动→白名单→AI  │
  └────────┬────────────┘
           │ 通过
           ▼
  ┌─────────────────────┐
  │ 工具执行             │
  └────────┬────────────┘
           │ 输出
           ▼
  ┌─────────────────────┐
  │ harness/quality-gate│  ← 第二层：做得好不好？（H-E-I 格式校验）
  │ 不达标→重试→3次标记  │
  └────────┬────────────┘
           │ 达标 / 标记后放行
           ▼
  ┌─────────────────────┐
  │ workflow/            │  ← 第三层：能传给下一步吗？（仅在工作流中）
  │ blueprint-validator  │     蓝图校验：节点连通性、循环检测、schema 校验
  └─────────────────────┘
```

**文档版本**：2.0  
**最后更新**：2026-06-01  
**产品代号**：Cabinet  
**开发策略**：分层递进，从底层到上层，每层完整产出  
**技术栈**：TypeScript 全栈 + Tauri 桌面端  
**变更摘要（v2.0 → v2.1）**：

- 向量存储从 LanceDB 迁移至 hnswlib-node（HNSW 索引），提升语义检索性能
- 工作流引擎重构为 17 种统一节点类型，支持可视化画布（`@xyflow/react`）
- Agent 核心新增：ContextMonitor（上下文窗口四区监控）、ContextHandoff（上下文交接）、AgentDispatcher（三种执行模式）
- 新增 4 个内置技能：workflowDesigner、agentCreator、skillCreator、mcpBuilder
- 新增 MCP 集成：MCPManager 支持通过 stdio 连接外部 MCP 服务器，动态注册工具
- 新增交互式子代理（InteractiveSubAgent）：支持多轮会话、中途用户输入、事件总线同步
- 会议协议升级为四阶段流程（Chair → Advisor → Reviewer → Extraction）
- Harness 层大幅扩展：新增 ObservabilityCollector、AutoAdjuster、PreferenceLearner、SubconsciousLoop、BrowserVerifier、GarbageCollector
- 记忆系统新增：KnowledgeGraph（知识图谱）、MemoryDecayService（记忆衰减）、ProjectIsolatedMemory（项目隔离）、WriteGate（写入闸门）、CascadeBuffer（级联缓冲）
- 新增 organize 包（组织架构设计），AgentRoleRegistry 支持 5 个内置角色 + 自定义角色
- 秘书新增技能调用意图识别和路由，支持 `/` 技能自动补全
- 新增多主题系统（Sumi-e、Showa Retro）
- 新增 A2A 协议客户端和 LSP 索引器
- 完成控制论架构审计（CYBERNETIC_AUDIT.md），建立 S1-S5 递归控制层模型
- 新增三层安全/质量防护示意架构图
