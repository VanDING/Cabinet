from __future__ import annotations

import logging
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)

DEFAULT_PRICING: dict[str, dict[str, float]] = {
    "openai/gpt-4o": {"input": 2.50, "output": 10.00},
    "openai/gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "openai/gpt-4": {"input": 30.00, "output": 60.00},
    "anthropic/claude-opus-4-7": {"input": 15.00, "output": 75.00},
    "anthropic/claude-sonnet-4-6": {"input": 3.00, "output": 15.00},
    "anthropic/claude-haiku-4-5": {"input": 0.80, "output": 4.00},
    "deepseek/deepseek-v4-pro": {"input": 0.55, "output": 2.19},
    "deepseek/deepseek-v4-flash": {"input": 0.14, "output": 0.28},
    "google/gemini-2.5-pro": {"input": 1.25, "output": 10.00},
    "google/gemini-2.5-flash": {"input": 0.075, "output": 0.30},
    "ollama/llama3": {"input": 0.0, "output": 0.0},
}


class ModelPricing:
    def __init__(self, overrides: dict[str, dict[str, float]] | None = None):
        self._pricing = dict(DEFAULT_PRICING)
        if overrides:
            self._pricing.update(overrides)

    def get_prices(self, model: str) -> dict[str, float]:
        if model in self._pricing:
            return dict(self._pricing[model])
        for prefix, prices in self._pricing.items():
            if model.startswith(prefix.rstrip("*")):
                return dict(prices)
        return {"input": 1.0, "output": 3.0}


@dataclass
class ModelUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_tokens: int = 0
    cache_read_tokens: int = 0
    cost_usd: float = 0.0
    calls: int = 0


@dataclass
class CostBudget:
    limit_usd: float
    spent_usd: float = 0.0
    warning_threshold: float = 0.80

    @property
    def remaining_usd(self) -> float:
        return max(0.0, self.limit_usd - self.spent_usd)

    @property
    def is_exhausted(self) -> bool:
        return self.spent_usd >= self.limit_usd

    @property
    def is_over_warning(self) -> bool:
        return (self.spent_usd / self.limit_usd) >= self.warning_threshold if self.limit_usd > 0 else False

    def spend(self, amount: float) -> None:
        self.spent_usd += amount

    def can_spend(self, estimated: float) -> bool:
        return (self.spent_usd + estimated) <= self.limit_usd

    def format(self) -> str:
        return (
            f"${self.spent_usd:.2f} / ${self.limit_usd:.2f} "
            f"({(self.spent_usd / self.limit_usd * 100):.0f}%)"
            if self.limit_usd > 0
            else f"${self.spent_usd:.2f} (no limit)"
        )


class CostTracker:
    def __init__(self, pricing: ModelPricing | None = None, budget: CostBudget | None = None):
        self._pricing = pricing or ModelPricing()
        self._budget = budget
        self._model_usage: dict[str, ModelUsage] = {}
        self._start_time = time.monotonic()

    def record_usage(
        self,
        model: str,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        cache_creation_tokens: int = 0,
        cache_read_tokens: int = 0,
    ) -> None:
        if model not in self._model_usage:
            self._model_usage[model] = ModelUsage()

        usage = self._model_usage[model]
        usage.input_tokens += prompt_tokens
        usage.output_tokens += completion_tokens
        usage.cache_creation_tokens += cache_creation_tokens
        usage.cache_read_tokens += cache_read_tokens
        usage.calls += 1

        prices = self._pricing.get_prices(model)
        input_price = prices["input"] / 1_000_000
        output_price = prices["output"] / 1_000_000

        cost = prompt_tokens * input_price + completion_tokens * output_price
        if cache_read_tokens > 0:
            cost += cache_read_tokens * input_price * 0.10
        if cache_creation_tokens > 0:
            cost += cache_creation_tokens * input_price * 0.25

        usage.cost_usd += cost

        if self._budget:
            self._budget.spend(cost)

        logger.debug(
            "Cost: model=%s cost=$%.6f total=$%.4f",
            model, cost, self.total_cost_usd,
        )

    @property
    def total_cost_usd(self) -> float:
        return sum(u.cost_usd for u in self._model_usage.values())

    @property
    def total_input_tokens(self) -> int:
        return sum(u.input_tokens for u in self._model_usage.values())

    @property
    def total_output_tokens(self) -> int:
        return sum(u.output_tokens for u in self._model_usage.values())

    @property
    def model_usage(self) -> dict:
        result = {}
        for model, usage in self._model_usage.items():
            result[model] = {
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens,
                "cache_read_tokens": usage.cache_read_tokens,
                "cache_creation_tokens": usage.cache_creation_tokens,
                "cost_usd": usage.cost_usd,
                "calls": usage.calls,
            }
        return result

    @property
    def budget(self) -> CostBudget | None:
        return self._budget

    @property
    def uptime_seconds(self) -> float:
        return time.monotonic() - self._start_time

    def reset(self) -> None:
        self._model_usage.clear()
        self._start_time = time.monotonic()
