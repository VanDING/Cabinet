from __future__ import annotations

import pytest
from cabinet.core.prompt_cache import PromptCacheManager, PromptCacheStats


def test_prompt_cache_manager_splits_at_boundary():
    manager = PromptCacheManager(
        static_prompt="You are Cabinet. You help the user with tasks.\n"
                       "---STATIC_ABOVE_/_DYNAMIC_BELOW---\n"
    )
    dynamic = "Working directory: /home/user\nGit branch: main\n"
    parts = manager.build_prompt_parts(dynamic_context=dynamic)

    assert "Cabinet" in parts["static"]
    assert "Working directory" in parts["dynamic"]
    assert "STATIC_ABOVE" not in parts["static"]
    assert "STATIC_ABOVE" not in parts["dynamic"]


def test_no_boundary_treats_everything_as_dynamic():
    manager = PromptCacheManager(
        static_prompt="Everything is dynamic here."
    )
    parts = manager.build_prompt_parts(dynamic_context="/home/user")

    assert parts["static"] == ""
    assert parts["dynamic"] == "Everything is dynamic here.\n/home/user"


def test_cache_stats_tracks_hits_and_misses():
    stats = PromptCacheStats()
    stats.record_hit()
    stats.record_hit()
    stats.record_miss()

    assert stats.hits == 2
    assert stats.misses == 1
    assert stats.hit_rate == pytest.approx(2 / 3)


def test_cache_stats_reset():
    stats = PromptCacheStats()
    stats.record_hit()
    stats.reset()
    assert stats.hits == 0
    assert stats.misses == 0
    assert stats.total_requests == 0


def test_cache_fingerprint_changes_on_static_modification():
    manager = PromptCacheManager(
        static_prompt="System: Version 1\n---STATIC_ABOVE_/_DYNAMIC_BELOW---\n"
    )
    fp1 = manager.fingerprint()

    manager.static_prompt = "System: Version 2\n---STATIC_ABOVE_/_DYNAMIC_BELOW---\n"
    fp2 = manager.fingerprint()

    assert fp1 != fp2


def test_cache_fingerprint_stable_for_same_content():
    manager1 = PromptCacheManager(static_prompt="System: Version 1\n---STATIC_ABOVE_/_DYNAMIC_BELOW---\n")
    manager2 = PromptCacheManager(static_prompt="System: Version 1\n---STATIC_ABOVE_/_DYNAMIC_BELOW---\n")
    assert manager1.fingerprint() == manager2.fingerprint()


def test_compactor_uses_prompt_cache_manager():
    from cabinet.core.compact import ContextCompactor
    from cabinet.core.prompt_cache import PromptCacheManager

    pm = PromptCacheManager(
        static_prompt="You are Cabinet.\n---STATIC_ABOVE_/_DYNAMIC_BELOW---\n"
    )
    compactor = ContextCompactor(
        gateway=None,
        prompt_cache_manager=pm,
    )
    parts = compactor.prompt_cache.build_prompt_parts(
        dynamic_context="CWD: /project\n",
    )
    assert "You are Cabinet." in parts["static"]
    assert "CWD: /project" in parts["dynamic"]


def test_build_anthropic_system_with_static_and_dynamic():
    manager = PromptCacheManager(
        static_prompt="You are Cabinet.\n---STATIC_ABOVE_/_DYNAMIC_BELOW---\nContext below:\n"
    )
    result = manager.build_anthropic_system(dynamic_context="CWD: /project")

    assert len(result) >= 2
    static_block = result[0]
    assert static_block["type"] == "text"
    assert "Cabinet" in static_block["text"]
    assert static_block["cache_control"] == {"type": "ephemeral"}

    dynamic_block = result[1]
    assert dynamic_block["type"] == "text"
    assert "CWD: /project" in dynamic_block["text"]
    assert "cache_control" not in dynamic_block


def test_build_anthropic_system_with_extra_systems():
    manager = PromptCacheManager(
        static_prompt="System.\n---STATIC_ABOVE_/_DYNAMIC_BELOW---\n"
    )
    result = manager.build_anthropic_system(
        dynamic_context="/home",
        extra_systems=[{"type": "text", "text": "Extra prompt"}],
    )
    assert result[-1]["text"] == "Extra prompt"


def test_build_anthropic_system_no_boundary_all_dynamic():
    manager = PromptCacheManager(static_prompt="Just a prompt.")
    result = manager.build_anthropic_system(dynamic_context="WD: /tmp")

    # When no boundary, static is empty, so only dynamic block (no cache_control)
    assert len(result) == 1
    assert result[0]["type"] == "text"
    assert "Just a prompt" in result[0]["text"]
    assert "cache_control" not in result[0]


def test_estimate_cache_savings_returns_positive_value():
    savings = PromptCacheManager.estimate_cache_savings(4000, cost_per_million_input=3.0)
    # 4000 chars ~= 1000 tokens, 1000/1M * $3 = $0.003 uncached, $0.0003 cached
    # Savings = $0.0027
    assert savings > 0
    assert savings < 0.01


def test_estimate_cache_savings_zero_chars():
    savings = PromptCacheManager.estimate_cache_savings(0)
    # 1 token (max(1, 0//4)) minimal cost
    assert savings >= 0


def test_cache_stats_reset_clears_timestamps():
    stats = PromptCacheStats()
    stats.record_hit()
    assert stats.last_hit_at > 0
    stats.reset()
    assert stats.last_hit_at == 0.0
    assert stats.last_miss_at == 0.0


def test_build_prompt_parts_empty_prompt():
    manager = PromptCacheManager(static_prompt="")
    parts = manager.build_prompt_parts(dynamic_context="hello")
    assert parts["static"] == ""
    assert "hello" in parts["dynamic"]


def test_build_prompt_parts_empty_dynamic_context():
    manager = PromptCacheManager(
        static_prompt="Static.\n---STATIC_ABOVE_/_DYNAMIC_BELOW---\nTrailing."
    )
    parts = manager.build_prompt_parts(dynamic_context="")
    assert "Static." in parts["static"]
    assert "Trailing." in parts["dynamic"]
