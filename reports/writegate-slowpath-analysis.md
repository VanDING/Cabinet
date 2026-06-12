# WriteGate Embedding Slow Path — Cost/Benefit Analysis

> Status: instrumentation implemented; data collection required before activation decision.

## 1. Background

`WriteGate` uses a fast regex heuristic to decide whether a short-term memory entry should be promoted to long-term memory. The optional embedding slow path can re-evaluate entries classified as `transient_noise` by comparing their embeddings against tier anchor vectors.

The slow path is currently **opt-in** because it adds an embedding API call for every noise entry, and the marginal recall improvement was unmeasured.

## 2. Instrumentation (implemented)

`ConsolidationService.sampleSlowPath(sessionId, entries?)` now daily samples up to 20 `transient_noise` entries and re-runs them through `WriteGate.evaluateAsync(...)` with the configured embedding provider.

Metrics captured:

- `sampled`: number of noise entries sampled per day
- `rescued`: number of sampled entries the slow path would promote (fast=noise → slow=allowed)
- recall lift = `rescued / sampled`

`WriteGate.getStats()` already tracks:

- `totalEvaluated`
- `transientNoise`
- `byChannel.{fast, slow, fallback}`

## 3. Cost model

For a deployment with `N` noise entries per day:

- **Slow-path cost** ≈ `N × embedding_cost_per_token`
- **Sampling cost** ≈ `20 × embedding_cost_per_token` per day (fixed)
- **Full activation daily cost** ≈ `N × C`

Where `C` is the per-call embedding cost (e.g., OpenAI `text-embedding-3-small` ≈ $0.02 / 1M tokens).

## 4. Benefit model

- **Recall lift** = fraction of true positives recovered by the slow path.
- **Value of a rescued memory** is context-dependent; a conservative proxy is the downstream tool-use accuracy improvement or user correction rate.
- **Break-even** (in rescued-memory value) occurs when:

  ```
  N × C < value(rescued_memories_per_day)
  ```

## 5. Decision criteria

| Recall lift | Recommendation                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| < 1%        | Keep slow path disabled; cost exceeds benefit for most workloads.                                                        |
| 1% – 5%     | Consider tiered activation (e.g., only for sessions with `importance > 0.7` or specific roles).                          |
| 5% – 10%    | Enable shadow mode (compute slow path, log results, still use fast path) to collect quality labels.                      |
| > 10%       | Strong signal to activate by default; update `ConsolidationService` constructor to always provide an embedding provider. |

## 6. Suggested next steps

1. Configure an embedding provider in production/staging (e.g., via `apps/server/src/context/memory.ts`).
2. Run the sampler for 7 days.
3. Compute recall lift from logs: `grep '\[SlowPathSample\]'`.
4. Compare lift against embedding API cost.
5. Apply the decision criteria above and update `useEmbeddingSlowPath` default accordingly.

## 7. Risks

- **Anchor drift**: anchor embeddings should be recomputed periodically as the LTM corpus evolves.
- **Provider latency**: slow path adds async latency to consolidation; acceptable if run in background.
- **False positives**: high recall lift with low precision would pollute LTM; manual sampling of rescued entries is recommended.
