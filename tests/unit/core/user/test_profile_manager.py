from __future__ import annotations

from cabinet.core.user.models import MemoryType, MemoryEntry
from cabinet.core.user.profile_manager import UserProfileManager


class TestMemoryEntry:
    def test_user_memory_has_required_fields(self):
        entry = MemoryEntry(
            memory_type=MemoryType.USER,
            name="User Role",
            content="**Role:** Senior data scientist\n**Focus:** Observability and logging",
        )
        assert entry.memory_type == MemoryType.USER
        assert "Senior data scientist" in entry.content
        assert entry.name == "User Role"

    def test_feedback_memory_has_rule_format(self):
        entry = MemoryEntry(
            memory_type=MemoryType.FEEDBACK,
            name="No Mocks in Integration Tests",
            content="Integration tests must hit a real database, not mocks.\n"
                    "**Why:** Prior incident where mock/prod divergence masked broken migration.\n"
                    "**How to apply:** When writing tests in the integration/ directory.",
        )
        assert entry.memory_type == MemoryType.FEEDBACK
        assert "Why:" in entry.content
        assert "How to apply:" in entry.content


class TestUserProfileManager:
    def test_save_and_load_memory(self, tmp_path):
        manager = UserProfileManager(data_dir=tmp_path)
        entry = MemoryEntry(
            memory_type=MemoryType.PROJECT,
            name="Merge Freeze",
            content="Merge freeze begins 2026-05-15 for mobile release cut.",
        )
        manager.save(entry)
        loaded = manager.load_all(MemoryType.PROJECT)
        assert len(loaded) == 1
        assert "Merge freeze" in loaded[0].content

    def test_update_existing_memory(self, tmp_path):
        manager = UserProfileManager(data_dir=tmp_path)
        entry = MemoryEntry(
            memory_type=MemoryType.REFERENCE,
            name="Bug Tracker",
            content="Bugs tracked in Linear project INGEST",
        )
        manager.save(entry)

        updated = MemoryEntry(
            memory_type=MemoryType.REFERENCE,
            name="Bug Tracker",
            content="Bugs tracked in Jira project INGEST (migrated from Linear)",
        )
        manager.save(updated)

        loaded = manager.load_all(MemoryType.REFERENCE)
        assert len(loaded) == 1
        assert "Jira" in loaded[0].content

    def test_delete_memory(self, tmp_path):
        manager = UserProfileManager(data_dir=tmp_path)
        entry = MemoryEntry(memory_type=MemoryType.PROJECT, name="Temp", content="Temporary note")
        manager.save(entry)
        assert len(manager.load_all(MemoryType.PROJECT)) == 1

        manager.delete(MemoryType.PROJECT, "Temp")
        assert len(manager.load_all(MemoryType.PROJECT)) == 0

    def test_memories_persist_across_manager_instances(self, tmp_path):
        manager1 = UserProfileManager(data_dir=tmp_path)
        manager1.save(MemoryEntry(memory_type=MemoryType.USER, name="Skills", content="Python expert"))

        manager2 = UserProfileManager(data_dir=tmp_path)
        loaded = manager2.load_all(MemoryType.USER)
        assert len(loaded) == 1
        assert "Python expert" in loaded[0].content

    def test_build_user_profile_aggregates_all_types(self, tmp_path):
        manager = UserProfileManager(data_dir=tmp_path)
        manager.save(MemoryEntry(memory_type=MemoryType.USER, name="Role", content="Backend engineer"))
        manager.save(MemoryEntry(memory_type=MemoryType.FEEDBACK, name="Pref1", content="No docstrings"))
        manager.save(MemoryEntry(memory_type=MemoryType.PROJECT, name="Context", content="Refactoring auth"))
        manager.save(MemoryEntry(memory_type=MemoryType.REFERENCE, name="Dashboard", content="grafana.internal"))

        profile = manager.build_profile("captain-1")
        assert profile.captain_id == "captain-1"
        assert len(profile.user_memories) == 1
        assert len(profile.feedback_memories) == 1
        assert len(profile.project_memories) == 1
        assert len(profile.reference_memories) == 1

    def test_memory_has_timestamp(self, tmp_path):
        manager = UserProfileManager(data_dir=tmp_path)
        entry = MemoryEntry(memory_type=MemoryType.USER, name="Test", content="Content")
        manager.save(entry)
        loaded = manager.load_all(MemoryType.USER)
        assert loaded[0].created_at > 0
        assert loaded[0].updated_at >= loaded[0].created_at
