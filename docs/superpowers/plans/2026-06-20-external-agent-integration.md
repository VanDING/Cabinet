# External Agent Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three independent improvements to external agent integration: real Test button, A2A message routing, and BYOK UI improvements.

**Architecture:** Three independent tasks. Task A adds a server endpoint + frontend wiring for testing employee LLM connections. Task B replaces 501 stubs with real A2A v1.0-compliant message routing. Task C improves the API Keys settings UI with OpenRouter/provider selection patterns. Tasks are independent and can be executed in parallel.

**Tech Stack:** Hono (server), React 19 (frontend), `@cabinet/gateway` (LLM gateway), `@cabinet/agent` (A2A adapter), Tauri 2.0

**Verification:** After each task, run `pnpm typecheck` and `pnpm test` in `apps/desktop`, and `pnpm test` in `apps/server` (or `pnpm -r test` from root).

---

### Task A: Real Employee Test Button

**Files:**

- Modify: `apps/server/src/routes/employees.ts` (add `POST /:id/test` endpoint)
- Modify: `apps/desktop/src/pages/EmployeesPage.tsx` (wire up test handler)
- Test: Verify typecheck + tests pass

The Test button on AgentBadge currently shows a placeholder toast. This task makes it call the LLM gateway with the employee's configured model, returning latency and status.

- [ ] **Step 1: Add `POST /api/employees/:id/test` endpoint to server**

Add this before the final `rowToEmployee` helper in `apps/server/src/routes/employees.ts`:

```ts
// ── POST /:id/test — test employee LLM connection ──
employeesRouter.post('/:id/test', async (c) => {
  const { employeeRepo } = getServerContext();
  const id = c.req.param('id');
  const row = employeeRepo.findById(id);
  if (!row) {
    return c.json({ status: 'error', message: 'Employee not found' }, 404);
  }

  const pipeline = (() => {
    try {
      return JSON.parse(row.pipeline_config ?? '{}');
    } catch {
      return {};
    }
  })();
  const persona = (() => {
    try {
      return JSON.parse(row.persona ?? '{}');
    } catch {
      return {};
    }
  })();
  const model = pipeline.model ?? persona.model;
  if (!model) {
    return c.json({ status: 'error', message: 'No model configured for this employee' }, 400);
  }

  const { AISDKAdapter } = await import('@cabinet/gateway');
  const adapter = new AISDKAdapter({}, {});
  const start = Date.now();
  try {
    const result = await adapter.generateText({
      model,
      messages: [{ role: 'user', content: 'Reply with just "OK".' }],
      maxTokens: 10,
    });
    const latency = Date.now() - start;
    return c.json({ status: 'ok', latency_ms: latency, model: result.model });
  } catch (e) {
    return c.json({ status: 'error', message: (e as Error).message ?? 'Connection failed' }, 503);
  }
});
```

- [ ] **Step 2: Wire up test handler in EmployeesPage**

In `apps/desktop/src/pages/EmployeesPage.tsx`, replace the two `onTest` handlers with real API calls.

First, replace line 371 (`onTest={() => addToast('info', \`Test ${emp.name} — placeholder\`)}`) with:

```tsx
            onTest={() => handleTest(emp.id, emp.name)}
```

Then replace the detail modal test handler at line 463 (the `addToast('info', \`Test ${detailEmployee.name} — placeholder\`)`) with:

```tsx
                onClick={() => handleTest(detailEmployee.id, detailEmployee.name)}
```

Add this handler function before the `sourceLabels` const (around line 178):

```tsx
const [testingId, setTestingId] = useState<string | null>(null);

const handleTest = async (id: string, name: string) => {
  setTestingId(id);
  try {
    const res = await apiFetch(`/api/employees/${id}/test`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const data = await res.json();
    if (data.status === 'ok') {
      addToast('success', `${name}: OK — ${data.latency_ms}ms · ${data.model}`);
    } else {
      addToast('error', `${name}: ${data.message ?? 'Connection failed'}`);
    }
  } catch (e) {
    addToast('error', `${name}: ${(e as Error).message}`);
  } finally {
    setTestingId(null);
  }
};
```

Add `testingId` to the state declarations near the top (around line 46):

```tsx
const [testingId, setTestingId] = useState<string | null>(null);
```

- [ ] **Step 3: Run typecheck and tests**

```bash
pnpm typecheck
pnpm test
```

Both should pass.

---

### Task B: A2A Message Routing

**Files:**

- Modify: `apps/server/src/routes/agents.ts` (replace 501 stubs with real handlers)
- Modify: `apps/server/src/a2a/a2a-client.ts` (update to use standard A2A v1.0 endpoints)
- Test: Verify typecheck + server tests pass

The A2A protocol v1.0 standard uses:

- `POST /a2a/tasks` — Submit a task
- `POST /a2a/tasks/:id/cancel` — Cancel a task
- `GET /a2a/tasks/:id` — Get task status (for polling)

Cabinet's existing `A2AHarnessRuntime` already sends tasks to external agents via these endpoints. This task implements the **inbound** side — when an external A2A agent sends a task to Cabinet. It also cleans up the `A2AClient` to use the standard endpoint path.

- [ ] **Step 1: Implement inbound A2A task routing**

Replace the 501 stubs at lines 245–268 in `apps/server/src/routes/agents.ts` with real handlers:

```ts
// ── A2A Inbound Task Routing ──
const a2aTasks = new Map<
  string,
  {
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
    output?: unknown;
    message?: string;
    tokens_used?: number;
    model?: string;
    timestamp: string;
  }
>();

agentsRouter.post('/message', async (c) => {
  const { logger, agentRegistry } = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const task = body as {
    task_id?: string;
    session_id?: string;
    capability?: string;
    input?: unknown;
  };

  if (!task.task_id || !task.input) {
    return c.json({ error: 'task_id and input are required' }, 400);
  }

  const taskId = task.task_id;
  const capability = task.capability ?? 'default';

  // Find a matching agent for this capability
  const agents = agentRegistry.list();
  const target =
    agents.find((a) => a.type === 'external_a2a' || a.type === 'custom') ??
    agents.find((a) => a.type === 'builtin');

  if (!target) {
    a2aTasks.set(taskId, {
      status: 'failed',
      message: 'No available agent to handle this task',
      timestamp: new Date().toISOString(),
    });
    return c.json({ task_id: taskId, status: 'rejected', error: 'No available agent' }, 503);
  }

  logger.info('A2A inbound task', { taskId, capability, targetAgent: target.name });

  // Mark as in progress
  a2aTasks.set(taskId, {
    status: 'in_progress',
    timestamp: new Date().toISOString(),
  });

  const { dispatchToSpecialist } = await import('./secretary/agents.js');
  try {
    const output = await dispatchToSpecialist(
      target.type as any,
      typeof task.input === 'string' ? task.input : JSON.stringify(task.input),
      task.session_id ?? `a2a_${taskId}`,
      'default',
      'system',
    );

    a2aTasks.set(taskId, {
      status: 'completed',
      output,
      timestamp: new Date().toISOString(),
    });

    return c.json({
      task_id: taskId,
      status: 'accepted',
    });
  } catch (err) {
    a2aTasks.set(taskId, {
      status: 'failed',
      message: String(err),
      timestamp: new Date().toISOString(),
    });
    return c.json({ task_id: taskId, status: 'rejected', error: String(err) }, 500);
  }
});

agentsRouter.post('/message/stream', async (c) => {
  const { logger, agentRegistry } = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const task = body as { task_id?: string; input?: unknown; session_id?: string };

  if (!task.task_id) {
    return c.json({ error: 'task_id is required' }, 400);
  }

  const taskId = task.task_id;
  const input = typeof task.input === 'string' ? task.input : JSON.stringify(task.input ?? '');

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      try {
        const agents = agentRegistry.list();
        const target =
          agents.find((a) => a.type === 'custom') ?? agents.find((a) => a.type === 'builtin');

        if (!target) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: 'No available agent' })}\n\n`),
          );
          controller.close();
          return;
        }

        const { dispatchToSpecialistStreaming } = await import('./secretary/agents.js');

        await dispatchToSpecialistStreaming(
          target.type as any,
          input,
          task.session_id ?? `a2a_${taskId}`,
          'default',
          'system',
          {
            onChunk: (content: string) => {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`),
              );
            },
            onThinking: (content: string) => {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'thinking', content })}\n\n`),
              );
            },
            onDone: (content: string) => {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'done', content })}\n\n`),
              );
              controller.close();
            },
            onError: (error: string) => {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'error', error })}\n\n`),
              );
              controller.close();
            },
            onToolCall: (name: string, args: Record<string, unknown>) => {},
            onToolResult: (name: string, result: unknown) => {},
          },
        );
      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', error: String(err) })}\n\n`),
        );
        controller.close();
      }
    },
  });

  return c.newResponse(stream);
});

// Task status endpoint (for polling)
agentsRouter.get('/tasks/:taskId', (c) => {
  const taskId = c.req.param('taskId');
  const task = a2aTasks.get(taskId);
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }
  return c.json({
    task_id: taskId,
    ...task,
  });
});
```

Add the import for `dispatchToSpecialist` and `dispatchToSpecialistStreaming` at the top of the file:

```ts
import { getServerContext } from '../context.js';
// Add:
import { dispatchToSpecialist, dispatchToSpecialistStreaming } from '../secretary/agents.js';
```

Wait — `agents.ts` is imported from `routes/agents.ts`. The secretary dispatch is at `routes/secretary/agents.ts`. Let me check if there's a circular dependency risk. The `routes/agents.ts` doesn't import from secretary and secretary imports from context. Since we're using dynamic import (`await import(...)`), this avoids circular dependency.

Actually, I realize `dispatchToSpecialistStreaming` may not exist as an async generator. Let me check the streaming.ts file. Actually I confirmed earlier it exists at `apps/server/src/routes/secretary/agents/dispatch/streaming.ts`. Let me use the correct approach — dynamic import to avoid circular dependency.

- [ ] **Step 2: Update A2AClient to use standard A2A v1.0 endpoints**

In `apps/server/src/a2a/a2a-client.ts`, update `sendMessage` and `sendStreamingMessage` to use the standard A2A endpoint paths:

```ts
  /** Send a synchronous message to an external agent (A2A v1.0). */
  async sendMessage(agentUrl: string, message: A2AMessage): Promise<string> {
    const url = `${agentUrl.replace(/\/$/, '')}/a2a/tasks`;
    const taskId = `task_${Date.now()}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: taskId,
        session_id: `session_${Date.now()}`,
        capability: 'default',
        input: message.content,
        slot: {},
        configuration: { max_retries: 2, timeout_ms: 120000, slot_write_url: '' },
      }),
    });
    if (!res.ok) throw new Error(`A2A sendMessage failed: ${res.status}`);
    const data = await res.json();
    if (data.status === 'rejected') throw new Error(`A2A task rejected: ${data.error}`);

    // Poll for completion
    const statusUrl = `${agentUrl.replace(/\/$/, '')}/a2a/tasks/${taskId}`;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const sr = await fetch(statusUrl);
      if (!sr.ok) continue;
      const status = await sr.json();
      if (status.status === 'completed') return status.output ?? JSON.stringify(status);
      if (status.status === 'failed' || status.status === 'cancelled') {
        throw new Error(`A2A task ${status.status}: ${status.message ?? ''}`);
      }
    }
    throw new Error('A2A task timed out');
  }

  /** Send a streaming message (returns SSE reader). */
  async sendStreamingMessage(
    agentUrl: string,
    message: A2AMessage,
  ): Promise<ReadableStream<Uint8Array> | null> {
    try {
      const url = `${agentUrl.replace(/\/$/, '')}/a2a/tasks`;
      const taskId = `task_${Date.now()}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: taskId,
          session_id: `session_${Date.now()}`,
          capability: 'default',
          input: message.content,
          slot: {},
          configuration: { max_retries: 2, timeout_ms: 120000, slot_write_url: '' },
        }),
      });
      if (!res.ok || !res.body) return null;
      return res.body;
    } catch (e) {
      this.logger.warn('A2A streaming failed', { agentUrl, error: String(e) });
      return null;
    }
  }
```

- [ ] **Step 3: Run typecheck and tests**

```bash
pnpm typecheck
pnpm test
```

Both should pass.

---

### Task C: BYOK UI Improvements

**Files:**

- Modify: `apps/desktop/src/pages/settings/ApiKeysTab.tsx` (add OpenRouter, provider picker, model dropdown, test feedback)
- Test: Verify typecheck + tests pass

Reference patterns from Cursor/Copilot:

- Cursor: Settings → Models → "Override OpenAI Base URL" toggle + paste key + add model IDs
- Copilot: Provider picker → paste key → model registry dropdown
- OpenRouter as first-class provider with model fetching

- [ ] **Step 1: Add OpenRouter as a provider in provider model list**

In `apps/desktop/src/hooks/useAvailableModels.ts`, add OpenRouter to `PROVIDER_MODELS`:

```ts
export const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  deepseek: ['deepseek-v4-flash', 'deepseek-r1-0528'],
  qwen: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
  moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k'],
  zhipu: ['glm-4-flash', 'glm-4-plus'],
  baichuan: ['baichuan3-turbo'],
  openrouter: [
    'openrouter/anthropic/claude-sonnet-4',
    'openrouter/anthropic/claude-opus-4',
    'openrouter/openai/gpt-4o',
    'openrouter/deepseek/deepseek-v4-flash',
    'openrouter/google/gemini-2.5-flash',
  ],
};
```

- [ ] **Step 2: Update the provider selector with OpenRouter and model dropdown**

In `apps/desktop/src/pages/settings/ApiKeysTab.tsx`, update the form:

Replace the provider `<select>` options block (lines 94-102) to add OpenRouter:

```tsx
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="google">Google</option>
                <option value="deepseek">DeepSeek</option>
                <option value="qwen">Qwen</option>
                <option value="moonshot">Moonshot</option>
                <option value="zhipu">Zhipu</option>
                <option value="baichuan">Baichuan</option>
                <option value="openrouter">OpenRouter</option>
                <option value="custom">Custom (OpenAI-compatible)</option>
```

Replace the Model input (lines 124-132) with a model dropdown when available, falling back to text input:

```tsx
<div>
  <label className="text-content-tertiary mb-1 block text-xs">Model</label>
  {PROVIDER_MODELS[formData.provider] ? (
    <select
      value={formData.model}
      onChange={(e) => setFormData((p) => ({ ...p, model: e.target.value }))}
      className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
    >
      <option value="">Select a model...</option>
      {PROVIDER_MODELS[formData.provider]!.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  ) : (
    <input
      type="text"
      placeholder="e.g. openai/gpt-4o"
      value={formData.model}
      onChange={(e) => setFormData((p) => ({ ...p, model: e.target.value }))}
      className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
    />
  )}
</div>
```

- [ ] **Step 3: Move model mapping to use provider dropdowns instead of free-text**

In the `ModelMappingSection`, replace the three text inputs with select dropdowns populated from available models:

```tsx
function ModelSelect({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [keys] = useState<{ provider: string; models: string[] }[]>(() => {
    const stored = localStorage.getItem('cabinet-api-keys');
    if (!stored) return [];
    try {
      return Object.entries(PROVIDER_MODELS).map(([provider, models]) => ({
        provider,
        models: models.map((m) => `${provider}/${m}`),
      }));
    } catch {
      return [];
    }
  });

  // Flatten all available models
  const allModels = keys.flatMap((k) => k.models);
  // Also keep free-text custom models
  const customModels = value && !allModels.includes(value) ? [value] : [];

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list="model-suggestions"
        className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
      />
      <datalist id="model-suggestions">
        {[...allModels, ...customModels].map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </div>
  );
}
```

Replace the three `<input>` elements in `ModelMappingSection` that use `placeholder` with `<ModelSelect>`:

```tsx
<div>
  <label className="text-content-secondary mb-1 block text-sm">Default Model (default)</label>
  <ModelSelect
    value={mapping.default}
    onChange={(v) => setMapping((p) => ({ ...p, default: v }))}
    placeholder="e.g. openai/gpt-4o"
  />
</div>
```

Same pattern for `deep_reasoning` and `fast_execution`.

- [ ] **Step 4: Show test result inline on ApiKeyRow**

The existing ApiKeyRow already shows test results (lines 202-209). No change needed — this is already implemented.

- [ ] **Step 5: Add "Custom (OpenAI-compatible)" provider support for BYOK**

In the form's base URL section (lines 104-112), show the base URL field by default when `custom` provider is selected:

```tsx
{
  (formData.provider === 'custom' || formData.baseUrl) && (
    <div>
      <label className="text-content-tertiary mb-1 block text-xs">Base URL (optional)</label>
      <input
        type="text"
        placeholder={
          formData.provider === 'custom' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com'
        }
        value={formData.baseUrl}
        onChange={(e) => setFormData((p) => ({ ...p, baseUrl: e.target.value }))}
        className="border-border bg-surface-primary text-content-primary w-full rounded-sm border px-3 py-2 text-sm"
      />
    </div>
  );
}
```

Change the condition from always-showing to only showing for `custom` provider or when a base URL is already set.

- [ ] **Step 6: Run typecheck and tests**

```bash
pnpm typecheck
pnpm test
```

Both should pass.
