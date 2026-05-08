# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-05-08

### Core Architecture
- Six-Room architecture (Meeting, Strategy, Decision, Office, Summary, Secretary)
- Event sourcing with SQLite persistence and recovery
- LLM Gateway with LiteLLM integration (multi-provider support)
- CabinetRuntime as the central orchestrator wiring all subsystems

### Context & Token Management
- PromptCacheManager with static/dynamic partitioning and Anthropic cache breakpoints
- TokenBudget with per-model token-aware context trimming (replaces hardcoded message count)
- LLM-based dialogue summarization with SessionMemory reuse (Path A cache, Path B summary)
- Tool result compaction for large outputs (>50K chars → disk cache, <2K preview in context)

### Security & Permissions
- PermissionEngine with six-layer defense (deny→sandbox→mode→allow→classify→user input)
- YOLO auto-classifier for safe/dangerous tool detection
- FileSystemSandbox for protected path enforcement (.git, .env, .claude, credentials)
- DenialTracker with circuit breaker (3 consecutive / 20 total denials)
- Deterministic AccessControlList engine with deny-first graduated trust (4 roles, 6 default rules)
- KeyVault encrypted API key storage (Fernet + PBKDF2)
- Audit logging with OpenTelemetry trace correlation
- XSS sanitization utility

### Resilience
- CircuitBreaker with CLOSED/OPEN/HALF_OPEN states and 60s auto-probe
- Exponential backoff retry with error classification (rate limit, server error, timeout, context overflow)
- Context overflow progressive recovery (30% discard per attempt, max 3 attempts)

### Cost Control
- CostTracker with per-model cost accounting and cache-hit discounting
- CostBudget with limit enforcement and 80% warning threshold
- 11 pre-configured model pricing entries (OpenAI, Anthropic, DeepSeek, Google, Ollama)

### Multi-Platform Gateway
- GatewayProcess with Telegram and Discord platform adapters
- MessageRouter with slash command routing to rooms (/meeting, /decide, /task, /strategy)
- GatewaySession with cross-platform linking and TTL-based expiry

### Scheduling & Automation
- CronScheduler with natural language job parsing ("30m", "every day 9am", "0 2 * * *")
- JSON-based job persistence with recurring/one-shot support

### Skills & Tools Ecosystem
- SKILL.md frontmatter parsing with YAML metadata extraction
- SkillCurator for autonomous skill lifecycle management (register, track usage, suggest improvements)
- ToolsetRegistry with platform and role-aware tool grouping (8 toolset groups)
- Concurrent/partitioned tool execution with safety classification (CONCURRENT_SAFE vs EXCLUSIVE)

### User Modeling & Cross-Session Learning
- UserProfileManager with four memory types (user, feedback, project, reference)
- Frontmatter-based file persistence with MEMORY.md index (Claude Code-compatible format)
- UserProfileInjector for session-start prompt enrichment with cache TTL
- UserModelLearner for pattern-based observation learning (corrections, confirmations, role detection)

### Memory System
- MemoryScorer with weighted relevance ranking (semantic 50% + recency 30% + access frequency 20%)
- MemoryOrchestrator for cross-backend memory assembly with deduplication
- FileMemoryStore with YAML frontmatter (Claude Code-compatible), implementing MemoryStore protocol
- MemoryConsolidator for short-term to long-term memory consolidation via LLM summarization

### Multi-Agent Collaboration
- ParallelExecutor for fan-out/fan-in agent execution with LLM-based result synthesis
- HandoffManager with auto_route capability discovery and least-loaded/highest-skill strategies
- HandoffHooks lifecycle (before_handoff, after_accept, on_reject, on_timeout)
- NPartyDebate with multi-position parallel debate and N-party moderation

### Configuration
- 4-layer hierarchical config loading (default → ~/.cabinet/config.json → project cabinet.json → cabinet.local.json)
- Deep merge for nested configuration dictionaries
- Environment variable passthrough (CABINET_DATA_DIR, CABINET_LOG_LEVEL, CABINET_OBSERVABILITY_ENABLED)

### API & CLI
- REST API with FastAPI (chat, employees, skills, knowledge, rooms, config, health)
- CLI with Typer (init, serve, chat, status, set-api-key, config, employee, skill, knowledge)
- WebSocket streaming chat with multi-token auth
- Chat slash commands (/meeting, /decide, /task, /strategy, /review, /skills, /employees, /status, /help)

### Observability
- OpenTelemetry distributed tracing
- Prometheus metrics with COST_GAUGE per-model tracking
- Structured logging with JSON/text format toggle
- Health check endpoints (/health liveness, /ready readiness)

### Quality & Operations
- Rate limiting with SlowAPI
- Input validation with Pydantic Field constraints
- Docker deployment with health checks and resource limits
- CI/CD pipeline (lint, type-check, test, security scan, docker-build)
- Cross-platform API examples (bash, PowerShell, Python)
- Bilingual documentation (English + Chinese)
- 1214 passing tests, 1 skipped
