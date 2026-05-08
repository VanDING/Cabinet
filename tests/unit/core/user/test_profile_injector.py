from __future__ import annotations

import pytest
from cabinet.core.user.models import MemoryType, MemoryEntry
from cabinet.core.user.profile_manager import UserProfileManager
from cabinet.core.user.profile_injector import UserProfileInjector


class TestProfileInjector:
    @pytest.fixture
    def manager(self, tmp_path):
        mgr = UserProfileManager(data_dir=tmp_path)
        mgr.save(MemoryEntry(
            memory_type=MemoryType.USER,
            name="Role",
            content="Senior backend engineer with 10 years Go experience",
        ))
        mgr.save(MemoryEntry(
            memory_type=MemoryType.FEEDBACK,
            name="Style",
            content="Prefer terse responses. No emoji. No trailing summaries.",
        ))
        mgr.save(MemoryEntry(
            memory_type=MemoryType.PROJECT,
            name="Auth Migration",
            content="Auth middleware rewrite driven by legal/compliance requirements for session token storage.",
        ))
        return mgr

    def test_injector_builds_context(self, manager):
        injector = UserProfileInjector(manager)
        context = injector.build_context("captain-1")
        assert "Senior backend engineer" in context
        assert "terse responses" in context
        assert "Auth middleware" in context

    def test_injector_respects_max_tokens(self, manager):
        injector = UserProfileInjector(manager, max_tokens=50)
        context = injector.build_context("captain-1")
        assert len(context) <= 200  # ~50 tokens * 4 chars

    def test_empty_profile_produces_empty_context(self, tmp_path):
        empty_manager = UserProfileManager(data_dir=tmp_path)
        injector = UserProfileInjector(empty_manager)
        context = injector.build_context("unknown-captain")
        assert context == ""

    def test_injector_formats_for_system_prompt(self, manager):
        injector = UserProfileInjector(manager)
        prompt_section = injector.format_as_system_prompt("captain-1")
        assert "<user-profile>" in prompt_section
        assert "</user-profile>" in prompt_section

    def test_injector_caches_profile_for_reuse(self, manager):
        injector = UserProfileInjector(manager, cache_ttl=300)
        ctx1 = injector.build_context("captain-1")
        ctx2 = injector.build_context("captain-1")
        assert ctx1 == ctx2  # cached

    def test_injector_refreshes_after_ttl_expiry(self, manager):
        injector = UserProfileInjector(manager, cache_ttl=-1)
        ctx1 = injector.build_context("captain-1")
        ctx2 = injector.build_context("captain-1")
        assert ctx1 == ctx2  # Should still work, just re-fetched
