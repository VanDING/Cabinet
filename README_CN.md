中文 | [English](README.md)

# Cabinet - 你的 AI 内阁

[![CI](https://github.com/VanDING/Cabinet/actions/workflows/ci.yml/badge.svg)](https://github.com/VanDING/Cabinet/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5%2B-blue.svg)](https://www.typescriptlang.org/)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> _O Captain! My Captain!_

---

## 驾驭，还是被驾驭？

我们正站在人机协作的分岔路口。

AI 的能力正以难以理解的速度扩张。它写代码、拟合同、出设计、分析财报。面对这股能力洪流，一个直刺核心的问题浮现出来：**到底谁在掌舵？是 AI 在悄无声息地推着我们从一个确认按钮滑向下一个，还是我们在驾驭它驶向自己选择的目的地？**

我们拒绝一个人类沦为 AI 产线审稿员的未来——被无尽的"我为你生成了一份内容，是否接受？"耗尽心神。

一位船长应当立于噪杂之上，目光投向地平线，只触碰那些真正需要人类判断的时刻。

**船长无所不能，但应只做一事。**

那一件事，就是决策。方向性的选择。价值的裁断。当系统走到能力边界时，那最后的定音之锤。

---

## 从个人工具，到为你运转的组织

市面上的 AI 产品，大多从个体的视角出发。它们为一个特定角色的特定场景提供工具——帮开发者写代码、帮设计师生图、帮市场人员拟文案。它们在各自领域足够称职，但本质上，是为孤独的士兵准备的武器。

**Cabinet 选择了不同的视角。** 它从一个*组织*的视角设计，为你组装出结构完整、角色分明、协同运作的 AI 团队。

这不是一个助手。这是一个 **内阁**。它作为一条连续的流水线运转：你对秘书说话，多智能体审议产生综合结论，可执行的产出流入分级决策等待你的裁决、或进入工作流引擎自动执行，每个结果反馈回记忆系统持续学习。当你需要时，一个完整的组织在你的意志下运转。

而你，是唯一的 **船长（Captain）**。

---

## 从终局设计：假设 AI 什么都能做

今天许多 AI 产品设计，实质上是技术局限的补偿——精心雕琢的提示词、费尽心思的上下文管理、令人神经紧张的 token 预算。这些在今天都不可或缺，但我们清晰地看到：**这些局限终将被进步所覆盖。**

于是 Cabinet 选择了一个更根本的设计哲学：**从终局出发。先假设 AI 什么都能做，再往回补上当下现实所需的脚手架。**

### 不盯过程，断其结果

这是自然而然的推论。

当 AI 在执行一项任务时——它尝试了多少种方法、自我修正了多少次、内部跑了多少轮推理——**人类不需要看到这些。** 正如你不会去监控一个团队成员每分钟的心跳和眨眼次数，你只需要关注交付的成果。

Cabinet 的原则是清晰的：**AI 在执行层自主运转，只在需要决策的边界发出信号。** 过程的噪音被系统吸收。抵达船长的，只有结果和那些关键的临界路口。

### 始于能力缺口的脚手架系统

基于这一原则，我们的辅助系统精准地针对能力缺口而建：

| 能力缺口                 | 解决方案                                               |
| :----------------------- | :----------------------------------------------------- |
| AI 不擅长某类任务        | 装载 **Skill**——即插即用的专项能力                     |
| 多步骤工作缺乏协调       | 建立 **Workflow**——用结构赋予纪律                      |
| 需要外部工具或数据       | 连接 **MCP**——打开一扇通往外部世界的门                 |
| 需要调用另一个 AI 的能力 | 接入**外部 AI 节点**——强者亦需求援                     |
| 任务本身需要人来完成     | 插入**人工节点**——把人类协作者抽象为流程中的可配置节点 |

---

## 人工节点：当机器抵达边界

**人工节点** 是 Cabinet 工作流中一种特殊的节点。它代表一项需要人来完成的任务单元——不是船长的决策，而是一份需要人类动工、或外包给外部人力并等待人类结果返回的工作。

在 Cabinet 的世界观里，人工节点不是"缺陷标记"。它是边界的精确宣言。它宣告：**在此处，AI 流水线终止。在此处，需要人类介入。**

但这种介入的方式经过了精心设计：人工节点是**可配置的**。它定义了输入格式、输出格式、预期完成时限、以及升级策略。人类协作者在这个*节点内*工作，但整个流程的上下文、交接、质量核验仍由系统承载。

这保证了人的介入永远不会成为流程中的一个黑洞。它是透明的、可追踪的、融入整体编排的。

---

## 船长的节点：不可替代的裁决者

这里必须做出区分。

**人工节点是 AI 能力边缘的补充。船长（Captain）是决策权力的最高点。**

当工作流遇到人工节点时，系统在说："这需要一个人来完成。"当事情递送到决策室时，系统在说："这需要*你*来裁决。"

Cabinet 不试图用 AI 填补一切。它精准地绘制 AI 与人类能力的边界，然后在边界线上建立高效的协作协议。

---

## 架构

Cabinet V2.0 是一个 **TypeScript 单体仓库**，建立在严格的 4 层架构之上。13 个包和 2 个应用按依赖方向组织——下层绝不依赖上层。

```
Layer 4 (Interface):   ui, server, desktop       ← 用户/网络边界
Layer 3 (Business):    decision, secretary, meeting, workflow, harness  ← 业务逻辑
Layer 2 (Agent Core):  gateway, agent, memory     ← AI 交互核心
Layer 1 (Infra):       types, events, storage     ← 基础设施
```

| 层  | 包                   | 职责                                          |
| :-- | :------------------- | :-------------------------------------------- |
| 4   | `@cabinet/server`    | Hono REST + WebSocket API 服务器              |
| 4   | `@cabinet/desktop`   | Tauri 2.0 桌面应用（React 19）                |
| 4   | `@cabinet/ui`        | 共享 React 组件库                             |
| 3   | `@cabinet/decision`  | 分级决策管理（L0–L3）                         |
| 3   | `@cabinet/secretary` | 自然语言入口，会话管理                        |
| 3   | `@cabinet/meeting`   | 多智能体辩论与审议                            |
| 3   | `@cabinet/workflow`  | 工作流引擎（技能、条件、并行、人工节点）      |
| 3   | `@cabinet/harness`   | 质量闸门、评估器、验证                        |
| 2   | `@cabinet/gateway`   | 多提供商 LLM 网关（Vercel AI SDK）            |
| 2   | `@cabinet/agent`     | TAOR 智能体循环（思考-行动-观察-响应）        |
| 2   | `@cabinet/memory`    | 四层记忆（短期、长期、实体、项目）            |
| 1   | `@cabinet/events`    | 事件总线，含因果链追踪                        |
| 1   | `@cabinet/storage`   | SQLite 持久化（better-sqlite3，AES-256 加密） |
| 1   | `@cabinet/types`     | 共享 TypeScript 类型——全局基础依赖            |

---

## 核心能力

- **流水线架构 · 从审议到决策到执行**
  秘书（统一入口）→ 多智能体会议（审议 + 综合）→ 决策（L0–L3 分级裁决）→ 工作流（含人工节点的执行引擎）→ 记忆 + 驾驭层（学习 + 质量反馈）。一条连续流水线，而非隔离的房间。

- **秘书界面 · 唯一的自然语言入口**
  无需学习复杂指令。你只需要与你的秘书交谈，它代表你协调整个内阁。

- **能力管线模型 · 灵活且可复用的 AI 员工**
  员工采用**能力管线 + 人格外壳**的双层结构。管线可复用、可组合；外壳在协作中长期积累记忆。

- **智能工作流 · 内置动态判断与分级决策**
  工作流引擎内置执行判断模块，在 L0–L3 的决策边界内自主运转，只在必要时升级。

- **人工节点 · 可配置的人类协作者节点**
  需要外包或外部人力完成的工作被抽象为可配置节点，保证人的介入不会成为流程黑洞。

- **技能系统 · 即插即用的专项能力**
  专项能力被封装为 Markdown 格式的 Skill，按需安装、无限拓展。

- **四层记忆 · 你的外挂大脑**
  短期会话上下文、长期语义检索、实体偏好、项目知识——整合沉淀，项目间隔离。

- **驾驭层质量保障 · 内置评估与验证闸门**
  每个输出在交付前经过评估器和验证闸门，确保质量从不是事后补救。

- **多项目支持 · 上下文隔离**
  每个项目拥有独立的记忆、员工和决策。切换上下文而互不污染。

- **多提供商 LLM 网关 · 预算感知路由**
  通过 Vercel AI SDK 支持 Anthropic 与 OpenAI，按角色路由模型、自动故障转移、成本追踪与预算守护。

- **桌面端与服务器 · Tauri 应用 + Hono API**
  桌面端为三栏式战略指挥台；同时提供 REST 与 WebSocket API。

- **可观测性 · 透明可审计**
  内置 OpenTelemetry 分布式追踪与 Prometheus 指标，你的 AI 团队运转从不黑箱。

---

## 快速开始

### 环境要求

- **Node.js** 22+ 与 **pnpm** 9+

### 安装与构建

```bash
pnpm install
pnpm build
```

### 配置 API 密钥

将 LLM 提供商密钥设为环境变量：

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

### 启动服务器

```bash
cd apps/server && pnpm dev
```

API 服务器默认在 `http://localhost:3000` 启动。

### 启动桌面应用

```bash
cd apps/desktop && pnpm tauri:dev
```

### Docker

```bash
docker compose up -d
```

---

## API

服务器默认运行在 `http://localhost:3000`。交互式 API 文档：

- **Scalar**：`http://localhost:3000/docs`
- **OpenAPI 规范**：`http://localhost:3000/openapi.json`

### 认证

配置 `api_token` 后，所有端点需要 Bearer 令牌：

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/config
```

### 聊天

**REST：**

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "你好", "captain_id": "captain"}'
```

**WebSocket：**

```javascript
const ws = new WebSocket('ws://localhost:3000/api/chat/ws?captain_id=captain&token=<token>');
ws.onmessage = (e) => console.log(JSON.parse(e.data));
ws.send('你好');
```

响应格式：`{"type": "chunk", "content": "..."}` 后跟 `{"type": "done"}`

### 核心端点

```bash
# 秘书 — 与你的 AI 内阁对话
curl -X POST http://localhost:3000/api/secretary/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "sess_1", "message": "分析一下我们是否应该拓展欧洲市场"}'

# 会议 — 多智能体审议（也可从对话中触发）
curl -X POST http://localhost:3000/api/meetings \
  -H "Content-Type: application/json" \
  -d '{"topic": "Q3 战略", "advisors": ["financial", "legal", "market"]}'

# 决策 — 分级决策管理
curl -X POST http://localhost:3000/api/decisions \
  -H "Content-Type: application/json" \
  -d '{"title": "招聘新分析师", "type": "action"}'

# 工作流 — 执行多步骤流程
curl -X POST http://localhost:3000/api/factory \
  -H "Content-Type: application/json" \
  -d '{"name": "季度报告", "definition": {...}}'
```

### 员工、技能、知识库

```bash
# 员工
curl http://localhost:3000/api/employees
curl -X POST http://localhost:3000/api/employees \
  -H "Content-Type: application/json" \
  -d '{"name": "分析师", "role": "analyst", "kind": "ai"}'

# 技能
curl -X POST "http://localhost:3000/api/skills/load?path=/path/to/skill.md"
curl http://localhost:3000/api/skills

# 知识库
curl -X POST http://localhost:3000/api/knowledge/index \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/docs"}'
curl -X POST http://localhost:3000/api/knowledge/query \
  -H "Content-Type: application/json" \
  -d '{"question": "Cabinet 是什么？", "top_k": 3}'
```

---

## 配置指南

### 环境变量

| 变量                      | 默认值        | 描述               |
| :------------------------ | :------------ | :----------------- |
| `ANTHROPIC_API_KEY`       | （空）        | Anthropic API 密钥 |
| `OPENAI_API_KEY`          | （空）        | OpenAI API 密钥    |
| `CABINET_MASTER_PASSWORD` | `change-me`   | 数据库主加密密码   |
| `PORT`                    | `3000`        | 服务器端口         |
| `NODE_ENV`                | `development` | 运行时环境         |

### 模型配置

模型通过 LLM 网关（`@cabinet/gateway`）配置，基于 Vercel AI SDK 实现多提供商支持。网关特性：

- **按角色路由**：`deep_think`、`fast_execute`、`default` 角色映射到合适的模型
- **故障转移链**：超时（30s）或出错时自动切换
- **预算守护**：每日（$5）、每周（$25）、每月（$100）支出上限
- **成本追踪**：单次请求与累计成本监控

### MCP 服务器

在 Cabinet 数据目录中配置 MCP 服务器：

```json
{
  "mcp_servers": [
    {
      "name": "filesystem",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  ]
}
```

### 记忆存储

Cabinet V2.0 采用基于 SQLite 的四层记忆架构：

- **ShortTerm**：会话上下文，内存 + SQLite
- **LongTerm**：跨会话语义检索，含整合沉淀机制
- **Entity**：船长偏好、员工配置
- **Project**：目标、里程碑、决策——按项目隔离

---

## 开发

```bash
# 安装依赖
pnpm install

# 类型检查所有包
pnpm typecheck

# 运行所有测试
pnpm test

# 运行 E2E 测试
pnpm test:e2e

# 架构分层检查
pnpm lint

# 构建所有包
pnpm build

# 开发模式启动服务器
cd apps/server && pnpm dev

# 开发模式启动桌面应用
cd apps/desktop && pnpm tauri:dev

# 启动文档站点
cd docs/site && pnpm dev
```

CI 在 push 和 PR 到 `main` 分支时通过 GitHub Actions 自动运行（Node 22，pnpm 9）。

---

## 部署

### Docker

```bash
# 构建并运行
docker compose up -d

# 带 API 密钥
ANTHROPIC_API_KEY=sk-ant-... OPENAI_API_KEY=sk-... docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

数据持久化在 `cabinet_data` Docker 卷中。

### 手动部署

```bash
pnpm build
node apps/server/dist/main.js
```

服务器默认监听 3000 端口。可通过 `PORT` 环境变量修改。

---

## 参与贡献

Cabinet 尚在早期阶段。我们欢迎任何形式的贡献——代码、文档、想法，甚至是你自己的一个 AI 员工。

**加入内阁。成为船长。**
