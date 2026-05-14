# Cabinet TypeScript 重写开发计划设计文档

> **日期**：2026-05-13  
> **状态**：已确认  
> **关联文档**：`document.md` v2.0（产品开发文档）  

---

## 一、概述

基于 Cabinet 产品开发文档 v2.0，对 13 个包 + 1 个后端应用进行严格分层递进的开发计划设计。

### 1.1 核心约束

| 约束 | 说明 |
|:---|:---|
| **全量范围** | 13 个包全部实现，不做 MVP 裁剪 |
| **严格分层递进** | 每层全部验收通过后才进入下一层，不允许跨层跳步 |
| **全新设计** | 不参考现有 Python 实现，基于 v2.0 文档重新设计 |
| **后端优先** | 本期规划不含前端（`@cabinet/ui`、`apps/desktop` 暂不纳入） |
| **无截止日期** | 质量驱动节奏，每层达标再推进 |
| **零技术债** | 每模块完成后即达生产标准，不允许"稍后再修" |

### 1.2 开发原则

1. **先接口，后实现**。每个模块先定义 TypeScript interface，编写测试，再写实现。
2. **单元测试先行**。接口定义完成后立即编写单元测试。
3. **模块独立可验证**。每个模块完成后不依赖未完成模块即可运行其单元测试。
4. **类型安全**。所有 API 边界 Zod schema 校验，跨模块消息统一类型，禁止 `any`。
5. **错误处理**。每个异步操作 try-catch 包裹，错误含时间戳、操作名、输入参数、错误消息、堆栈。

---

## 二、架构总览

### 2.1 分层架构

```
┌──────────────────────────────────────────────┐
│ Phase 4: apps/server (REST + WebSocket)       │
├──────────────────────────────────────────────┤
│ Phase 3: secretary / meeting / decision /    │
│          workflow / harness                   │
├──────────────────────────────────────────────┤
│ Phase 2: gateway / agent / memory             │
├──────────────────────────────────────────────┤
│ Phase 1: types / events / storage             │
└──────────────────────────────────────────────┘
```

依赖方向：严格上层依赖下层，下层绝不依赖上层。同级模块通过事件总线解耦。

### 2.2 包依赖关系

```
@cabinet/types ← 被所有包依赖
    │
    ├── @cabinet/storage ← events, gateway, agent, memory, decision
    │
    ├── @cabinet/events ← 所有业务包
    │
    ├── @cabinet/gateway → @cabinet/memory
    │       └──────────────→ @cabinet/agent ← 组合 gateway + memory
    │                              │
    │    ┌─────────────────────────┼──────────────────┐
    │    ▼                         ▼                  ▼
    │  decision              secretary/meeting    workflow
    │    │                         │                  │
    │    └─────────────────────────┼──────────────────┘
    │                              ▼                  ▼
    │                         @cabinet/harness
    │                              │
    ▼                              ▼
  apps/server ← 依赖以上全部
```

---

## 三、Phase 1：基础设施

### 3.1 @cabinet/types（5 个文件）

| 文件 | 内容 | 依赖 |
|:---|:---|:---|
| `boundaries.ts` | 硬限制常量（辩论轮次、Token上限、重试次数、超时、成本阈值） | 无 |
| `primitives.ts` | Organization, Project, Employee(Kind: AI/Human), Skill, Workflow, Memory | boundaries |
| `decisions.ts` | Decision, DecisionType(5种), DecisionLevel(L0-L3), DecisionStatus 状态机 | primitives |
| `events.ts` | MessageEnvelope, MessageType(16种), payload 类型（含 correlationId + causationId） | decisions |
| `index.ts` | barrel export | 以上全部 |

**验收**：5 文件编译零错误；JSDoc 覆盖所有导出类型；Decision 状态机覆盖全部状态和转换；Workflow 节点类型覆盖 9 种；编译零错误。

### 3.2 @cabinet/events（4 个文件）

| 文件 | 职责 |
|:---|:---|
| `bus.ts` | EventBus **接口**：publish, subscribe, unsubscribe, getCausationChain |
| `causation.ts` | 因果链追踪纯函数 |
| `memory-bus.ts` | 内存实现（测试用） |
| `sqlite-store.ts` | SQLite 持久化实现，不可变追加写入 |

**开发顺序**：bus → causation → memory-bus → sqlite-store（依赖 @cabinet/storage）

**验收**：发布/订阅通过；因果链完整可追溯；事件回放按时间戳排序；多订阅者互不干扰。

### 3.3 @cabinet/storage（8 个文件 + 迁移）

| 文件 | 职责 |
|:---|:---|
| `connection.ts` | SQLite 连接池（better-sqlite3, WAL 模式） |
| `migrations/001_initial.ts` | 10 张表初始迁移（8 业务 + 2 系统） |
| `repositories/organization.ts` | CRUD |
| `repositories/project.ts` | CRUD |
| `repositories/employee.ts` | CRUD |
| `repositories/decision.ts` | CRUD + 不可变约束 |
| `repositories/skill.ts` | CRUD + 版本管理 |
| `repositories/event-log.ts` | 追加写入（不可变） |
| `backup.ts` | 定时备份（6h间隔，保留7个）+ 一键恢复 |

**数据库表**：organizations, projects, employees, decisions, event_log, skills, workflows, api_keys, audit_log, metrics

**开发顺序**：connection → migration → repositories（organization → project → 其余4个可并行）→ backup

**验收**：迁移幂等；CRUD 全通过；WAL 正常；Decision 不可变约束生效；备份恢复可验证。

### Phase 1 集成检查点

SqliteEventStore 发布事件 → event_log 持久化 → getCausationChain 回溯完整链路。

---

## 四、Phase 2：Agent 核心

### 4.1 @cabinet/gateway（6 个文件）

| 文件 | 职责 |
|:---|:---|
| `llm-gateway.ts` | 接口：generateText, streamText, listModels |
| `ai-sdk-adapter.ts` | Vercel AI SDK 适配器（Anthropic/OpenAI/Google） |
| `model-router.ts` | 角色→模型路由（deep_think / fast_execute / default） |
| `fallback.ts` | 回退链：主模型不可用→按优先级切换（超时30s触发） |
| `cost-tracker.ts` | Token 消耗 + 费用记录 |
| `budget-guard.ts` | 日$5/周$25/月$100 预算管控（80%提醒，100%拦截非L3） |

**开发顺序**：接口 → adapter → router → fallback → cost-tracker → budget-guard

**验收**：单次调用返回结构化响应；回退链生效；成本可查询；预算阈值触发拦截。

### 4.2 @cabinet/agent（6 个文件）

| 文件 | 职责 |
|:---|:---|
| `agent-loop.ts` | TAOR 核心循环 |
| `context-builder.ts` | 从 MemoryOrchestrator 加载四层记忆，组装消息列表 |
| `tool-executor.ts` | 执行工具调用，返回结构化结果 |
| `checkpoint.ts` | 循环状态保存/恢复（SQLite） |
| `retry.ts` | 按错误类型分类重试：瞬时3次指数退避 / 可恢复2次固定 / 不可恢复0次 |
| `safety.ts` | 运行时四级安全：缓存规则→自动模式→白名单→AI分类器 |

**TAOR 循环**：构建上下文 → 调 LLM → 检查工具调用 → 安全检查 → 执行工具 → 反馈结果 → 保存检查点 → 循环

**开发顺序**：tool-executor → safety → retry → checkpoint → context-builder → agent-loop

**验收**：单步/多步任务正确完成；崩溃恢复；四级安全检查；高风险 Teach-back；重试策略正确分类。

### 4.3 @cabinet/memory（6 个文件）

| 文件 | 职责 | 存储 |
|:---|:---|:---|
| `orchestrator.ts` | 统一调度四层记忆 | — |
| `short-term.ts` | 会话上下文，自动过期 | 内存缓存 + SQLite |
| `long-term.ts` | 跨会话语义检索 | LanceDB |
| `entity.ts` | Captain 偏好、员工配置 | SQLite |
| `project.ts` | 项目目标、里程碑、关键决策 | SQLite + LanceDB |
| `consolidation.ts` | 去重、合并、短期→长期迁移（每30min） | 定时任务 |

**开发顺序**：orchestrator → short-term → entity → project → long-term → consolidation

**验收**：短期记忆会话内传递；长期记忆语义检索返回相关；实体记忆可读写；项目记忆随切换加载；整合可手动触发。

### Phase 2 集成检查点

Captain 输入 → AgentLoop 启动 → ContextBuilder 加载记忆 → Gateway 调 LLM → ToolCall → Safety 检查 → ToolExecutor 执行 → 结果反馈 → CostTracker 记录。闭环跑通。

---

## 五、Phase 3：核心业务

### 5.1 @cabinet/decision（5 个文件）

| 文件 | 职责 |
|:---|:---|
| `state-machine.ts` | 纯状态机：PENDING→APPROVED/REJECTED/EXPIRED→ARCHIVED，全路径不可逆 |
| `level-classifier.ts` | L0-L3 自动分级：按范围/副作用/选项数/成本 优先级匹配，不确定时升级一级 |
| `audit-log.ts` | 审计日志持久化 |
| `escalation.ts` | L3 决策多渠道通知 |
| `decision-service.ts` | 组合以上全部，对外统一接口 |

**状态机**：PENDING 为初态 → APPROVED/REJECTED（Captain操作）或 EXPIRED（72h超时）→ ARCHIVED 终态。已归档决策修改抛出 DecisionImmutableError。

**L0-L3 分级**：L0 单次调用无副作用<$0.01 / L1 当前会话≤3选项≤$0.10 / L2 跨会话或多选项或有价值取舍>$0.10 / L3 涉及资金权限数据删除组织配置>$1.00

**开发顺序**：state-machine → level-classifier → audit-log → escalation → decision-service

**验收**：状态机全路径正确；ARCHIVED 不可变；L0/L1 自动处理；L2 卡片推送；L3 立即升级；分级准确率达标。

### 5.2 @cabinet/secretary（5 个文件）

| 文件 | 职责 |
|:---|:---|
| `session-manager.ts` | 多会话管理，上下文持久化恢复 |
| `intent-parser.ts` | 自然语言→结构化意图（decision_request / meeting_request / status_query / knowledge_query / unknown） |
| `decision-card.ts` | 意图→决策卡片草案（≥3个关键维度） |
| `secretary-agent.ts` | 组合 AgentLoop + IntentParser + 意图分发 |
| `greeting.ts` | 事件驱动的每日问候与摘要生成 |

**开发顺序**：session-manager → intent-parser → decision-card → secretary-agent → greeting

**验收**：4+1 种意图正确识别；决策卡片关键维度≥3；多轮对话上下文保持；每日摘要事件驱动。

### 5.3 @cabinet/meeting（5 个文件）

| 文件 | 职责 |
|:---|:---|
| `cost-estimator.ts` | 会前 Token 消耗预估（顾问数×token×轮次），超 $0.50 需确认 |
| `parallel-reasoning.ts` | 多 Agent(≤5) 并行推理调度 |
| `cross-validator.ts` | 对比差异→二次采样→产出共识+少数派报告 |
| `debate-protocol.ts` | 组合 parallel + cross-validator，最大3轮，反刍检测(0.85) |
| `meeting-service.ts` | 会议生命周期 + 事件发布 |

**协议流程**：议题→成本预估(>$0.50确认)→确定顾问(≤5)→并行推理→交叉验证→最大3轮→强制产出

**开发顺序**：cost-estimator → parallel-reasoning → cross-validator → debate-protocol → meeting-service

**验收**：3顾问并行推理；产出含共识+少数派；3轮强制终止；反刍检测生效；成本预估偏差≤30%；超限触发确认。

### 5.4 @cabinet/workflow（7 个文件）

| 文件 | 职责 |
|:---|:---|
| `nodes/skill-node.ts` | 调用 Skill 执行 |
| `nodes/condition-node.ts` | 条件分支（==, !=, in, contains, regex） |
| `nodes/parallel-node.ts` | 并行执行→汇合 |
| `nodes/human-node.ts` | 暂停→创建 Decision(L2)→审批→继续/终止 |
| `verification-gate.ts` | 节点输出 Zod schema 校验 |
| `scheduler.ts` | 任务调度，并发和队列管理 |
| `engine.ts` | 拓扑排序 + 节点调度执行 |

**开发顺序**：skill-node → condition-node → parallel-node → human-node → verification-gate → scheduler → engine

**验收**：线性/条件/并行/人工节点全部正确执行；节点失败重试+超时；HumanNode 审批后继续。

### 5.5 @cabinet/harness（4 个文件）

| 文件 | 职责 |
|:---|:---|
| `quality-gate.ts` | H-E-I 三段式格式检查（Hypothesis-Evidence-Impact） |
| `evaluator.ts` | 独立 Agent 质量评估 |
| `escalation.ts` | 连续3次低质量→通知 Captain |
| `teach-back.ts` | 高风险操作前 AI 复述确认 |

**开发顺序**：quality-gate → evaluator → teach-back → escalation

**验收**：H-E-I 缺失检测正确；未达标自动重试≤3次；3次后标记低质量返回不阻塞；Teach-back 可测试；连续低质量触发通知。

### Phase 3 包间依赖与并行策略

```
@cabinet/decision ← 无 Phase 3 内依赖，先做

    ├──→ @cabinet/secretary  ← 可并行
    ├──→ @cabinet/meeting    ← 需 decision 接口，可并行
    └──→ @cabinet/workflow   ← 需 decision 接口，可并行

@cabinet/harness ← 最后做（评估以上所有输出）
```

### Phase 3 集成检查点

Captain "分析是否进入母婴市场" → Secretary 意图识别 → Meeting 成本预估+并行推理 → CrossValidator 产出 → Decision(L2)创建 → Captain 审批 → Factory 执行 Workflow → Harness 质量评估 → 事件总线广播状态链。

---

## 六、Phase 4：后端服务

### 6.1 apps/server（13 个文件 + 3 中间件）

**技术栈**：Hono + Zod + WebSocket

**路由清单**（共 23 个端点）：

| 域 | 端点 | 方法 | 说明 |
|:---|:---|:---|:---|
| **秘书** | `/api/secretary/chat` | POST | 流式对话（SSE） |
| | `/api/secretary/sessions` | GET | 会话列表 |
| | `/api/secretary/sessions/:id` | GET | 会话历史 |
| **会议** | `/api/meetings` | POST | 创建会议（含预估成本） |
| | `/api/meetings/:id/status` | GET | 会议状态+实际成本 |
| | `/api/meetings/:id/cancel` | POST | 取消会议 |
| **决策** | `/api/decisions` | GET | 列表（筛选） |
| | `/api/decisions/:id` | GET | 详情+审计日志 |
| | `/api/decisions/:id/approve` | POST | 审批 |
| | `/api/decisions/:id/reject` | POST | 驳回 |
| **工厂** | `/api/factory/workflows` | GET/POST | 列表/创建 |
| | `/api/factory/workflows/:id` | PUT | 更新定义 |
| | `/api/factory/workflows/:id/run` | POST | 启动执行 |
| | `/api/factory/workflows/:id/runs` | GET | 执行历史 |
| | `/api/factory/runs/:runId` | GET | 执行详情 |
| **Dashboard** | `/api/dashboard/summary` | GET | 全局摘要 |
| **设置** | `/api/settings/budget` | GET/PUT | 预算配置 |
| | `/api/settings/api-keys` | GET/POST | Key 管理 |
| | `/api/settings/api-keys/:id` | DELETE | 删除 Key |
| **认证** | `/api/auth/verify` | POST | PIN 验证 |
| | `/api/auth/pin` | PUT | 修改 PIN |
| **技能** | `/api/skills` | GET/POST | 列表/注册 |
| | `/api/skills/:id` | PUT | 更新 |
| | `/api/skills/:id/test` | POST | 测试 |
| **事件** | `/ws/events` | WS | 实时推送 |

**中间件链**：ZodValidation → AuthVerify → RateLimit → 路由处理

**文件结构**：
- `index.ts` — Hono 入口
- `routes/` — 8 个路由模块（secretary, meetings, decisions, workflows, dashboard, settings, auth, skills）
- `middleware/` — 3 个中间件（auth, validation, rate-limit）
- `ws/handler.ts` — WebSocket 事件推送

**开发顺序**：index+中间件 → auth → settings → secretary → decisions → meetings → workflows+skills → dashboard → ws

**验收**：所有端点 Zod 校验；401 拦截未认证；SSE 流式推送；WebSocket 事件推送；Dashboard 聚合正确。

---

## 七、Phase 5：集成与打磨

### 7.1 E2E 核心闭环测试

```
Dashboard → Cabinet 对话 → Secretary 意图解析 → Meeting 推理
→ Decision 创建 → Office 审批 → Factory 执行 → 状态回执
```

测试方式：Vitest + HTTP 客户端对 `apps/server` 发起真实请求，验证完整 API 链路。
覆盖正常路径 + 认证失败、预算超限、L3 升级等异常路径。

### 7.2 性能标准

| 指标 | 目标 |
|:---|:---|
| 决策审批 | < 500ms |
| 事件吞吐量 | > 1000 events/s |
| 备份耗时 | < 5s（100MB DB） |
| 对话响应 | < 3s（不含 LLM） |

### 7.3 安全审计

- [ ] API Key AES-256-GCM 加密，运行时仅内存
- [ ] 全端点 Zod 校验无绕过
- [ ] 审计日志覆盖决策变更、Key变更、工作流执行、备份操作
- [ ] SQL 注入防护（参数化查询）
- [ ] 备份文件不含明文 Key
- [ ] Agent 四级安全检查生效
- [ ] Rate limit 生效
- [ ] PIN 暴力破解防护（5次错误→15分钟锁定）

---

## 八、测试策略

| 层级 | 目标 | 工具 |
|:---|:---|:---|
| 单元测试 | > 85% 行覆盖率 | Vitest |
| 集成测试 | 跨模块核心链路（事件发布消费、Agent完整循环、决策状态机全路径） | Vitest + 测试DB |
| E2E 测试（API级） | 核心闭环 | Vitest + HTTP 客户端 |
| 契约测试 | 事件发布/消费一致性、模块间 interface 契约 | Vitest |

---

## 九、全量统计

| 阶段 | 包/应用 | 文件数 | 核心交付 |
|:---|:---|:---|:---|
| Phase 1 | types, events, storage | 17 | 类型基础 + 事件总线 + 持久化 |
| Phase 2 | gateway, agent, memory | 18 | LLM 网关 + Agent 循环 + 四层记忆 |
| Phase 3 | decision, secretary, meeting, workflow, harness | 26 | 五大业务能力 |
| Phase 4 | apps/server | 13 + 3 | REST + WebSocket API |
| Phase 5 | 集成测试 + 性能 + 安全 | — | E2E 闭环 + 性能达标 + 安全审计 |
| **合计** | **13 包 + 1 应用** | **77** | — |

---

## 十、常见风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|:---|:---|:---|:---|
| Phase 3 体量过大导致推进困难 | 中 | 高 | Phase 3 内按包间依赖分批交付，先 decision 后其余可并行 |
| Vercel AI SDK 版本不兼容 | 低 | 中 | 适配器模式封装，可替换底层 SDK |
| LanceDB Node.js 绑定不稳定 | 中 | 中 | 将 long-term.ts 接口设计为可替换，备选方案为 SQLite + 简单向量 |
| 会议并行推理成本过高 | 中 | 中 | 成本预估+确认机制已内置，默认预算上限可调 |
| 接口在后期发现设计缺陷 | 低 | 高 | 每模块有独立测试，接口变更需先补测试后改实现 |

---

**文档版本**：1.0  
**关联产品文档**：`document.md` v2.0  
**下一步**：用户审阅通过后，调用 writing-plans 技能生成详细实施计划
