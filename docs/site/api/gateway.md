# Gateway API

The LLM Gateway manages provider configuration, model routing, cost tracking, and budget enforcement. It is a pure TypeScript layer built on Vercel AI SDK.

## Endpoints

### `GET /api/settings/api-keys`

List configured API keys. Keys are encrypted at rest; only the first 8 decrypted characters are shown as a preview.

**Response**:

```json
{
  "keys": [
    {
      "id": "key_1716200000000",
      "provider": "anthropic",
      "keyPreview": "sk-ant...",
      "encrypted": "ENC[...]",
      "keyType": "api_key",
      "baseUrl": "https://api.anthropic.com",
      "model": "",
      "createdAt": "2026-05-15T08:00:00Z"
    }
  ]
}
```

### `POST /api/settings/api-keys`

Add or update an API key.

**Request**:

```json
{
  "provider": "anthropic",
  "apiKey": "sk-ant-api03-...",
  "baseUrl": "https://api.anthropic.com",
  "model": "claude-sonnet-4-6",
  "keyType": "api_key"
}
```

**Response**:

```json
{
  "id": "key_1716200000001",
  "status": "key_added",
  "provider": "anthropic"
}
```

After adding a key, the gateway is automatically refreshed to include the new provider.

### `DELETE /api/settings/api-keys/:id`

Remove an API key.

**Response**:

```json
{ "status": "deleted" }
```

### `POST /api/settings/preferred-key`

Set the active preferred key for a provider.

**Request**:

```json
{ "keyId": "key_1716200000000" }
```

Set `keyId` to `null` to clear the preference.

### `POST /api/settings/api-keys/:id/test`

Test an API key by making a minimal LLM call.

**Response**:

```json
{
  "status": "ok",
  "latencyMs": 420,
  "model": "claude-haiku-4-5"
}
```

### `GET /api/settings/budget`

Query current budget status and spend.

**Response**:

```json
{
  "daily": 5.0,
  "weekly": 25.0,
  "monthly": 100.0,
  "currentSpend": 1.23,
  "budgetStatus": {
    "daily": { "spent": 1.23, "limit": 5.0, "remaining": 3.77, "percentage": 0.246 },
    "weekly": { "spent": 4.56, "limit": 25.0, "remaining": 20.44, "percentage": 0.182 },
    "monthly": { "spent": 12.30, "limit": 100.0, "remaining": 87.70, "percentage": 0.123 }
  }
}
```

> **Currency**: All budget values are in **RMB** (¥).

### `PUT /api/settings/budget`

Update budget limits.

**Request**:

```json
{
  "daily": 10.0,
  "weekly": 50.0,
  "monthly": 200.0
}
```

### `GET /api/health`

System health check including gateway status.

**Response**:

```json
{
  "status": "healthy",
  "gateway": {
    "providers": ["anthropic", "openai"],
    "activeModel": "anthropic/claude-sonnet-4-6"
  },
  "timestamp": "2026-05-20T10:00:00Z"
}
```

## Supported Providers

| Provider | Models | Notes |
| :------- | :----- | :---- |
| **Anthropic** | `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5` | Primary recommended provider |
| **OpenAI** | `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo` | Good fallback |
| **DeepSeek** | `deepseek-chat`, `deepseek-v3`, `deepseek-r1` | Cost-effective |
| **Google** | `gemini-2.0-flash`, `gemini-2.0-pro` | Multimodal capable |

## Model Router

The `ModelRouter` maps roles to model chains:

| Role | Primary | Fallbacks |
| :--- | :------ | :-------- |
| `deep_think` | `anthropic/claude-opus-4-7` | `anthropic/claude-sonnet-4-6` |
| `fast_execute` | `anthropic/claude-haiku-4-5` | `openai/gpt-4o-mini` |
| `default` | `anthropic/claude-sonnet-4-6` | `openai/gpt-4o` |

You can override these mappings via settings or per-request `model` parameter.

## Fallback Chain

If the primary model fails (timeout, rate limit, error), the gateway automatically tries the next model in the chain:

```
claude-opus-4-7 → claude-sonnet-4-6 → gpt-4o → gpt-4o-mini → Error
```

Rate limit state is tracked per provider to avoid hammering exhausted APIs.

## Cost Tracking

Every LLM call records:

- Provider and model
- Input tokens and output tokens
- Cost in RMB
- Timestamp

Aggregates are available per session, day, week, and month.

## Budget Guard

The `BudgetGuard` enforces hard caps:

| Threshold | Behavior |
| :-------- | :------- |
| 80% | Dashboard warning + toast notification |
| 100% | Block non-L3 LLM calls |
| L3 exceeded | Require explicit Captain override |

Budget alerts are broadcast via WebSocket (`budget_alert`) and shown in the UI.

## Why No Python/LiteLLM?

Cabinet uses Vercel AI SDK (pure TypeScript) instead of Python-based LiteLLM. This avoids:

- Bundling a Python runtime in the desktop app
- Managing two dependency systems (pip + pnpm)
- Cross-language debugging

The trade-off is that new provider integrations require TypeScript adapter code rather than LiteLLM's universal proxy.
