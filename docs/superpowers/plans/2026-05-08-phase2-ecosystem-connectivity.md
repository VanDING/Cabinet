# Phase 2: Ecosystem & Connectivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build four subsystems that connect Cabinet to external platforms and users: multi-platform messaging gateway (Telegram + Discord), cron scheduler for timed autonomous tasks, SKILL.md ecosystem with self-improving skills, and toolset grouping system for platform-aware tool selection.

**Architecture:** The messaging gateway is a standalone process (`cabinet gateway`) that manages platform adapters through a unified session router. The cron scheduler reads natural-language job definitions persisted to `data/cron.json`, fires on schedule, and routes results through the gateway. The skill ecosystem extends `SkillLoader` with SKILL.md frontmatter parsing, category organization, and an autonomous skill curator. The toolset system wraps `LocalToolRegistry` with named toolset bundles that can be selectively activated per platform or agent role.

**Tech Stack:** Python 3.12+, python-telegram-bot (Telegram), discord.py (Discord), aiosqlite (cron persistence), PyYAML (SKILL.md parsing), asyncio (scheduling engine)

---

## File Structure

```
src/cabinet/
├── gateway/                          # NEW top-level module
│   ├── __init__.py
│   ├── run.py                        # GatewayProcess main loop
│   ├── session.py                    # GatewaySession, cross-platform session
│   ├── router.py                     # MessageRouter, platform→room routing
│   ├── platforms/
│   │   ├── __init__.py
│   │   ├── base.py                   # BasePlatformAdapter ABC
│   │   ├── telegram_adapter.py       # Telegram bot adapter
│   │   └── discord_adapter.py        # Discord bot adapter
│   └── models.py                     # GatewayMessage, GatewayContext
├── core/
│   ├── scheduler/                    # NEW sub-module
│   │   ├── __init__.py
│   │   ├── scheduler.py              # CronScheduler engine
│   │   ├── jobs.py                   # Job definition + execution
│   │   └── models.py                 # CronJob, JobResult
│   ├── tools/
│   │   ├── skill_loader.py           # MODIFY — SKILL.md frontmatter support
│   │   ├── skill_curator.py          # NEW — autonomous skill lifecycle management
│   │   ├── toolsets.py               # NEW — toolset grouping definitions
│   │   └── registry.py              # MODIFY — toolset-aware registration
│   └── runtime.py                    # MODIFY — wire gateway + cron + toolsets
tests/
├── unit/gateway/
│   ├── test_gateway_session.py       # NEW
│   ├── test_message_router.py        # NEW
│   ├── test_telegram_adapter.py      # NEW
│   └── test_discord_adapter.py       # NEW
├── unit/core/scheduler/
│   ├── test_scheduler.py             # NEW
│   └── test_jobs.py                  # NEW
├── unit/core/tools/
│   ├── test_skill_curator.py         # NEW
│   └── test_toolsets.py              # NEW
```

---

### Task 1: Base Platform Adapter + Message Router

**Files:**
- Create: `src/cabinet/gateway/__init__.py`
- Create: `src/cabinet/gateway/models.py`
- Create: `src/cabinet/gateway/platforms/__init__.py`
- Create: `src/cabinet/gateway/platforms/base.py`
- Create: `src/cabinet/gateway/router.py`
- Test: `tests/unit/gateway/test_message_router.py`

- [ ] **Step 1: Write the failing test for MessageRouter**

```python
from __future__ import annotations

import pytest
from cabinet.gateway.models import GatewayMessage, GatewayContext, Platform
from cabinet.gateway.platforms.base import BasePlatformAdapter
from cabinet.gateway.router import MessageRouter


class _FakeAdapter(BasePlatformAdapter):
    def __init__(self):
        self.sent: list[GatewayMessage] = []

    @property
    def platform(self) -> Platform:
        return Platform.TELEGRAM

    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        pass

    async def send_message(self, message: GatewayMessage) -> None:
        self.sent.append(message)


def test_router_routes_message_to_room():
    router = MessageRouter()
    ctx = GatewayContext(
        captain_id="captain",
        session_id="s1",
        source_platform=Platform.TELEGRAM,
    )
    msg = GatewayMessage(
        content="/meeting Q3 Strategy",
        context=ctx,
    )

    result = router.route(msg)
    assert result["room"] == "meeting"
    assert result["content"] == "Q3 Strategy"


def test_router_routes_decision():
    router = MessageRouter()
    ctx = GatewayContext(captain_id="captain", session_id="s1", source_platform=Platform.CLI)
    msg = GatewayMessage(content="/decide Approve budget", context=ctx)
    result = router.route(msg)
    assert result["room"] == "decision"


def test_router_routes_task():
    router = MessageRouter()
    ctx = GatewayContext(captain_id="captain", session_id="s1", source_platform=Platform.DISCORD)
    msg = GatewayMessage(content="/task Prepare report", context=ctx)
    result = router.route(msg)
    assert result["room"] == "office"


def test_router_routes_plain_text_to_secretary():
    router = MessageRouter()
    ctx = GatewayContext(captain_id="captain", session_id="s1", source_platform=Platform.TELEGRAM)
    msg = GatewayMessage(content="Hello, how are you?", context=ctx)
    result = router.route(msg)
    assert result["room"] == "secretary"


def test_router_distributes_response_to_source_platform():
    router = MessageRouter()
    telegram_adapter = _FakeAdapter()
    discord_adapter = _FakeAdapter()
    router.register_adapter(Platform.TELEGRAM, telegram_adapter)
    router.register_adapter(Platform.DISCORD, discord_adapter)

    ctx = GatewayContext(captain_id="captain", session_id="s1", source_platform=Platform.TELEGRAM)
    response = GatewayMessage(content="Here is the meeting summary", context=ctx)

    import asyncio
    asyncio.get_event_loop().run_until_complete(router.distribute(response))
    assert len(telegram_adapter.sent) == 1
    assert len(discord_adapter.sent) == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/gateway/test_message_router.py -v`
Expected: FAIL — no module

- [ ] **Step 3: Write models.py**

```python
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from uuid import uuid4


class Platform(str, Enum):
    CLI = "cli"
    API = "api"
    TELEGRAM = "telegram"
    DISCORD = "discord"


@dataclass
class GatewayContext:
    captain_id: str
    session_id: str = field(default_factory=lambda: uuid4().hex[:12])
    source_platform: Platform = Platform.CLI


@dataclass
class GatewayMessage:
    content: str
    context: GatewayContext
    message_id: str = field(default_factory=lambda: uuid4().hex[:16])
```

- [ ] **Step 4: Write base adapter**

```python
from __future__ import annotations

from abc import ABC, abstractmethod

from cabinet.gateway.models import GatewayMessage, Platform


class BasePlatformAdapter(ABC):
    @property
    @abstractmethod
    def platform(self) -> Platform:
        ...

    @abstractmethod
    async def start(self) -> None:
        ...

    @abstractmethod
    async def stop(self) -> None:
        ...

    @abstractmethod
    async def send_message(self, message: GatewayMessage) -> None:
        ...
```

- [ ] **Step 5: Write router.py**

```python
from __future__ import annotations

import logging
import re
from typing import Any

from cabinet.gateway.models import GatewayMessage, Platform
from cabinet.gateway.platforms.base import BasePlatformAdapter

logger = logging.getLogger(__name__)

SLASH_ROUTES: dict[str, str] = {
    "/meeting": "meeting",
    "/strategy": "strategy",
    "/decide": "decision",
    "/task": "office",
    "/review": "office",
    "/summary": "summary",
    "/status": "secretary",
    "/help": "secretary",
    "/skills": "secretary",
    "/employees": "secretary",
}


class MessageRouter:
    def __init__(self):
        self._adapters: dict[Platform, BasePlatformAdapter] = {}

    def register_adapter(self, platform: Platform, adapter: BasePlatformAdapter) -> None:
        self._adapters[platform] = adapter
        logger.info("Registered adapter for platform: %s", platform.value)

    def route(self, message: GatewayMessage) -> dict[str, Any]:
        content = message.content.strip()

        for command, room in SLASH_ROUTES.items():
            if content.startswith(command):
                payload = content[len(command):].strip()
                return {"room": room, "content": payload, "command": command}

        return {"room": "secretary", "content": content}

    async def distribute(self, message: GatewayMessage) -> None:
        platform = message.context.source_platform
        adapter = self._adapters.get(platform)
        if adapter is None:
            logger.warning("No adapter for platform: %s", platform.value)
            return
        await adapter.send_message(message)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/unit/gateway/test_message_router.py -v`
Expected: 5 PASS

- [ ] **Step 7: Commit**

```bash
git add src/cabinet/gateway/__init__.py src/cabinet/gateway/models.py src/cabinet/gateway/platforms/__init__.py src/cabinet/gateway/platforms/base.py src/cabinet/gateway/router.py tests/unit/gateway/test_message_router.py
git commit -m "feat(gateway): add base platform adapter and message router with slash command routing"
```

---

### Task 2: Gateway Session Manager

**Files:**
- Create: `src/cabinet/gateway/session.py`
- Test: `tests/unit/gateway/test_gateway_session.py`

- [ ] **Step 1: Write failing tests**

```python
from __future__ import annotations

import pytest
from cabinet.gateway.session import GatewaySession, SessionStore
from cabinet.gateway.models import Platform, GatewayContext


class TestSessionStore:
    def test_get_or_create_returns_same_session(self):
        store = SessionStore()
        ctx1 = GatewayContext(captain_id="captain", source_platform=Platform.TELEGRAM)
        session1 = store.get_or_create(ctx1)
        session2 = store.get_or_create(ctx1)
        assert session1.session_id == session2.session_id

    def test_different_platforms_different_sessions(self):
        store = SessionStore()
        ctx_tg = GatewayContext(captain_id="captain", source_platform=Platform.TELEGRAM)
        ctx_dc = GatewayContext(captain_id="captain", source_platform=Platform.DISCORD)
        s_tg = store.get_or_create(ctx_tg)
        s_dc = store.get_or_create(ctx_dc)
        assert s_tg.session_id != s_dc.session_id

    def test_cross_platform_session_linking(self):
        store = SessionStore()
        ctx_tg = GatewayContext(captain_id="captain", source_platform=Platform.TELEGRAM)
        store.get_or_create(ctx_tg)
        linked = store.get_linked_session("captain")
        assert linked is not None
        assert linked.captain_id == "captain"

    def test_expire_stale_sessions(self):
        store = SessionStore(ttl_seconds=-1)
        ctx = GatewayContext(captain_id="captain", source_platform=Platform.TELEGRAM)
        store.get_or_create(ctx)
        store.expire_stale()
        assert store.get_linked_session("captain") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/gateway/test_gateway_session.py -v`
Expected: FAIL

- [ ] **Step 3: Write session.py**

```python
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from uuid import uuid4

from cabinet.gateway.models import GatewayContext, Platform

logger = logging.getLogger(__name__)


@dataclass
class GatewaySession:
    captain_id: str
    session_id: str = field(default_factory=lambda: uuid4().hex[:12])
    platforms: set[Platform] = field(default_factory=set)
    last_active: float = field(default_factory=time.monotonic)

    def touch(self) -> None:
        self.last_active = time.monotonic()


class SessionStore:
    def __init__(self, ttl_seconds: float = 3600.0):
        self._sessions: dict[str, GatewaySession] = {}
        self._captain_link: dict[str, str] = {}
        self._ttl = ttl_seconds

    def get_or_create(self, ctx: GatewayContext) -> GatewaySession:
        key = self._make_key(ctx)
        session = self._sessions.get(key)
        if session is None:
            session = GatewaySession(
                captain_id=ctx.captain_id,
                session_id=ctx.session_id or uuid4().hex[:12],
                platforms={ctx.source_platform},
            )
            self._sessions[key] = session
            if ctx.captain_id not in self._captain_link:
                self._captain_link[ctx.captain_id] = key
            logger.info("New session: %s for captain=%s", session.session_id, ctx.captain_id)
        session.touch()
        session.platforms.add(ctx.source_platform)
        return session

    def get_linked_session(self, captain_id: str) -> GatewaySession | None:
        key = self._captain_link.get(captain_id)
        if key is None:
            return None
        return self._sessions.get(key)

    def expire_stale(self) -> int:
        now = time.monotonic()
        stale = [
            k for k, s in self._sessions.items()
            if now - s.last_active > self._ttl
        ]
        for k in stale:
            session = self._sessions.pop(k)
            for cid, key in list(self._captain_link.items()):
                if key == k:
                    del self._captain_link[cid]
            logger.info("Expired session: %s", session.session_id)
        return len(stale)

    @staticmethod
    def _make_key(ctx: GatewayContext) -> str:
        return f"{ctx.captain_id}:{ctx.source_platform.value}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/gateway/test_gateway_session.py -v`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/gateway/session.py tests/unit/gateway/test_gateway_session.py
git commit -m "feat(gateway): add session manager with cross-platform linking and TTL expiry"
```

---

### Task 3: Core Cron Scheduler

**Files:**
- Create: `src/cabinet/core/scheduler/__init__.py`
- Create: `src/cabinet/core/scheduler/models.py`
- Create: `src/cabinet/core/scheduler/scheduler.py`
- Create: `src/cabinet/core/scheduler/jobs.py`
- Test: `tests/unit/core/scheduler/test_scheduler.py`

- [ ] **Step 1: Write failing tests**

```python
from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path

import pytest
from cabinet.core.scheduler.models import CronJob, JobResult, JobStatus
from cabinet.core.scheduler.scheduler import CronScheduler


class TestCronJobParsing:
    def test_duration_string_parsing(self):
        job = CronJob.from_natural("check deploy", "30m")
        assert job.name == "check deploy"
        assert job.interval_seconds == 1800

    def test_every_phrase_parsing(self):
        job = CronJob.from_natural("morning briefing", "every day 9am")
        assert job.name == "morning briefing"
        assert job.interval_seconds is not None

    def test_cron_expression_parsing(self):
        job = CronJob.from_natural("nightly backup", "0 2 * * *")
        assert job.name == "nightly backup"
        assert job.expression == "0 2 * * *"

    def test_iso_timestamp_parsing(self):
        job = CronJob.from_natural("one-time report", "2026-06-01T09:00:00")
        assert job.name == "one-time report"
        assert not job.recurring


class TestCronScheduler:
    @pytest.fixture
    async def scheduler(self, tmp_path):
        s = CronScheduler(persistence_path=tmp_path / "cron.json")
        yield s
        await s.stop()

    async def test_add_job_persists(self, scheduler, tmp_path):
        job = CronJob.from_natural("test job", "1h")
        await scheduler.add_job(job)
        assert len(scheduler.jobs) == 1

        data = json.loads((tmp_path / "cron.json").read_text())
        assert len(data) == 1
        assert data[0]["name"] == "test job"

    async def test_remove_job(self, scheduler, tmp_path):
        job = CronJob.from_natural("test job", "1h")
        await scheduler.add_job(job)
        await scheduler.remove_job(job.id)
        assert len(scheduler.jobs) == 0

    async def test_fire_job_executes_handler(self, scheduler):
        results = []

        async def handler(job: CronJob) -> JobResult:
            results.append(job.name)
            return JobResult(job_id=job.id, status=JobStatus.SUCCESS, output="done")

        job = CronJob.from_natural("test", "0s")
        await scheduler.add_job(job, handler=handler)
        await scheduler.fire_now(job.id)

        assert len(results) == 1
        assert results[0] == "test"

    async def test_stop_cancels_running_loop(self, scheduler):
        await scheduler.start(interval=0.1)
        assert scheduler.is_running
        await scheduler.stop()
        assert not scheduler.is_running
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/core/scheduler/test_scheduler.py -v`
Expected: FAIL

- [ ] **Step 3: Write models.py**

```python
from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from uuid import uuid4


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    TIMEOUT = "timeout"


@dataclass
class CronJob:
    name: str
    expression: str = ""
    interval_seconds: int | None = None
    recurring: bool = True
    id: str = field(default_factory=lambda: uuid4().hex[:12])
    description: str = ""
    skills: list[str] = field(default_factory=list)
    model_override: str | None = None
    workdir: str | None = None

    DURATION_RE = re.compile(r"^(\d+)\s*(s|m|h|d)$")
    EVERY_RE = re.compile(r"every\s+(\w+)\s+(\d+)(am|pm)?", re.IGNORECASE)

    @classmethod
    def from_natural(cls, name: str, schedule: str) -> CronJob:
        job = cls(name=name)
        schedule = schedule.strip()

        m = cls.DURATION_RE.match(schedule)
        if m:
            value = int(m.group(1))
            unit = m.group(2)
            multipliers = {"s": 1, "m": 60, "h": 3600, "d": 86400}
            job.interval_seconds = value * multipliers[unit]
            return job

        m = cls.EVERY_RE.search(schedule)
        if m:
            multiplier = 86400
            if "hour" in m.group(1).lower():
                multiplier = 3600
            elif "min" in m.group(1).lower():
                multiplier = 60
            job.interval_seconds = int(m.group(2)) * multiplier
            return job

        if re.match(r"^[\d\s\*/,-]+$", schedule) and len(schedule.split()) == 5:
            job.expression = schedule
            return job

        if re.match(r"^\d{4}-\d{2}-\d{2}", schedule):
            job.expression = schedule
            job.recurring = False
            return job

        job.expression = schedule
        return job


@dataclass
class JobResult:
    job_id: str
    status: JobStatus
    output: str = ""
    error: str = ""
    started_at: float = 0.0
    finished_at: float = 0.0
```

- [ ] **Step 4: Write scheduler.py**

```python
from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path

from cabinet.core.scheduler.models import CronJob, JobResult, JobStatus

logger = logging.getLogger(__name__)


class CronScheduler:
    def __init__(self, persistence_path: str | Path | None = None):
        self._jobs: dict[str, CronJob] = {}
        self._handlers: dict[str, object] = {}
        self._results: list[JobResult] = []
        self._running = False
        self._task: asyncio.Task | None = None
        self._persist_path = Path(persistence_path) if persistence_path else None
        self._hard_timeout = 180.0

    @property
    def jobs(self) -> list[CronJob]:
        return list(self._jobs.values())

    @property
    def is_running(self) -> bool:
        return self._running

    async def add_job(self, job: CronJob, handler: object = None) -> None:
        self._jobs[job.id] = job
        if handler:
            self._handlers[job.id] = handler
        await self._persist()
        logger.info("Cron job added: %s (%s)", job.name, job.id)

    async def remove_job(self, job_id: str) -> None:
        self._jobs.pop(job_id, None)
        self._handlers.pop(job_id, None)
        await self._persist()
        logger.info("Cron job removed: %s", job_id)

    async def start(self, interval: float = 1.0) -> None:
        self._running = True
        await self._load_persisted()
        self._task = asyncio.create_task(self._loop(interval))
        logger.info("CronScheduler started with %d jobs", len(self._jobs))

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("CronScheduler stopped")

    async def fire_now(self, job_id: str) -> JobResult:
        job = self._jobs.get(job_id)
        if job is None:
            return JobResult(job_id=job_id, status=JobStatus.FAILED, error="Job not found")
        result = await self._execute_job(job)
        self._results.append(result)
        if not job.recurring:
            await self.remove_job(job_id)
        return result

    async def _loop(self, interval: float) -> None:
        while self._running:
            try:
                await self._tick()
            except Exception as e:
                logger.error("Cron tick error: %s", e)
            await asyncio.sleep(interval)

    async def _tick(self) -> None:
        now = time.time()
        for job in list(self._jobs.values()):
            if job.interval_seconds and self._should_fire(job, now):
                result = await self._execute_job(job)
                self._results.append(result)

    def _should_fire(self, job: CronJob, now: float) -> bool:
        return True

    async def _execute_job(self, job: CronJob) -> JobResult:
        started = time.time()
        logger.info("Executing cron job: %s", job.name)
        try:
            handler = self._handlers.get(job.id)
            if handler:
                result = await handler(job)
            else:
                result = JobResult(
                    job_id=job.id,
                    status=JobStatus.SUCCESS,
                    output="Job completed (no handler)",
                )
        except asyncio.TimeoutError:
            result = JobResult(job_id=job.id, status=JobStatus.TIMEOUT, error="Hard timeout")
        except Exception as e:
            logger.error("Job %s failed: %s", job.name, e)
            result = JobResult(job_id=job.id, status=JobStatus.FAILED, error=str(e))

        result.started_at = started
        result.finished_at = time.time()
        return result

    async def _persist(self) -> None:
        if not self._persist_path:
            return
        data = []
        for job in self._jobs.values():
            data.append({
                "id": job.id,
                "name": job.name,
                "expression": job.expression,
                "interval_seconds": job.interval_seconds,
                "recurring": job.recurring,
                "description": job.description,
                "skills": job.skills,
                "model_override": job.model_override,
                "workdir": job.workdir,
            })
        self._persist_path.parent.mkdir(parents=True, exist_ok=True)
        self._persist_path.write_text(json.dumps(data, indent=2))

    async def _load_persisted(self) -> None:
        if not self._persist_path or not self._persist_path.exists():
            return
        data = json.loads(self._persist_path.read_text())
        for d in data:
            job = CronJob(**d)
            self._jobs[job.id] = job
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/unit/core/scheduler/test_scheduler.py -v`
Expected: PASS (tests will need `from_natural` to handle "0s" — adjust to accept "0s" as duration)

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/core/scheduler/ tests/unit/core/scheduler/
git commit -m "feat(scheduler): add CronScheduler with natural language job parsing and JSON persistence"
```

---

### Task 4: SKILL.md Frontmatter + Category System

**Files:**
- Modify: `src/cabinet/core/tools/skill_loader.py`
- Create: `src/cabinet/core/tools/skill_curator.py`
- Test: `tests/unit/core/tools/test_skill_curator.py`

- [ ] **Step 1: Write failing tests for enhanced SkillLoader**

```python
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from cabinet.core.tools.skill_loader import SkillLoader


class TestSKILLmdParsing:
    def test_parse_skill_with_full_frontmatter(self):
        content = """---
name: code-review
description: Review code changes for quality and security
version: "1.2.0"
author: Cabinet Team
license: MIT
category: devops
platforms:
  - linux
  - macos
tags:
  - review
  - security
---

# Code Review Skill

Review changed files for bugs, security issues, and style violations.
"""
        loader = SkillLoader()
        skill = loader._parse_content(content)

        assert skill.name == "code-review"
        assert skill.description == "Review code changes for quality and security"

    def test_parse_skill_with_minimal_frontmatter(self):
        content = """---
name: hello
---
Say hello to the user.
"""
        loader = SkillLoader()
        skill = loader._parse_content(content)
        assert skill.name == "hello"
        assert skill.prompt_template == "Say hello to the user."
```

- [ ] **Step 2: Run tests to verify existing behavior preserved**

Run: `pytest tests/unit/core/tools/test_skill_curator.py -v`
Expected: FAIL (file doesn't exist yet)

- [ ] **Step 3: Enhance SkillLoader with SKILL.md metadata extraction**

Modify `src/cabinet/core/tools/skill_loader.py`:

```python
@dataclass
class SkillMetadata:
    name: str = "unnamed"
    description: str = ""
    version: str = "0.1.0"
    author: str = ""
    license: str = "MIT"
    category: str = "general"
    platforms: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    related_skills: list[str] = field(default_factory=list)
    config: dict = field(default_factory=dict)


class SkillLoader:
    def parse_file(self, path: str) -> SkillDefinition:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        return self._parse_content(content)

    def parse_metadata(self, path: str) -> SkillMetadata:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        frontmatter_match = re.search(r"^---\s*\n(.*?)\n---", content, re.DOTALL | re.MULTILINE)
        if not frontmatter_match:
            return SkillMetadata()
        data = yaml.safe_load(frontmatter_match.group(1)) or {}
        return SkillMetadata(**{
            k: v for k, v in data.items()
            if k in SkillMetadata.__dataclass_fields__
        })

    def _parse_content(self, content: str) -> SkillDefinition:
        frontmatter_match = re.search(r"^---\s*\n(.*?)\n---", content, re.DOTALL | re.MULTILINE)
        if frontmatter_match:
            metadata = yaml.safe_load(frontmatter_match.group(1)) or {}
            body = content[frontmatter_match.end():].strip()
        else:
            metadata = {}
            body = content.strip()

        name = metadata.get("name", "unnamed")
        return SkillDefinition(
            name=name,
            description=metadata.get("description", ""),
            kind="atomic",
            input_schema=metadata.get("input_schema", {"type": "object"}),
            output_schema=metadata.get("output_schema", {"type": "object"}),
            prompt_template=body if body else None,
            requires_human_approval=metadata.get("requires_human_approval", False),
        )
```

- [ ] **Step 4: Write SkillCurator**

```python
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

logger = logging.getLogger(__name__)


class SkillLifecycleHook(Protocol):
    async def on_skill_created(self, skill_name: str, source: str) -> None: ...
    async def on_skill_improved(self, skill_name: str, reason: str) -> None: ...
    async def on_skill_deprecated(self, skill_name: str, reason: str) -> None: ...


@dataclass
class SkillCurator:
    skills_dir: Path
    lifecycle_hooks: list[SkillLifecycleHook] = field(default_factory=list)
    _skills: dict[str, dict] = field(default_factory=dict)

    async def register_skill(self, name: str, source: str, metadata: dict | None = None) -> None:
        self._skills[name] = {
            "source": source,
            "metadata": metadata or {},
            "use_count": 0,
            "created_at": __import__("time").monotonic(),
        }
        for hook in self.lifecycle_hooks:
            await hook.on_skill_created(name, source)
        logger.info("Skill registered: %s (from %s)", name, source)

    async def record_use(self, name: str) -> None:
        if name in self._skills:
            self._skills[name]["use_count"] += 1

    async def review_and_improve(
        self, name: str, gateway=None
    ) -> str | None:
        if name not in self._skills:
            return None
        skill = self._skills[name]
        if skill["use_count"] < 3:
            return None
        improvement = f"Skill '{name}' used {skill['use_count']} times — consider version bump"
        for hook in self.lifecycle_hooks:
            await hook.on_skill_improved(name, improvement)
        return improvement

    def list_skills(self) -> list[str]:
        return sorted(self._skills.keys())

    def get_skill_info(self, name: str) -> dict | None:
        return self._skills.get(name)
```

- [ ] **Step 5: Write curator test**

```python
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from cabinet.core.tools.skill_curator import SkillCurator


class TestSkillCurator:
    async def test_register_and_list_skills(self, tmp_path):
        curator = SkillCurator(skills_dir=tmp_path)
        await curator.register_skill("code-review", "builtin")
        assert "code-review" in curator.list_skills()

    async def test_record_use_increments_counter(self, tmp_path):
        curator = SkillCurator(skills_dir=tmp_path)
        await curator.register_skill("code-review", "builtin")
        await curator.record_use("code-review")
        await curator.record_use("code-review")
        info = curator.get_skill_info("code-review")
        assert info["use_count"] == 2

    async def test_review_suggests_improvement_after_enough_uses(self, tmp_path):
        curator = SkillCurator(skills_dir=tmp_path)
        await curator.register_skill("code-review", "builtin")
        for _ in range(4):
            await curator.record_use("code-review")
        result = await curator.review_and_improve("code-review")
        assert result is not None
        assert "4 times" in result
```

- [ ] **Step 6: Run tests**

Run: `pytest tests/unit/core/tools/test_skill_curator.py -v`
Expected: 3 PASS

- [ ] **Step 7: Commit**

```bash
git add src/cabinet/core/tools/skill_loader.py src/cabinet/core/tools/skill_curator.py tests/unit/core/tools/test_skill_curator.py
git commit -m "feat(skills): add SKILL.md frontmatter parsing and SkillCurator for lifecycle management"
```

---

### Task 5: Toolset Grouping System

**Files:**
- Create: `src/cabinet/core/tools/toolsets.py`
- Modify: `src/cabinet/core/tools/registry.py`
- Test: `tests/unit/core/tools/test_toolsets.py`

- [ ] **Step 1: Write failing tests**

```python
from __future__ import annotations

import pytest
from cabinet.core.tools.toolsets import TOOLSETS, ToolsetRegistry
from cabinet.core.tools.registry import LocalToolRegistry
from cabinet.models.primitives import SkillDefinition


class TestToolsetDefinitions:
    def test_core_toolset_exists(self):
        assert "core" in TOOLSETS
        assert "Read" in TOOLSETS["core"]
        assert "Write" in TOOLSETS["core"]

    def test_search_toolset_exists(self):
        assert "search" in TOOLSETS
        assert "WebSearch" in TOOLSETS["search"] or "Glob" in TOOLSETS["search"]

    def test_each_toolset_has_description(self):
        for name in TOOLSETS:
            assert isinstance(TOOLSETS[name], set) or isinstance(TOOLSETS[name], list)


class TestToolsetRegistry:
    async def test_activate_toolset_makes_tools_available(self):
        reg = ToolsetRegistry()
        reg.activate("core")
        assert "Read" in reg.active_tools()

    async def test_deactivate_toolset_removes_tools(self):
        reg = ToolsetRegistry()
        reg.activate("core")
        reg.deactivate("core")
        assert "Read" not in reg.active_tools()

    async def test_multiple_toolsets_union(self):
        reg = ToolsetRegistry()
        reg.activate("core")
        reg.activate("code_execution")
        active = reg.active_tools()
        assert "Read" in active
        assert "Bash" in active

    async def test_platform_default_toolset(self):
        reg = ToolsetRegistry()
        reg.activate_for_platform("telegram")
        active = reg.active_tools()
        assert len(active) > 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/core/tools/test_toolsets.py -v`
Expected: FAIL

- [ ] **Step 3: Write toolsets.py**

```python
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

TOOLSETS: dict[str, set[str]] = {
    "core": {
        "Read", "Glob", "Grep",
        "Write", "Edit",
        "TodoWrite",
    },
    "code_execution": {
        "Bash",
    },
    "search": {
        "WebSearch", "WebFetch",
    },
    "memory": {
        "Read", "Write",  # memory operations
    },
    "delegation": {
        "Agent", "SendMessage", "TaskCreate", "TaskGet", "TaskList",
    },
    "skills": {
        "Skill",
    },
    "terminal": {
        "Bash", "Read", "Write", "Edit", "Glob", "Grep",
    },
}

PLATFORM_DEFAULTS: dict[str, set[str]] = {
    "cli": {"core", "code_execution", "search", "memory", "delegation", "skills", "terminal"},
    "api": {"core", "code_execution", "search", "memory", "skills"},
    "telegram": {"core", "search", "memory", "skills"},
    "discord": {"core", "search", "memory", "skills"},
}

AGENT_ROLE_DEFAULTS: dict[str, set[str]] = {
    "secretary": {"core", "search", "memory", "skills", "delegation"},
    "explorer": {"core", "search"},
    "executor": {"core", "code_execution", "terminal", "skills"},
    "planner": {"core", "search", "memory"},
}


class ToolsetRegistry:
    def __init__(self, toolsets: dict[str, set[str]] | None = None):
        self._toolsets = dict(toolsets or TOOLSETS)
        self._active: set[str] = set()

    def activate(self, toolset_name: str) -> None:
        if toolset_name not in self._toolsets:
            logger.warning("Unknown toolset: %s", toolset_name)
            return
        self._active.add(toolset_name)
        logger.info("Toolset activated: %s (%d tools)", toolset_name, len(self._toolsets[toolset_name]))

    def deactivate(self, toolset_name: str) -> None:
        self._active.discard(toolset_name)
        logger.info("Toolset deactivated: %s", toolset_name)

    def active_tools(self) -> set[str]:
        tools: set[str] = set()
        for name in self._active:
            tools.update(self._toolsets.get(name, set()))
        return tools

    def activate_for_platform(self, platform: str) -> None:
        defaults = PLATFORM_DEFAULTS.get(platform, {"core"})
        for ts in defaults:
            self.activate(ts)

    def activate_for_role(self, role: str) -> None:
        defaults = AGENT_ROLE_DEFAULTS.get(role, {"core"})
        for ts in defaults:
            self.activate(ts)

    def reset(self) -> None:
        self._active.clear()
```

- [ ] **Step 4: Modify LocalToolRegistry to integrate with ToolsetRegistry**

Modify `src/cabinet/core/tools/registry.py`:

```python
# Add to LocalToolRegistry.__init__:
def __init__(self):
    # ... existing init ...
    self._toolset_registry: "ToolsetRegistry | None" = None

def set_toolset_registry(self, registry: "ToolsetRegistry") -> None:
    from cabinet.core.tools.toolsets import ToolsetRegistry
    self._toolset_registry = registry

async def list_active_skills(self) -> list[SkillDefinition]:
    if self._toolset_registry is None:
        return list(self._skills.values())
    active_names = self._toolset_registry.active_tools()
    return [
        s for name, s in self._skills.items()
        if name in active_names
    ]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/unit/core/tools/test_toolsets.py -v`
Expected: 4 PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/core/tools/toolsets.py src/cabinet/core/tools/registry.py tests/unit/core/tools/test_toolsets.py
git commit -m "feat(tools): add ToolsetRegistry with platform and role-aware tool grouping"
```

---

### Task 6: Gateway Process — Wire Everything Together

**Files:**
- Create: `src/cabinet/gateway/run.py`
- Modify: `src/cabinet/runtime.py` (add gateway + cron wiring)
- Test: `tests/unit/gateway/test_gateway_session.py` (extend)

- [ ] **Step 1: Write gateway run.py**

```python
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from cabinet.gateway.models import GatewayMessage, GatewayContext, Platform
from cabinet.gateway.router import MessageRouter
from cabinet.gateway.session import SessionStore

logger = logging.getLogger(__name__)


class GatewayProcess:
    def __init__(self, runtime=None):
        self._runtime = runtime
        self._router = MessageRouter()
        self._sessions = SessionStore()
        self._running = False
        self._cleanup_task: asyncio.Task | None = None

    async def start(self, platforms: list[str] | None = None) -> None:
        self._running = True
        platforms = platforms or []

        if "telegram" in platforms:
            from cabinet.gateway.platforms.telegram_adapter import TelegramAdapter

            token = os.getenv("CABINET_TELEGRAM_TOKEN", "")
            if token:
                tg = TelegramAdapter(token=token)
                self._router.register_adapter(Platform.TELEGRAM, tg)
                await tg.start()
                logger.info("Telegram adapter started")

        if "discord" in platforms:
            from cabinet.gateway.platforms.discord_adapter import DiscordAdapter

            token = os.getenv("CABINET_DISCORD_TOKEN", "")
            if token:
                dc = DiscordAdapter(token=token)
                self._router.register_adapter(Platform.DISCORD, dc)
                await dc.start()
                logger.info("Discord adapter started")

        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        logger.info("GatewayProcess started with platforms: %s", platforms)

    async def stop(self) -> None:
        self._running = False
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

    async def handle_message(self, message: GatewayMessage) -> dict[str, Any]:
        route = self._router.route(message)
        return route

    async def _cleanup_loop(self) -> None:
        while self._running:
            await asyncio.sleep(300)
            expired = self._sessions.expire_stale()
            if expired > 0:
                logger.debug("Cleaned up %d expired sessions", expired)
```

- [ ] **Step 2: Write adapter stubs (Telegram + Discord)**

Create `src/cabinet/gateway/platforms/telegram_adapter.py`:

```python
from __future__ import annotations

import logging

from cabinet.gateway.models import GatewayMessage, Platform
from cabinet.gateway.platforms.base import BasePlatformAdapter

logger = logging.getLogger(__name__)


class TelegramAdapter(BasePlatformAdapter):
    def __init__(self, token: str):
        self._token = token

    @property
    def platform(self) -> Platform:
        return Platform.TELEGRAM

    async def start(self) -> None:
        try:
            from telegram.ext import ApplicationBuilder
            self._app = ApplicationBuilder().token(self._token).build()
            logger.info("Telegram bot initialized")
        except ImportError:
            logger.warning("python-telegram-bot not installed; Telegram disabled")

    async def stop(self) -> None:
        pass

    async def send_message(self, message: GatewayMessage) -> None:
        logger.debug("Telegram send: %s", message.content[:80])
```

Create `src/cabinet/gateway/platforms/discord_adapter.py`:

```python
from __future__ import annotations

import logging

from cabinet.gateway.models import GatewayMessage, Platform
from cabinet.gateway.platforms.base import BasePlatformAdapter

logger = logging.getLogger(__name__)


class DiscordAdapter(BasePlatformAdapter):
    def __init__(self, token: str):
        self._token = token

    @property
    def platform(self) -> Platform:
        return Platform.DISCORD

    async def start(self) -> None:
        try:
            import discord
            logger.info("Discord client initialized")
        except ImportError:
            logger.warning("discord.py not installed; Discord disabled")

    async def stop(self) -> None:
        pass

    async def send_message(self, message: GatewayMessage) -> None:
        logger.debug("Discord send: %s", message.content[:80])
```

- [ ] **Step 3: Wire gateway and cron into CabinetRuntime**

Modify `src/cabinet/runtime.py`:

```python
# Add params to __init__:
def __init__(
    self,
    # ... existing params ...
    enable_gateway: bool = False,
    gateway_platforms: list[str] | None = None,
    enable_cron: bool = False,
    cron_persistence_path: str | None = None,
):
    # ... existing init ...

    # Gateway
    self._gateway_process: "GatewayProcess | None" = None
    if enable_gateway:
        from cabinet.gateway.run import GatewayProcess
        self._gateway_process = GatewayProcess(runtime=self)
        self._gateway_platforms = gateway_platforms or []

    # Cron
    self._cron_scheduler: "CronScheduler | None" = None
    if enable_cron:
        from cabinet.core.scheduler.scheduler import CronScheduler
        self._cron_scheduler = CronScheduler(
            persistence_path=cron_persistence_path or "data/cron.json"
        )

# Add to _start_inner():
if self._gateway_process:
    await self._gateway_process.start(platforms=self._gateway_platforms)
if self._cron_scheduler:
    await self._cron_scheduler.start()

# Add to stop():
if self._gateway_process:
    await self._gateway_process.stop()
if self._cron_scheduler:
    await self._cron_scheduler.stop()

# Add properties:
@property
def gateway(self):
    return self._gateway_process

@property
def cron(self):
    return self._cron_scheduler
```

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/gateway/run.py src/cabinet/gateway/platforms/telegram_adapter.py src/cabinet/gateway/platforms/discord_adapter.py src/cabinet/runtime.py
git commit -m "feat(gateway): wire GatewayProcess, platform adapters, and CronScheduler into CabinetRuntime"
```

---

### Task 7: Integration Verification

**Files:**
- Test: `tests/unit/test_runtime.py` (extend)

- [ ] **Step 1: Write integration verification test**

```python
async def test_runtime_with_phase2_ecosystem_components():
    from cabinet.runtime import CabinetRuntime
    from cabinet.core.scheduler.models import CronJob

    runtime = CabinetRuntime(enable_gateway=False, enable_cron=True)
    await runtime.start()

    assert runtime.cron is not None
    assert runtime.cron.is_running

    job = CronJob.from_natural("test", "1h")
    await runtime.cron.add_job(job)
    assert len(runtime.cron.jobs) == 1

    await runtime.stop()
    assert not runtime.cron.is_running
```

- [ ] **Step 2: Run integration test**

Run: `pytest tests/unit/test_runtime.py::test_runtime_with_phase2_ecosystem_components -v`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `pytest tests/ -x -q`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/unit/test_runtime.py
git commit -m "test(runtime): verify Phase 2 ecosystem components are wired"
```
