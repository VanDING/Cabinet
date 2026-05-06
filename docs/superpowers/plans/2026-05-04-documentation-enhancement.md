# Documentation Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create bilingual README.md (English) and README_CN.md (Chinese) with project introduction, architecture, quick start, CLI reference, API examples, and configuration guide.

**Architecture:** Two standalone markdown files with identical structure, linked at the top for language switching. All content derived from actual source code — no invented features or commands.

**Tech Stack:** Markdown, ASCII art

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `README.md` | English documentation (GitHub default) |
| Create | `README_CN.md` | Chinese documentation |

---

### Task 1: Create README.md (English)

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

Create `README.md` with the following complete content:

```markdown
[中文](README_CN.md) | English

# Cabinet

An open-source AI collaboration framework for super-individuals and one-person companies.

**Core Philosophy:** Human Harness, AI Execute — you (the Captain) lead, AI employees execute.

## Architecture

```
┌─────────────────────────────────────────────┐
│            User Interface Layer             │
│          CLI / HTTP API / WebSocket         │
├─────────────────────────────────────────────┤
│         Workspace & Decision Layer          │
│   Meeting → Strategy → Decision → Office    │
│               → Summary + Secretary         │
├─────────────────────────────────────────────┤
│         Agent & Collaboration Layer         │
│     LiteLLMAgent / LLMTeam / Factory        │
├─────────────────────────────────────────────┤
│            Foundation Layer                 │
│  Gateway / EventBus / Memory / Knowledge    │
│  Tools / Workflow / Harness                 │
└─────────────────────────────────────────────┘
```

### Five-Room Model

| Room | Role | Description |
|------|------|-------------|
| **Meeting** | Thinking | Brainstorm and deliberate on topics |
| **Strategy** | Translation | Decode proposals into actionable blueprints |
| **Decision** | Adjudication | Make decisions with escalation protocols |
| **Office** | Execution | Schedule tasks with verification gates |
| **Summary** | Learning | Extract insights and feed back |
| **Secretary** | Interface | Your single point of contact to the Cabinet |

## Quick Start

### Installation

```bash
pip install -e .
```

### Initialize

```bash
cabinet init "My Organization"
cabinet config set-key openai sk-your-api-key
```

### Chat

```bash
cabinet chat
```

### Docker

```bash
docker compose up -d
```

## CLI Reference

### Top-Level Commands

| Command | Description |
|---------|-------------|
| `cabinet init <name>` | Initialize a new Cabinet organization |
| `cabinet serve` | Start the API server |
| `cabinet chat` | Start interactive chat with Secretary |
| `cabinet status` | Show organization status |
| `cabinet version` | Show version |

### Config Management

| Command | Description |
|---------|-------------|
| `cabinet config set-key <provider> <key>` | Set API key for a provider |
| `cabinet config get-key <provider>` | Get masked API key |
| `cabinet config list-keys` | List all configured providers |
| `cabinet config set-token <token>` | Set API authentication token |
| `cabinet config get-token` | Get current API token |

### Employee Management

| Command | Description |
|---------|-------------|
| `cabinet employee add --name <n> --role <r>` | Add an employee |
| `cabinet employee list` | List all employees |

Options for `employee add`: `--personality`, `--kind` (default: `ai`)

### Skill Management

| Command | Description |
|---------|-------------|
| `cabinet skill load <path>` | Load a skill from a Markdown file |
| `cabinet skill list` | List all loaded skills |
| `cabinet skill run <name>` | Execute a skill |

Options for `skill run`: `-i key=value` (repeatable)

### Knowledge Management

| Command | Description |
|---------|-------------|
| `cabinet knowledge index <path>` | Index documents (.md, .txt) |
| `cabinet knowledge query <question>` | Query the knowledge base |

### Chat Slash Commands

| Command | Description |
|---------|-------------|
| `/meeting <topic>` | Start a deliberation session |
| `/decide <title>` | Submit a decision request |
| `/task <description>` | Submit an execution task |
| `/strategy <proposal>` | Decode a strategic proposal |
| `/review` | Start a review session |
| `/skills` | List available skills |
| `/employees` | List registered employees |
| `/status` | Show pending summary |
| `/help` | Show help |
| `/quit` | Exit chat |

## API Examples

The API server runs at `http://localhost:8000` by default.

### Authentication

When `api_token` is configured, all endpoints require a Bearer token:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:8000/api/config
```

When `api_token` is empty (default), no authentication is required.

### Chat

**REST:**

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "captain_id": "captain"}'
```

**WebSocket:**

```javascript
const ws = new WebSocket("ws://localhost:8000/api/chat/ws?captain_id=captain&token=<token>");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
ws.send("Hello");
```

Response format: `{"type": "chunk", "content": "..."}` followed by `{"type": "done"}`

### Employees

```bash
# List employees
curl http://localhost:8000/api/employees

# Create employee
curl -X POST http://localhost:8000/api/employees \
  -H "Content-Type: application/json" \
  -d '{"name": "Analyst", "role": "analyst", "kind": "ai"}'

# Get employee
curl http://localhost:8000/api/employees/<employee_id>

# Mount skill to employee
curl -X POST http://localhost:8000/api/employees/<employee_id>/skills/<skill_id>
```

### Skills

```bash
# List skills
curl http://localhost:8000/api/skills

# Load skill
curl -X POST "http://localhost:8000/api/skills/load?path=/path/to/skill.md"

# Run skill
curl -X POST http://localhost:8000/api/skills/<name>/run \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"key": "value"}}'
```

### Knowledge

```bash
# Index documents
curl -X POST http://localhost:8000/api/knowledge/index \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/docs"}'

# Query knowledge base
curl -X POST http://localhost:8000/api/knowledge/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is Cabinet?", "top_k": 3}'
```

### Rooms

```bash
# Meeting
curl -X POST http://localhost:8000/api/rooms/meeting \
  -H "Content-Type: application/json" \
  -d '{"topic": "Q3 Strategy", "level": "multi_party"}'

# Decision
curl -X POST http://localhost:8000/api/rooms/decision \
  -H "Content-Type: application/json" \
  -d '{"title": "Hire new analyst", "decision_type": "action"}'

# Task
curl -X POST http://localhost:8000/api/rooms/task \
  -H "Content-Type: application/json" \
  -d '{"description": "Prepare quarterly report"}'

# Strategy
curl -X POST http://localhost:8000/api/rooms/strategy \
  -H "Content-Type: application/json" \
  -d '{"proposal": "Expand to European market"}'

# Review
curl -X POST http://localhost:8000/api/rooms/review \
  -H "Content-Type: application/json" \
  -d '{"review_type": "project_review"}'
```

### Config

```bash
# Get current config
curl http://localhost:8000/api/config

# List available models
curl http://localhost:8000/api/config/models
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CABINET_DATA_DIR` | `data` | Data directory path |
| `CABINET_LOG_LEVEL` | `INFO` | Logging level (DEBUG/INFO/WARNING/ERROR) |
| `LITELLM_API_KEYS_OPENAI` | (empty) | OpenAI API key |
| `LITELLM_API_KEYS_ANTHROPIC` | (empty) | Anthropic API key |

### Model Configuration

Models are configured in `data/models.json` using the LiteLLM Router format:

```json
[
  {
    "model_name": "default",
    "litellm_params": {
      "model": "gpt-4o-mini"
    }
  },
  {
    "model_name": "fast",
    "litellm_params": {
      "model": "gpt-4o-mini"
    }
  }
]
```

### MCP Servers

Add MCP servers in `data/cabinet.json`:

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

### API Authentication

Set an API token to protect all endpoints:

```bash
cabinet config set-token your-secret-token
```

When configured, all API requests require `Authorization: Bearer your-secret-token`.

### Memory Storage

Set `memory_type` in `data/cabinet.json`:

- `"chromadb"` (default) — Vector-based long-term memory with semantic search
- `"sqlite"` — Simple SQLite-based short-term memory

## Deployment

### Docker

```bash
# Build and run
docker compose up -d

# With API keys
OPENAI_API_KEY=sk-xxx docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

Data persists in the `cabinet-data` Docker volume.

### Manual

```bash
cabinet serve --host 0.0.0.0 --port 8000 --data-dir /data
```

## Development

```bash
# Install with dev dependencies
pip install -e ".[dev]"

# Run tests
pytest tests/ -v

# Lint
ruff check src/ tests/

# Build
pip wheel . --no-deps -w dist/
```

CI runs automatically on push/PR to `main` via GitHub Actions.
```

- [ ] **Step 2: Verify README.md renders correctly**

Run: `python -c "with open('README.md') as f: content = f.read(); assert 'Cabinet' in content; assert 'Quick Start' in content; assert 'API Examples' in content; assert 'Configuration' in content; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add English README"
```

---

### Task 2: Create README_CN.md (Chinese)

**Files:**
- Create: `README_CN.md`

- [ ] **Step 1: Write README_CN.md**

Create `README_CN.md` with the following complete content:

```markdown
中文 | [English](README.md)

# Cabinet

面向超级个体和一人公司的开源 AI 协作框架。

**核心理念：** 人类驾驭，AI 执行 — 你（Captain）主导，AI 员工执行。

## 架构

```
┌─────────────────────────────────────────────┐
│              用户界面层                       │
│          CLI / HTTP API / WebSocket          │
├─────────────────────────────────────────────┤
│            工作空间与决策层                    │
│     会议室 → 战略解码 → 决策室 → 办公室       │
│              → 总结室 + 秘书                  │
├─────────────────────────────────────────────┤
│            智能体与协作层                      │
│      LiteLLMAgent / LLMTeam / Factory        │
├─────────────────────────────────────────────┤
│              基础能力层                        │
│   网关 / 事件总线 / 记忆 / 知识库              │
│   工具 / 工作流 / 驾驭层                      │
└─────────────────────────────────────────────┘
```

### 五室模型

| 房间 | 角色 | 描述 |
|------|------|------|
| **会议室** | 思考层 | 头脑风暴与审议 |
| **战略解码** | 转化层 | 将提案解码为可执行蓝图 |
| **决策室** | 裁决层 | 带升级协议的决策制定 |
| **办公室** | 执行层 | 带验证闸门的任务调度 |
| **总结室** | 学习层 | 提取洞察与反馈 |
| **秘书** | 交互层 | 你与 Cabinet 的唯一交互界面 |

## 快速开始

### 安装

```bash
pip install -e .
```

### 初始化

```bash
cabinet init "我的组织"
cabinet config set-key openai sk-your-api-key
```

### 聊天

```bash
cabinet chat
```

### Docker

```bash
docker compose up -d
```

## CLI 参考

### 顶层命令

| 命令 | 描述 |
|------|------|
| `cabinet init <name>` | 初始化新的 Cabinet 组织 |
| `cabinet serve` | 启动 API 服务器 |
| `cabinet chat` | 启动与秘书的交互式聊天 |
| `cabinet status` | 显示组织状态 |
| `cabinet version` | 显示版本号 |

### 配置管理

| 命令 | 描述 |
|------|------|
| `cabinet config set-key <provider> <key>` | 设置 API 密钥 |
| `cabinet config get-key <provider>` | 查看已配置的密钥（脱敏） |
| `cabinet config list-keys` | 列出所有已配置的提供商 |
| `cabinet config set-token <token>` | 设置 API 认证令牌 |
| `cabinet config get-token` | 查看当前 API 令牌 |

### 员工管理

| 命令 | 描述 |
|------|------|
| `cabinet employee add --name <n> --role <r>` | 添加员工 |
| `cabinet employee list` | 列出所有员工 |

`employee add` 选项：`--personality`，`--kind`（默认：`ai`）

### 技能管理

| 命令 | 描述 |
|------|------|
| `cabinet skill load <path>` | 从 Markdown 文件加载技能 |
| `cabinet skill list` | 列出所有已加载技能 |
| `cabinet skill run <name>` | 执行技能 |

`skill run` 选项：`-i key=value`（可重复）

### 知识库管理

| 命令 | 描述 |
|------|------|
| `cabinet knowledge index <path>` | 索引文档（.md、.txt） |
| `cabinet knowledge query <question>` | 查询知识库 |

### 聊天斜杠命令

| 命令 | 描述 |
|------|------|
| `/meeting <topic>` | 启动审议会议 |
| `/decide <title>` | 提交决策请求 |
| `/task <description>` | 提交执行任务 |
| `/strategy <proposal>` | 解码战略提案 |
| `/review` | 启动审查会话 |
| `/skills` | 列出可用技能 |
| `/employees` | 列出已注册员工 |
| `/status` | 显示待处理摘要 |
| `/help` | 显示帮助 |
| `/quit` | 退出聊天 |

## API 示例

API 服务器默认运行在 `http://localhost:8000`。

### 认证

配置 `api_token` 后，所有端点需要 Bearer 令牌：

```bash
curl -H "Authorization: Bearer <token>" http://localhost:8000/api/config
```

`api_token` 为空（默认）时无需认证。

### 聊天

**REST：**

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "你好", "captain_id": "captain"}'
```

**WebSocket：**

```javascript
const ws = new WebSocket("ws://localhost:8000/api/chat/ws?captain_id=captain&token=<token>");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
ws.send("你好");
```

响应格式：`{"type": "chunk", "content": "..."}` 后跟 `{"type": "done"}`

### 员工

```bash
# 列出员工
curl http://localhost:8000/api/employees

# 创建员工
curl -X POST http://localhost:8000/api/employees \
  -H "Content-Type: application/json" \
  -d '{"name": "分析师", "role": "analyst", "kind": "ai"}'

# 获取员工
curl http://localhost:8000/api/employees/<employee_id>

# 为员工挂载技能
curl -X POST http://localhost:8000/api/employees/<employee_id>/skills/<skill_id>
```

### 技能

```bash
# 列出技能
curl http://localhost:8000/api/skills

# 加载技能
curl -X POST "http://localhost:8000/api/skills/load?path=/path/to/skill.md"

# 执行技能
curl -X POST http://localhost:8000/api/skills/<name>/run \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"key": "value"}}'
```

### 知识库

```bash
# 索引文档
curl -X POST http://localhost:8000/api/knowledge/index \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/docs"}'

# 查询知识库
curl -X POST http://localhost:8000/api/knowledge/query \
  -H "Content-Type: application/json" \
  -d '{"question": "Cabinet 是什么？", "top_k": 3}'
```

### 房间操作

```bash
# 会议室
curl -X POST http://localhost:8000/api/rooms/meeting \
  -H "Content-Type: application/json" \
  -d '{"topic": "Q3 战略", "level": "multi_party"}'

# 决策室
curl -X POST http://localhost:8000/api/rooms/decision \
  -H "Content-Type: application/json" \
  -d '{"title": "招聘新分析师", "decision_type": "action"}'

# 办公室
curl -X POST http://localhost:8000/api/rooms/task \
  -H "Content-Type: application/json" \
  -d '{"description": "准备季度报告"}'

# 战略解码
curl -X POST http://localhost:8000/api/rooms/strategy \
  -H "Content-Type: application/json" \
  -d '{"proposal": "拓展欧洲市场"}'

# 总结室
curl -X POST http://localhost:8000/api/rooms/review \
  -H "Content-Type: application/json" \
  -d '{"review_type": "project_review"}'
```

### 配置查询

```bash
# 获取当前配置
curl http://localhost:8000/api/config

# 列出可用模型
curl http://localhost:8000/api/config/models
```

## 配置指南

### 环境变量

| 变量 | 默认值 | 描述 |
|------|--------|------|
| `CABINET_DATA_DIR` | `data` | 数据目录路径 |
| `CABINET_LOG_LEVEL` | `INFO` | 日志级别（DEBUG/INFO/WARNING/ERROR） |
| `LITELLM_API_KEYS_OPENAI` | （空） | OpenAI API 密钥 |
| `LITELLM_API_KEYS_ANTHROPIC` | （空） | Anthropic API 密钥 |

### 模型配置

模型在 `data/models.json` 中配置，使用 LiteLLM Router 格式：

```json
[
  {
    "model_name": "default",
    "litellm_params": {
      "model": "gpt-4o-mini"
    }
  },
  {
    "model_name": "fast",
    "litellm_params": {
      "model": "gpt-4o-mini"
    }
  }
]
```

### MCP 服务器

在 `data/cabinet.json` 中添加 MCP 服务器：

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

### API 认证

设置 API 令牌以保护所有端点：

```bash
cabinet config set-token your-secret-token
```

配置后，所有 API 请求需要 `Authorization: Bearer your-secret-token`。

### 记忆存储

在 `data/cabinet.json` 中设置 `memory_type`：

- `"chromadb"`（默认）— 基于向量的长期记忆，支持语义搜索
- `"sqlite"` — 基于 SQLite 的短期记忆

## 部署

### Docker

```bash
# 构建并运行
docker compose up -d

# 带 API 密钥
OPENAI_API_KEY=sk-xxx docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

数据持久化在 `cabinet-data` Docker 卷中。

### 手动部署

```bash
cabinet serve --host 0.0.0.0 --port 8000 --data-dir /data
```

## 开发

```bash
# 安装开发依赖
pip install -e ".[dev]"

# 运行测试
pytest tests/ -v

# 代码检查
ruff check src/ tests/

# 构建
pip wheel . --no-deps -w dist/
```

CI 在 push/PR 到 `main` 分支时通过 GitHub Actions 自动运行。
```

- [ ] **Step 2: Verify README_CN.md renders correctly**

Run: `python -c "with open('README_CN.md') as f: content = f.read(); assert 'Cabinet' in content; assert '快速开始' in content; assert 'API 示例' in content; assert '配置指南' in content; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add README_CN.md
git commit -m "docs: add Chinese README"
```

---

### Task 3: Verify Cross-References

**Files:** None (verification only)

- [ ] **Step 1: Verify language switch links**

Run: `python -c "en=open('README.md').read(); cn=open('README_CN.md').read(); assert 'README_CN.md' in en; assert 'README.md' in cn; print('Cross-references OK')"`
Expected: `Cross-references OK`

- [ ] **Step 2: Verify both files have matching sections**

Run: `python -c "
en = open('README.md').read()
cn = open('README_CN.md').read()
sections = ['## Architecture', '## Quick Start', '## CLI Reference', '## API Examples', '## Configuration', '## Deployment', '## Development']
for s in sections:
    assert s in en, f'Missing {s} in README.md'
    assert s in cn, f'Missing {s} in README_CN.md'
print('All sections present in both files')
"`
Expected: `All sections present in both files`

- [ ] **Step 3: Final commit (if any fixes were needed)**

Only commit if fixes were applied during verification.
