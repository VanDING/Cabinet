# Cabinet 生产级架构改进 — 完整设计方案

> 基于 Claude Code 源码分析，对标 P0-P3 改进项
> 日期: 2026-05-07

---

## 设计总览

Claude Code 核心哲学：**98.4% 是确定性基础设施，1.6% 是 AI 决策**。Cabinet 在事件溯源、房间架构、可观测性方面已有良好基础，需要在上下文管理、权限确定性、熔断恢复三个方向对齐生产级标准。

### 优先级路线图

```
P0 (本周)           P1 (2周)            P2 (1月)            P3 (2月)
──────────         ──────────          ──────────          ──────────
Token 预算截断      工具结果预算         文件型 Memory         LLM 对话摘要
熔断器集成          确定性 ACL           配置层次化            工具并发分区
```

---

## 1. P0 — Token 预算截断

### 1.1 现状分析

**当前实现** (`src/cabinet/agents/llm_agent.py:67-69`)：

```python
def _trim_history(self) -> None:
    if len(self._history) > self._max_history * 2:
        self._history = self._history[-(self._max_history * 2):]
```

**问题：**
- 基于消息条数截断，不是 token 数。`max_history=20` 意味着 40 条消息
- 不同模型的上下文窗口从 16K 到 200K 不等，硬编码 20 条可能浪费 90% 窗口或在长回复时溢出
- `ConversationStore.get_history(max_turns=20)` 也是硬编码
- 被截断的历史**直接丢弃**，不做摘要或压缩

### 1.2 设计方案

**核心思路：** 将截断决策从"消息条数"改为"token 预算"。

```
调用前检查:
  system_tokens + history_tokens + task_tokens > model_max * 0.85 ?
    → 从历史头部逐条丢弃，直到满足预算
```

**新增文件：** `src/cabinet/core/compact.py`

```python
@dataclass
class TokenBudget:
    """基于模型的 token 预算管理器"""
    model_max_tokens: int = 200_000
    reserve_ratio: float = 0.15   # 留 15% 给响应

    @property
    def max_input_tokens(self) -> int:
        return int(self.model_max_tokens * (1 - self.reserve_ratio))

    def estimate_tokens(self, text: str) -> int:
        """快速 token 估算（~4 chars/token for CJK，~4 chars/token for EN）"""
        return max(1, len(text) // 4)

    def estimate_messages(self, messages: list[dict]) -> int:
        return sum(self.estimate_tokens(m.get("content", "")) for m in messages)

    def fit_messages(
        self,
        system_messages: list[dict],
        history: list[dict],
        new_message: dict,
    ) -> list[dict]:
        """返回适合预算的消息列表，从历史头部截断"""
        fixed_tokens = self.estimate_messages(system_messages)
        fixed_tokens += self.estimate_tokens(new_message.get("content", ""))
        budget = self.max_input_tokens - fixed_tokens

        kept = []
        remaining = budget
        for msg in reversed(history):
            cost = self.estimate_tokens(msg.get("content", ""))
            if remaining - cost < 0:
                break
            kept.insert(0, msg)
            remaining -= cost

        return system_messages + kept + [new_message]


# 模型 token 限制映射
MODEL_TOKEN_LIMITS: dict[str, int] = {
    "deepseek/deepseek-v4-pro": 200_000,
    "deepseek/deepseek-v4-flash": 128_000,
    "openai/gpt-4o": 128_000,
    "anthropic/claude-sonnet-4-6": 200_000,
    "anthropic/claude-opus-4-7": 200_000,
    "ollama/llama3": 8_192,
}
```

**修改文件：** `src/cabinet/agents/llm_agent.py`

```python
# __init__ 新增参数
def __init__(self, ..., max_context_tokens: int | None = None):
    self._token_budget = TokenBudget(
        model_max_tokens=max_context_tokens or 200_000
    )

# _build_messages 改为 token 感知
async def _build_messages(self, task: str) -> list[dict]:
    system_msgs = [{"role": "system", "content": self._system_prompt}]
    if memory_text := await self._load_memory():
        system_msgs.append({"role": "system", "content": f"Relevant memory:\n{memory_text}"})

    new_msg = {"role": "user", "content": task}
    return self._token_budget.fit_messages(system_msgs, self._history, new_msg)

# _trim_history 改为 token 感知（异步持久化阶段调用）
def _trim_history(self) -> None:
    kept = self._token_budget.fit_messages([], self._history, {"role": "user", "content": ""})
    self._history = kept  # kept 不包含最后的空 user msg
```

**修改文件：** `src/cabinet/rooms/secretary/conversation.py`

```python
class ConversationStore:
    def __init__(self, ..., max_tokens: int = 160_000):
        self._max_tokens = max_tokens  # 替代 max_turns=20
```

### 1.3 测试策略

| 测试 | 描述 |
|------|------|
| `test_token_budget_estimation` | 验证 CJK/EN 混合文本的 token 估算 |
| `test_token_budget_fit_under_limit` | 所有消息在预算内 → 不截断 |
| `test_token_budget_truncates_head` | 超出预算 → 从头部丢弃旧消息 |
| `test_token_budget_preserves_system` | system 消息永不丢弃 |
| `test_agent_uses_token_budget` | LiteLLMAgent 集成测试 |

---

## 2. P0 — 熔断器 & 恢复机制

### 2.1 现状分析

**当前实现** (`src/cabinet/agents/llm_agent.py:144-191`)：

```python
for _ in range(10):  # 硬编码 10 轮，无失败计数
    response = await self._gateway.complete(**kwargs)
    ...
```

**问题：**
- 10 轮工具调用无退避，无失败分类
- 无 `prompt_too_long` 响应式处理
- 无 API 调用失败后的指数退避
- LiteLLM 底层有重试但 Cabinet 无二次封装

### 2.2 设计方案

**核心思路：** 三层熔断保护。

```
┌── Layer 1: 工具调用熔断 ──────────────────────────┐
│ 同一 Agent 的工具循环中                            │
│ 3 次连续工具执行失败 → 停止工具调用，返回错误给 LLM  │
│ 状态: closed → open (60s 后半开)                   │
└────────────────────────────────────────────────────┘

┌── Layer 2: API 调用退避 ─────────────────────────┐
│ 同一 gateway 调用的重试策略                         │
│ 指数退避: 1s → 2s → 4s → 8s (max 3 retries)      │
│ 错误分类: rate_limit / server_error / timeout      │
└────────────────────────────────────────────────────┘

┌── Layer 3: 上下文溢出恢复 ────────────────────────┐
│ prompt_too_long 错误 → 激进压缩历史 → 重试         │
│ 最大 3 次渐进压缩，每次丢弃额外 30% 历史            │
└────────────────────────────────────────────────────┘
```

**新增文件：** `src/cabinet/core/resilience.py`

```python
import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)


class CircuitState(Enum):
    CLOSED = "closed"        # 正常运行
    OPEN = "open"             # 熔断，拒绝请求
    HALF_OPEN = "half_open"  # 半开，允许探测


@dataclass
class CircuitBreaker:
    max_failures: int = 3
    reset_timeout: float = 60.0
    failure_count: int = field(default=0, init=False)
    last_failure_time: float = field(default=0.0, init=False)
    state: CircuitState = field(default=CircuitState.CLOSED, init=False)

    def _should_reset(self) -> bool:
        return time.monotonic() - self.last_failure_time > self.reset_timeout

    async def call(self, coro_factory, *args, **kwargs):
        if self.state == CircuitState.OPEN:
            if self._should_reset():
                self.state = CircuitState.HALF_OPEN
                logger.info("Circuit breaker half-open, trying probe")
            else:
                raise CircuitBreakerOpenError(
                    f"Circuit open for {self.reset_timeout}s after {self.failure_count} failures"
                )

        try:
            result = await coro_factory(*args, **kwargs)
            if self.state == CircuitState.HALF_OPEN:
                self.state = CircuitState.CLOSED
                self.failure_count = 0
                logger.info("Circuit breaker closed (probe succeeded)")
            return result
        except Exception as e:
            self.failure_count += 1
            self.last_failure_time = time.monotonic()
            if self.failure_count >= self.max_failures:
                self.state = CircuitState.OPEN
                logger.error("Circuit breaker opened after %d failures: %s",
                             self.failure_count, e)
            raise


class CircuitBreakerOpenError(Exception):
    pass


class ErrorCategory(Enum):
    RATE_LIMIT = "rate_limit"
    SERVER_ERROR = "server_error"
    TIMEOUT = "timeout"
    CONTEXT_OVERFLOW = "context_overflow"
    FATAL = "fatal"


def classify_error(error: Exception) -> ErrorCategory:
    msg = str(error).lower()
    if "rate_limit" in msg or "429" in msg:
        return ErrorCategory.RATE_LIMIT
    if "timeout" in msg or "timed out" in msg:
        return ErrorCategory.TIMEOUT
    if "prompt_too_long" in msg or "context_length" in msg:
        return ErrorCategory.CONTEXT_OVERFLOW
    if "5xx" in msg or "500" in msg or "server_error" in msg:
        return ErrorCategory.SERVER_ERROR
    return ErrorCategory.FATAL


async def retry_with_backoff(
    coro_factory,
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
):
    """指数退避重试，处理 rate_limit/server_error/timeout"""
    for attempt in range(max_retries + 1):
        try:
            return await coro_factory()
        except Exception as e:
            category = classify_error(e)
            if category == ErrorCategory.FATAL or attempt == max_retries:
                raise
            delay = min(base_delay * (2 ** attempt), max_delay)
            logger.warning("Retry %d/%d after %.1fs (category=%s): %s",
                           attempt + 1, max_retries, delay, category.value, e)
            await asyncio.sleep(delay)


async def recover_from_context_overflow(
    agent, messages: list[dict], gateway
):
    """渐进式上下文压缩：每次丢弃 30% 历史，最多 3 次"""
    for attempt in range(3):
        trim_count = max(1, len(agent._history) * 3 // 10)
        agent._history = agent._history[trim_count:]
        try:
            return await gateway.complete(messages=messages)
        except Exception as e:
            if classify_error(e) != ErrorCategory.CONTEXT_OVERFLOW or attempt == 2:
                raise
            logger.warning("Context overflow recovery attempt %d/3", attempt + 1)
```

### 2.3 集成点

**修改文件：** `src/cabinet/agents/llm_agent.py`

```python
from cabinet.core.resilience import (
    CircuitBreaker, retry_with_backoff, recover_from_context_overflow,
    classify_error, ErrorCategory
)

class LiteLLMAgent:
    def __init__(self, ...):
        ...
        self._tool_breaker = CircuitBreaker(max_failures=3)
        self._api_breaker = CircuitBreaker(max_failures=5, reset_timeout=30.0)

    async def _execute_with_tools(self, ...):
        for round_num in range(10):
            try:
                response = await self._api_breaker.call(
                    lambda: retry_with_backoff(
                        lambda: self._gateway.complete(**kwargs)
                    )
                )
            except CircuitBreakerOpenError:
                # 熔断：直接返回，不再尝试
                return AgentOutput(
                    content="Service temporarily unavailable (circuit breaker open)",
                    status="error"
                )

            tool_calls = getattr(response, "tool_calls", None)
            if not tool_calls:
                ...  # 正常返回

            for tool_call in tool_calls:
                try:
                    result = await self._tool_breaker.call(
                        lambda tc=tool_call: self._execute_tool_call(tc)
                    )
                except CircuitBreakerOpenError:
                    result = {"error": "Tool execution suspended", "status": "error"}
                messages.append(...)
```

### 2.4 测试策略

| 测试 | 描述 |
|------|------|
| `test_circuit_breaker_opens` | 3 次连续失败 → OPEN |
| `test_circuit_breaker_half_open` | OPEN 60s 后 → HALF_OPEN |
| `test_circuit_breaker_closes` | HALF_OPEN 成功 → CLOSED |
| `test_retry_with_backoff` | 指数退避时序正确 |
| `test_error_classification` | 各类错误正确分类 |
| `test_recover_from_overflow` | 上下文溢出渐进压缩 |

---

## 3. P1 — 工具结果大输出截断

### 3.1 现状分析

**当前实现：** `LiteLLMAgent._execute_tool_call()` 直接将工具结果全量塞回上下文，无大小限制。

**问题：**
- Read 工具可能返回 100K+ 文件内容
- Bash 工具可能产生大量 stdout
- 一个大的工具结果可能占据 80% 的 token 预算
- Claude Code 使用三层决策保证 prompt cache 不被破坏

### 3.2 设计方案

**核心思路：** 大结果写临时文件，上下文只留预览 + 路径。

```
工具结果:
  len(result) <= 50K → 直接返回
  len(result) > 50K  → 写 disk，返回:
    [preview: first 2000 chars]
    ...[full content at /tmp/cabinet/tool_<id>_<timestamp>.txt]
```

**新增文件：** `src/cabinet/core/compact.py` (追加)

```python
import tempfile
from pathlib import Path

TOOL_RESULT_MAX_CHARS = 50_000
TOOL_PREVIEW_CHARS = 2_000

_WRITE_TOOLS = {"Write", "Edit", "NotebookEdit"}  # 写工具不缓存到磁盘


def compact_tool_result(
    content: str,
    tool_name: str,
    cache_dir: str | None = None,
) -> tuple[str, str | None]:
    """
    返回 (context_content, file_path_or_None)
    - 小结果: 原样返回
    - 大结果: 返回预览 + 写磁盘
    """
    if len(content) <= TOOL_RESULT_MAX_CHARS:
        return content, None

    if tool_name in _WRITE_TOOLS:
        # Write 工具的结果通常已经写入文件，只保留摘要
        return f"[Write result: {len(content)} chars, content written to target]", None

    cache_dir = Path(cache_dir or tempfile.gettempdir()) / "cabinet" / "tool_results"
    cache_dir.mkdir(parents=True, exist_ok=True)

    filepath = cache_dir / f"tool_{tool_name}_{id(content)}.txt"
    filepath.write_text(content, encoding="utf-8")

    preview = content[:TOOL_PREVIEW_CHARS]
    return (
        f"{preview}\n\n...[truncated: {len(content)} chars total, full content at {filepath}]",
        str(filepath),
    )
```

**修改文件：** `src/cabinet/agents/llm_agent.py`

```python
from cabinet.core.compact import compact_tool_result

async def _execute_tool_call(self, tool_call) -> dict:
    raw_result = await self._tool_registry.execute_tool(tool_name, tool_args)
    result_str = str(raw_result)
    compacted, _ = compact_tool_result(result_str, tool_name)
    return {"result": compacted, "status": "success"}
```

### 3.3 测试策略

| 测试 | 描述 |
|------|------|
| `test_compact_small_result` | 小结果不截断 |
| `test_compact_large_result` | 大结果写文件+返回预览 |
| `test_compact_write_tool` | Write 工具只返回摘要 |

---

## 4. P1 — 确定性 ACL 替代 LLM 权限检查

### 4.1 现状分析

**当前实现：**

```python
# src/cabinet/rooms/office/service.py:437-460
async def check_permission(self, employee_id, action, resource):
    # 调用 LLM 判断权限！
    prompt = f"Evaluate permission for... Employee: {id} Action: {action}"
    response = await self._gateway.complete(messages=[...], model="default")
    return json.loads(response.content)
```

**问题：**
- 权限判断是概率性的（LLM 幻觉风险）
- 每次权限检查产生 LLM 调用（延迟 + 成本）
- 审计日志无法追溯决策链路
- `auth.py` 的 `Role/Permission` 体系未在房间系统内部使用

### 4.2 设计方案

**核心思路：** 确定性优先，LLM 作为升级路径（Claude Code 的 deny→ask→allow 模式）。

```
权限检查流程:
  1. 命中确定性规则 → 直接 allow/deny (0ms)
  2. require_confirm 标记 → 通知用户确认
  3. 无匹配规则 → 记录审计日志 → 升级到 LLM (仅 ambiguous 场景)
```

**新增文件：** `src/cabinet/core/auth.py` (扩展)

```python
from dataclasses import dataclass, field
from enum import Enum


class Decision(str, Enum):
    ALLOW = "allow"
    DENY = "deny"
    ASK = "ask"        # 需要用户确认
    ESCALATE = "escalate"  # 升级到 LLM


@dataclass
class PermissionRule:
    """确定性权限规则"""
    role: str               # "admin", "editor", "viewer", "captain"
    resource: str            # "room:meeting", "tool:bash", "memory:*"
    action: str             # "read", "write", "execute", "delete"
    decision: Decision
    reason: str = ""
    priority: int = 0       # 高优先级规则优先匹配


class AccessControlList:
    """确定性 ACL 引擎"""

    def __init__(self, rules: list[PermissionRule] | None = None):
        self._rules: list[PermissionRule] = list(rules or DEFAULT_RULES)
        self._rules.sort(key=lambda r: r.priority, reverse=True)

    def add_rule(self, rule: PermissionRule) -> None:
        self._rules.append(rule)
        self._rules.sort(key=lambda r: r.priority, reverse=True)

    def check(self, role: str, resource: str, action: str) -> PermissionRule | None:
        """返回第一个匹配的规则，无匹配返回 None（触发升级）"""
        for rule in self._rules:
            if self._match(rule.role, role) \
               and self._match(rule.resource, resource) \
               and self._match(rule.action, action):
                return rule
        return None

    @staticmethod
    def _match(pattern: str, value: str) -> bool:
        if pattern == "*":
            return True
        if pattern.startswith("*") and value.endswith(pattern[1:]):
            return True
        if pattern.endswith("*") and value.startswith(pattern[:-1]):
            return True
        return pattern == value


# 默认规则（覆盖 90% 场景）
DEFAULT_RULES = [
    PermissionRule("captain", "*", "*", Decision.ALLOW, "Captain has full access", 100),
    PermissionRule("admin", "*", "*", Decision.ALLOW, "Admin has full access", 90),
    PermissionRule("editor", "tool:bash", "execute", Decision.ASK,
                   "Bash execution requires confirmation", 50),
    PermissionRule("editor", "tool:write", "execute", Decision.ASK,
                   "File write requires confirmation", 50),
    PermissionRule("editor", "room:*", "read", Decision.ALLOW,
                   "Editors can read all rooms", 40),
    PermissionRule("editor", "memory:*", "write", Decision.ALLOW,
                   "Editors can write memory", 40),
    PermissionRule("viewer", "*", "read", Decision.ALLOW,
                   "Viewers can read everything", 30),
    PermissionRule("viewer", "*", "write", Decision.DENY,
                   "Viewers cannot write", 30),
    PermissionRule("viewer", "*", "execute", Decision.DENY,
                   "Viewers cannot execute", 30),
]
```

**修改文件：** `src/cabinet/rooms/office/service.py`

```python
from cabinet.core.auth import AccessControlList, Decision

class OfficeSchedulerService:
    def __init__(self, ..., acl: AccessControlList | None = None):
        self._acl = acl or AccessControlList()

    async def check_permission(self, employee_id, action, resource) -> bool:
        employee = await self._employee_store.get(employee_id)
        rule = self._acl.check(employee.role, resource, action)

        if rule is None:
            # 无匹配规则 → 升级到 LLM（记录审计）
            await self._audit.log("permission_escalated", {
                "employee": employee_id, "action": action, "resource": resource,
            })
            return await self._llm_fallback_check(employee, action, resource)

        if rule.decision == Decision.DENY:
            await self._audit.log("permission_denied", {"rule": rule.reason})
            return False

        if rule.decision == Decision.ASK:
            # 需要用户确认（TUI 或 API 层处理）
            raise ConfirmationRequired(
                f"{rule.reason}\nAllow {employee.role} to {action} on {resource}?"
            )

        return True  # ALLOW
```

### 4.3 测试策略

| 测试 | 描述 |
|------|------|
| `test_acl_match_exact` | 精确匹配 |
| `test_acl_match_wildcard` | 通配符匹配 |
| `test_acl_priority` | 高优先级覆盖低优先级 |
| `test_acl_no_match_escalates` | 无规则 → 返回 None |
| `test_office_permission_deterministic` | 确定性规则不调 LLM |

---

## 5. P2 — 文件型 Memory 后端

### 5.1 现状分析

**当前实现：**
- `SQLiteMemoryStore`（FTS5 全文搜索，127 行）
- `ChromaDBMemoryStore`（向量语义搜索，101 行）
- 双轨道维护成本高，ChromaDB 启动慢

**Claude Code 做法：**
- 文件系统优先：`~/.claude/projects/<hash>/memory/<type>/<name>.md`
- YAML frontmatter (name, description, type) + Markdown body
- LLM 扫描头部 `MEMORY.md` → 选择最多 5 个文件 → 全文读取

### 5.2 设计方案

**核心思路：** 新增轻量文件后端，保留 SQLite 用于事务/事件存储。

```
memory/
├── MEMORY.md            # 索引文件（所有记忆的头部信息）
├── user/
│   ├── role.md
│   └── preferences.md
├── project/
│   ├── tech-stack.md
│   └── roadmap.md
├── feedback/
│   └── testing-strategy.md
└── reference/
    └── external-docs.md
```

**新增文件：** `src/cabinet/core/memory/file_store.py`

```python
from __future__ import annotations

import os
import re
import yaml
from dataclasses import dataclass
from pathlib import Path

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


@dataclass
class FileMemoryItem:
    name: str
    description: str
    type: str          # user, project, feedback, reference
    content: str        # Markdown body (不含 frontmatter)
    filepath: Path | None = None

    @classmethod
    def from_file(cls, path: Path) -> "FileMemoryItem":
        text = path.read_text(encoding="utf-8")
        m = FRONTMATTER_RE.match(text)
        if m:
            meta = yaml.safe_load(m.group(1)) or {}
            body = text[m.end():]
        else:
            meta = {}
            body = text
        return cls(
            name=meta.get("name", path.stem),
            description=meta.get("description", ""),
            type=meta.get("type", path.parent.name),
            content=body.strip(),
            filepath=path,
        )

    def to_markdown(self) -> str:
        frontmatter = yaml.dump({
            "name": self.name,
            "description": self.description,
            "type": self.type,
        }, allow_unicode=True).strip()
        return f"---\n{frontmatter}\n---\n\n{self.content}"


class FileMemoryStore:
    """Claude Code-style 文件系统记忆存储"""

    def __init__(self, base_dir: str):
        self.base_dir = Path(base_dir)

    def store(self, item: FileMemoryItem) -> Path:
        dir_path = self.base_dir / item.type
        dir_path.mkdir(parents=True, exist_ok=True)
        filepath = dir_path / f"{item.name}.md"
        filepath.write_text(item.to_markdown(), encoding="utf-8")
        self._rebuild_index()
        return filepath

    def list_headers(self) -> list[dict]:
        """扫描所有记忆文件的 YAML 头部（低成本，无需 LLM）"""
        headers = []
        if not self.base_dir.exists():
            return headers
        for md_file in sorted(self.base_dir.glob("**/*.md")):
            if md_file.name == "MEMORY.md":
                continue
            try:
                item = FileMemoryItem.from_file(md_file)
                headers.append({
                    "name": item.name,
                    "description": item.description,
                    "type": item.type,
                    "filepath": str(md_file),
                })
            except Exception:
                continue
        return headers

    def get(self, name: str, type: str) -> FileMemoryItem | None:
        filepath = self.base_dir / type / f"{name}.md"
        if not filepath.exists():
            return None
        return FileMemoryItem.from_file(filepath)

    def delete(self, name: str, type: str) -> None:
        filepath = self.base_dir / type / f"{name}.md"
        if filepath.exists():
            filepath.unlink()
            self._rebuild_index()

    def _rebuild_index(self) -> None:
        """重建 MEMORY.md 索引文件"""
        headers = self.list_headers()
        lines = ["# Memory Index\n"]
        for h in headers:
            lines.append(f"- [{h['name']}]({h['type']}/{h['name']}.md) — {h['description']}")
        index_path = self.base_dir / "MEMORY.md"
        index_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
```

**修改文件：** `src/cabinet/cli/main.py` — 在 `_init_runtime` 中添加 FileMemoryStore 初始化

```python
from cabinet.core.memory.file_store import FileMemoryStore

async def _init_runtime(data_dir: str):
    ...
    file_memory = FileMemoryStore(os.path.join(data_dir, "memory"))
    ...
```

### 5.3 优势对比

| 维度 | SQLiteMemoryStore | ChromaDBMemoryStore | FileMemoryStore (新) |
|------|-------------------|---------------------|----------------------|
| 启动速度 | 快 | 慢 (ChromaDB 加载) | 即时 |
| 搜索方式 | FTS5 (关键词) | 向量 (语义) | LLM 扫描头部 |
| 人类可读 | 否 | 否 | **是** (Markdown 文件) |
| Git 可追踪 | 否 | 否 | **是** |
| 依赖 | aiosqlite | chromadb | 标准库 |
| 适用场景 | 事务/事件存储 | 语义搜索 | **短期记忆/配置** |

### 5.4 测试策略

| 测试 | 描述 |
|------|------|
| `test_file_store_and_retrieve` | 存储+读取往返 |
| `test_file_list_headers` | 扫描头部信息 |
| `test_file_frontmatter_parsing` | YAML 前置元数据解析 |
| `test_file_delete_and_rebuild` | 删除后索引重建 |

---

## 6. P2 — 配置层次化

### 6.1 现状分析

**当前实现：** 单一 `data/cabinet.json`，无层次叠加、无本地覆盖、无版本迁移。

**Claude Code 做法：** 4 层叠加：
1. Managed (`/etc/claude/`)
2. User (`~/.claude/`)
3. Project (`.claude/CLAUDE.md`, `.claude/settings.json`)
4. Local (`CLAUDE.local.md`, `.claude/settings.local.json`)

### 6.2 设计方案

**核心思路：** 3 层 JSON 配置叠加 + 可选 CLAUDE.md 模式。

```
配置加载顺序（后面覆盖前面）:
  Layer 1: 内置默认值 (代码中定义)
  Layer 2: ~/.cabinet/config.json (用户全局设置)
  Layer 3: <data_dir>/cabinet.json (项目设置)
  Layer 4: <data_dir>/cabinet.local.json (本地覆盖, gitignored)

命令行参数 --config key=value 运行时覆盖最高优先级
```

**修改文件：** `src/cabinet/cli/config.py`

```python
import json
from pathlib import Path

def _deep_merge(base: dict, override: dict) -> dict:
    """递归合并配置字典"""
    result = dict(base)
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_config_hierarchical(data_dir: str) -> CabinetConfig:
    """4 层配置叠加：default → user → project → local"""
    config_dict: dict = {}

    # Layer 1: 内置默认值
    config_dict = _default_config_dict()

    # Layer 2: ~/.cabinet/config.json
    user_config = Path.home() / ".cabinet" / "config.json"
    if user_config.exists():
        config_dict = _deep_merge(config_dict, json.loads(user_config.read_text()))

    # Layer 3: <data_dir>/cabinet.json
    project_config = Path(data_dir) / "cabinet.json"
    if project_config.exists():
        config_dict = _deep_merge(config_dict, json.loads(project_config.read_text()))

    # Layer 4: <data_dir>/cabinet.local.json (gitignored)
    local_config = Path(data_dir) / "cabinet.local.json"
    if local_config.exists():
        config_dict = _deep_merge(config_dict, json.loads(local_config.read_text()))

    return CabinetConfig(**config_dict)


def _default_config_dict() -> dict:
    return {
        "organization": {"name": "Default Org", "captain_id": ""},
        "default_project": None,
        "memory_type": "sqlite",
        "auth_required": False,
        "model_config_path": "models.json",
        "employees_path": "employees.json",
        "skills_dir": "skills",
        "mcp_servers": [],
        "api_keys": {},
        "api_tokens": [],
        "cors_origins": ["*"],
        "observability": {"enabled": True, "log_level": "INFO", "log_format": "text"},
    }
```

**新增文件：** `.gitignore` 条目

```
data/cabinet.local.json
```

### 6.3 测试策略

| 测试 | 描述 |
|------|------|
| `test_load_config_default` | 无任何文件 → 使用默认值 |
| `test_load_config_project_override` | 项目文件覆盖默认值 |
| `test_load_config_local_override` | 本地文件覆盖项目值 |
| `test_load_config_deep_merge` | 嵌套字典递归合并 |
| `test_load_config_local_gitignored` | 本地文件不在 git 中 |

---

## 7. P3 — LLM 对话摘要压缩

### 7.1 现状分析

**Claude Code 做法：**

```
AutoCompact (最后一层):
  Trigger: effectiveWindow - 13K tokens < 0

  Path A (优先): Session Memory Compact
    → 读取已有 session memory 文件
    → 不产生额外 LLM 调用

  Path B (回退): LLM Summary
    → fork agent 共享缓存前缀
    → 输出: <analysis> + <summary> (analysis 最终丢弃)
    → 重注入: 最多 5 个最近读取的文件 + skills + MCP instructions

  Circuit breaker: 3 次连续失败 → 停止
```

### 7.2 设计方案

**核心思路：** 二级摘要策略——先尝试会话记忆复用，失败后才调用 LLM。

```
摘要触发条件:
  tokens_used > model_max * 0.85  → 触发压缩

压缩流程:
  1. 尝试 Session Memory: 读取 data/memory/session.md
     → 存在且新鲜 (< 5 min 未更新) → 注入为 system 消息 ✓ (0 cost)

  2. 回退 LLM Summary:
     → 用 cheap 模型 (deepseek-v4-flash) 摘要历史
     → <analysis> 部分丢弃 (减少注入 token)
     → <summary> 注入为 system 消息
     → 保留最近 3 轮对话

  3. 熔断: 3 次连续失败 → 回退到硬截断
```

**新增文件：** `src/cabinet/core/compact.py` (追加)

```python
import time
from pathlib import Path

# ... (之前的 TokenBudget, compact_tool_result)


@dataclass
class SessionMemory:
    """会话级别的摘要持久化"""
    summary: str
    key_decisions: list[str]
    pending_tasks: list[str]
    updated_at: float = field(default_factory=time.monotonic)
    token_count: int = 0

    STALE_THRESHOLD: float = 300.0  # 5 分钟过期

    @property
    def is_fresh(self) -> bool:
        return (time.monotonic() - self.updated_at) < self.STALE_THRESHOLD

    @classmethod
    def load(cls, path: Path) -> "SessionMemory | None":
        if not path.exists():
            return None
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not data:
            return None
        return cls(**data)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(yaml.dump({
            "summary": self.summary,
            "key_decisions": self.key_decisions,
            "pending_tasks": self.pending_tasks,
            "updated_at": self.updated_at,
            "token_count": self.token_count,
        }, allow_unicode=True), encoding="utf-8")


async def summarize_with_llm(
    history: list[dict],
    gateway,
    model: str = "default",
) -> str:
    """用 LLM 摘要对话历史。返回纯 summary（含 analysis 已被剥离）。"""
    prompt = f"""<analysis>
Analyze the conversation history below. Identify:
1. Key decisions made (with rationale)
2. Pending tasks / unresolved items
3. Important constraints or context that must be preserved
4. Files/entities mentioned that may need to be referenced again
</analysis>

<summary>
Condense the essential context from the conversation into a compact summary.
Focus on WHAT was decided, WHAT is pending, and WHY.
Omit conversational filler, greetings, and redundant explanations.
</summary>

## Conversation History
{format_history(history)}
"""
    response = await gateway.complete(
        messages=[{"role": "user", "content": prompt}],
        model=model,
        temperature=0.3,
    )
    # 提取 <summary> 部分（丢弃 <analysis>）
    import re
    m = re.search(r"<summary>(.*?)</summary>", response.content, re.DOTALL)
    return m.group(1).strip() if m else response.content[:2000]


def format_history(history: list[dict], max_chars_per_msg: int = 500) -> str:
    """格式化对话历史为摘要输入"""
    lines = []
    for msg in history:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")[:max_chars_per_msg]
        lines.append(f"[{role}]: {content}")
    return "\n".join(lines)


class ContextCompactor:
    """上下文压缩编排器"""

    def __init__(
        self,
        gateway,
        session_memory_path: Path | None = None,
        model: str = "default",
        max_failures: int = 3,
    ):
        self._gateway = gateway
        self._session_path = session_memory_path
        self._model = model
        self._failure_count = 0
        self._max_failures = max_failures

    async def compact(
        self,
        history: list[dict],
        budget: TokenBudget,
    ) -> tuple[str, SessionMemory | None]:
        """返回 (summary_text, updated_session_memory)"""

        if self._failure_count >= self._max_failures:
            return "[Compaction suspended — circuit breaker open]", None

        # Path A: 复用 Session Memory
        if self._session_path:
            mem = SessionMemory.load(self._session_path)
            if mem and mem.is_fresh:
                return mem.summary, mem

        # Path B: LLM Summary
        try:
            summary = await summarize_with_llm(history, self._gateway, self._model)
            mem = SessionMemory(
                summary=summary,
                key_decisions=[],
                pending_tasks=[],
                token_count=budget.estimate_tokens(summary),
            )
            if self._session_path:
                mem.save(self._session_path)
            self._failure_count = 0
            return summary, mem
        except Exception as e:
            self._failure_count += 1
            logger.error("Compaction failed (%d/%d): %s",
                         self._failure_count, self._max_failures, e)
            return f"[Compaction failed: {e}]", None
```

### 7.3 集成点

**修改文件：** `src/cabinet/agents/llm_agent.py`

```python
from cabinet.core.compact import TokenBudget, ContextCompactor

class LiteLLMAgent:
    def __init__(self, ..., enable_compaction: bool = True,
                 session_dir: str | None = None):
        ...
        self._compactor = ContextCompactor(
            gateway=self._gateway,
            session_memory_path=Path(session_dir) / "session.md" if session_dir else None,
        ) if enable_compaction else None

    async def _maybe_compact(self, messages: list[dict]) -> str | None:
        """在 token 预算紧张时触发压缩"""
        budget = TokenBudget()
        estimated = budget.estimate_messages(messages)
        if estimated < budget.max_input_tokens * 0.85:
            return None  # 不紧张

        summary, _ = await self._compactor.compact(self._history, budget)
        return summary
```

### 7.4 测试策略

| 测试 | 描述 |
|------|------|
| `test_summarize_extracts_summary_tag` | 正确提取 summary 部分 |
| `test_summarize_fallback_no_tags` | 无标签时截断返回 |
| `test_session_memory_load_save` | 会话记忆持久化往返 |
| `test_session_memory_stale_check` | 过期检测 |
| `test_compactor_circuit_breaker` | 3 次失败 → 熔断 |

---

## 8. P3 — 工具并发安全分区

### 8.1 现状分析

**当前实现：** `LiteLLMAgent._execute_with_tools()` 中所有工具调用串行执行（`for tool_call in tool_calls`）。

**Claude Code 做法：** `StreamingToolExecutor` 将工具分为 `concurrencySafe` 和 `exclusive`，在排他屏障之间并行执行安全工具。

```
Tool calls: [Read, Grep, Bash, Glob, Write, Read]
Partitions:  [──── parallel ────] [serial] [── parallel ──] [serial] [serial]
```

### 8.2 设计方案

**核心思路：** 工具元数据标记并发安全性，执行时按分区调度。

**新增文件：** `src/cabinet/agents/tools.py` (追加)

```python
# 并发安全/排他工具分类
CONCURRENT_SAFE_TOOLS: set[str] = {
    "Read", "Grep", "Glob", "WebSearch", "WebFetch",
    "TodoRead", "TodoWrite",
}
EXCLUSIVE_TOOLS: set[str] = {
    "Bash", "Write", "Edit", "NotebookEdit",
}
# 不在上面列表中的 → 默认串行（安全优先）


def is_concurrency_safe(tool_name: str) -> bool:
    """工具是否可以与其他安全工具并行执行"""
    return tool_name in CONCURRENT_SAFE_TOOLS


def partition_tool_calls(tool_calls: list) -> list[list]:
    """
    按安全边界分区：同区串行，异区并行。

    [Read, Grep, Bash, Glob, Write]
    → [[Read, Grep], [Bash], [Glob], [Write]]

    排他工具（Bash/Write/Edit）独占一个分区。
    连续的安全工具合并到一个分区。
    """
    if not tool_calls:
        return []

    partitions = []
    current_batch = []

    for tc in tool_calls:
        name = tc.function.name if hasattr(tc, 'function') else tc.get("function", {}).get("name", "")
        if name in EXCLUSIVE_TOOLS:
            if current_batch:
                partitions.append(current_batch)
                current_batch = []
            partitions.append([tc])
        else:
            current_batch.append(tc)

    if current_batch:
        partitions.append(current_batch)

    return partitions
```

**修改文件：** `src/cabinet/agents/llm_agent.py`

```python
from cabinet.agents.tools import partition_tool_calls, is_concurrency_safe

async def _execute_with_tools_partitioned(self, ..., tool_calls):
    """分区并行/串行执行工具调用"""
    partitions = partition_tool_calls(tool_calls)
    all_results = []

    for batch in partitions:
        if len(batch) == 1 and not is_concurrency_safe(self._get_tool_name(batch[0])):
            # 排他工具：串行执行
            result = await self._execute_tool_call(batch[0])
            all_results.append(result)
        else:
            # 安全工具：并行执行
            batch_results = await asyncio.gather(*[
                self._execute_tool_call(tc) for tc in batch
            ], return_exceptions=True)
            for i, result in enumerate(batch_results):
                if isinstance(result, Exception):
                    all_results.append({"error": str(result), "status": "error"})
                else:
                    all_results.append(result)

    return all_results
```

### 8.3 测试策略

| 测试 | 描述 |
|------|------|
| `test_partition_mixed_tools` | Read+Grep+Bash+Glob → 3 分区 |
| `test_partition_all_safe` | 全安全工具 → 1 分区 |
| `test_partition_all_exclusive` | 全排他工具 → 各自独立分区 |
| `test_partition_empty` | 空列表 → 空结果 |
| `test_concurrent_safe_list` | 验证分类列表完整性 |

---

## 9. 文件变更汇总

```
新增文件 (6):
  src/cabinet/core/compact.py          # TokenBudget + compact_tool_result + SessionMemory
  src/cabinet/core/resilience.py       # CircuitBreaker + retry_with_backoff
  src/cabinet/core/memory/file_store.py # FileMemoryStore

修改文件 (7):
  src/cabinet/core/auth.py             # AccessControlList + PermissionRule
  src/cabinet/agents/llm_agent.py      # Token预算 + 熔断 + 工具分区 + 摘要
  src/cabinet/agents/tools.py          # 并发安全分类 + partition_tool_calls
  src/cabinet/cli/config.py            # load_config_hierarchical
  src/cabinet/cli/main.py              # FileMemoryStore 初始化
  src/cabinet/rooms/secretary/conversation.py  # Token 替代消息条数
  src/cabinet/rooms/office/service.py  # ACL 集成

新增测试文件 (4):
  tests/unit/core/test_compact.py
  tests/unit/core/test_resilience.py
  tests/unit/core/test_file_memory.py
  tests/unit/core/test_acl.py

修改测试文件 (3):
  tests/unit/agents/test_llm_agent.py
  tests/unit/cli/test_config.py
  tests/unit/rooms/test_office.py

无破坏性变更 — 所有新增参数有默认值。
```

---

## 10. 交付里程碑

| 里程碑 | 内容 | 预期日期 |
|--------|------|---------|
| M1: P0 完成 | Token 预算 + 熔断器 | 第 1 周末 |
| M2: P1 完成 | 工具结果截断 + ACL | 第 3 周末 |
| M3: P2 完成 | 文件 Memory + 配置层次 | 第 5 周末 |
| M4: P3 完成 | LLM 摘要 + 工具分区 | 第 7 周末 |

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| token 估算不精确 | 上下文溢出或浪费 | 使用 litellm token_counter 精确计算 |
| 熔断参数过于激进 | 正常操作被阻断 | 默认值保守 (3 failures, 60s timeout)，可配置 |
| ACL 规则覆盖不全 | LLM 升级频率过高 | 从审计日志收集未覆盖规则，持续完善默认规则 |
| 文件 Memory INDEX.md 过大 | LLM 上下文浪费 | INDEX.md 行数限制 200 行，超出时提示清理 |
| LLM 摘要质量不稳定 | 丢失关键上下文 | Path A (Session Memory) 优先，减少 LLM 调用次数 |
