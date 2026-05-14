# Cabinet TypeScript 重写 — Phase 2 Agent 核心 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 构建 LLM 网关、Agent 执行循环和四层记忆系统。

**Architecture:** gateway → agent → memory 按依赖顺序构建。gateway 封装 Vercel AI SDK，agent 实现 TAOR 循环，memory 建立四层记忆。

**Tech Stack:** Vercel AI SDK, LanceDB, better-sqlite3

---

### Task 16: @cabinet/gateway — LLMGateway 接口 + AISDKAdapter

Create `packages/gateway/src/llm-gateway.ts` (interface: generateText, streamText, listModels) and `packages/gateway/src/ai-sdk-adapter.ts` (Vercel AI SDK adapter for Anthropic/OpenAI/Google).

### Task 17: @cabinet/gateway — ModelRouter + FallbackChain

Create `packages/gateway/src/model-router.ts` (role→model routing) and `packages/gateway/src/fallback.ts` (timeout-based fallback chain).

### Task 18: @cabinet/gateway — CostTracker + BudgetGuard

Create `packages/gateway/src/cost-tracker.ts` and `packages/gateway/src/budget-guard.ts`.

### Task 19: @cabinet/agent — ToolExecutor + Safety + Retry

Create `packages/agent/src/tool-executor.ts`, `packages/agent/src/safety.ts`, `packages/agent/src/retry.ts`.

### Task 20: @cabinet/agent — Checkpoint + ContextBuilder + AgentLoop

Create `packages/agent/src/checkpoint.ts`, `packages/agent/src/context-builder.ts`, `packages/agent/src/agent-loop.ts`. TAOR 循环串联所有组件。

### Task 21: @cabinet/memory — MemoryOrchestrator 接口 + ShortTerm

Create `packages/memory/src/orchestrator.ts` and `packages/memory/src/short-term.ts`.

### Task 22: @cabinet/memory — Entity + Project + LongTerm + Consolidation

Create remaining memory layers. LanceDB for long-term semantic search.

### Task 23: Phase 2 集成验证

Run full typecheck + tests. Verify AgentLoop with MemoryOrchestrator + Gateway end-to-end.
