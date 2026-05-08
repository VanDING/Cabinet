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


async def test_compactor_uses_prompt_cache_manager():
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
