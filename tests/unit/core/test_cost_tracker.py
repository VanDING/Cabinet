from __future__ import annotations

import pytest
from cabinet.core.cost_tracker import CostTracker, CostBudget, ModelPricing


class TestModelPricing:
    def test_lookup_by_model_name(self):
        pricing = ModelPricing()
        price = pricing.get_prices("openai/gpt-4o")
        assert price["input"] > 0
        assert price["output"] > 0

    def test_unknown_model_returns_default(self):
        pricing = ModelPricing()
        price = pricing.get_prices("unknown/unknown")
        assert price["input"] == 1.0
        assert price["output"] == 3.0


class TestCostTracker:
    def test_record_usage_accumulates(self):
        tracker = CostTracker()
        tracker.record_usage("openai/gpt-4o", prompt_tokens=1000, completion_tokens=500)
        assert tracker.total_cost_usd > 0
        assert tracker.model_usage["openai/gpt-4o"]["input_tokens"] == 1000
        assert tracker.model_usage["openai/gpt-4o"]["output_tokens"] == 500

    def test_multiple_models_tracked_separately(self):
        tracker = CostTracker()
        tracker.record_usage("openai/gpt-4o", prompt_tokens=1000, completion_tokens=500)
        tracker.record_usage("anthropic/claude-sonnet-4-6", prompt_tokens=2000, completion_tokens=300)
        assert len(tracker.model_usage) == 2

    def test_cache_hit_records_discounted_cost(self):
        tracker = CostTracker()
        tracker.record_usage("openai/gpt-4o", prompt_tokens=5000, completion_tokens=500,
                             cache_read_tokens=5000)
        assert tracker.model_usage["openai/gpt-4o"]["cache_read_tokens"] == 5000

    def test_reset_clears_all_usage(self):
        tracker = CostTracker()
        tracker.record_usage("openai/gpt-4o", prompt_tokens=1000, completion_tokens=500)
        tracker.reset()
        assert tracker.total_cost_usd == 0.0
        assert len(tracker.model_usage) == 0


class TestCostBudget:
    def test_remaining_decreases_with_usage(self):
        budget = CostBudget(limit_usd=1.00)
        budget.spend(0.30)
        assert budget.remaining_usd == pytest.approx(0.70)

    def test_is_exhausted_when_over_limit(self):
        budget = CostBudget(limit_usd=0.10)
        budget.spend(0.15)
        assert budget.is_exhausted

    def test_can_call_within_budget(self):
        budget = CostBudget(limit_usd=0.50)
        assert budget.can_spend(estimated=0.30)
        assert not budget.can_spend(estimated=0.60)

    def test_warning_threshold_triggered(self):
        budget = CostBudget(limit_usd=1.00, warning_threshold=0.50)
        budget.spend(0.60)
        assert budget.is_over_warning

    def test_format_for_display(self):
        budget = CostBudget(limit_usd=1.00)
        budget.spend(0.326)
        display = budget.format()
        assert "$0.33" in display
        assert "$1.00" in display
