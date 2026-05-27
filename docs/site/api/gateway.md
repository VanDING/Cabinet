# LLM Gateway API

Multi-provider LLM gateway with cost tracking, budget guarding, and fallback chains.

## Supported Providers

| Provider  | Models                                               |
| --------- | ---------------------------------------------------- |
| Anthropic | claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-7 |
| OpenAI    | gpt-4o, gpt-4o-mini, gpt-4-turbo                     |
| DeepSeek  | deepseek-chat, deepseek-v3, deepseek-r1              |
| Google    | gemini-2.0-flash, gemini-2.0-pro                     |

## Endpoints

### `GET /api/settings/api-keys`

List configured API keys (keys are encrypted at rest).

### `POST /api/settings/api-keys`

Add or update an API key.

**Body**:

```json
{
  "provider": "anthropic",
  "apiKey": "sk-ant-...",
  "baseUrl": "https://api.anthropic.com"
}
```

**Response**:

```json
{
  "status": "key_added",
  "id": "key_..."
}
```

## Features

### Model Router

Routes generation requests to the most appropriate model based on:

- Task complexity
- Cost constraints
- Latency requirements
- Provider availability

### Fallback Chains

If a primary provider fails, the gateway automatically falls back to secondary providers in a configured chain:

```
Anthropic → OpenAI → DeepSeek → Error
```

### Cost Tracking

Every LLM call is tracked with per-model cost. Budget limits are configurable:

- Daily budget (default: $5)
- Weekly budget (default: $25)
- Monthly budget (default: $100)

When nearing 80% of any limit, warnings are shown. At 100%, further calls are blocked.

### Budget Guard

The gateway enforces a hard budget cap. Attempting to exceed the budget returns an error before the API call is made, avoiding unnecessary costs.
