from __future__ import annotations

import pytest
from cabinet.core.user.models import MemoryType
from cabinet.core.user.profile_manager import UserProfileManager
from cabinet.core.user.model_learner import UserModelLearner, ConversationObservation


class TestUserModelLearner:
    @pytest.fixture
    def learner(self, tmp_path):
        manager = UserProfileManager(data_dir=tmp_path)
        return UserModelLearner(manager)

    def test_detect_correction_creates_feedback_memory(self, learner):
        obs = learner.analyze_interaction(
            user_message="No, don't write docstrings. I prefer inline comments.",
            assistant_response="Got it, I'll avoid docstrings.",
        )
        assert obs is not None
        assert obs.memory_type == MemoryType.FEEDBACK

    def test_detect_explicit_remember(self, learner):
        obs = learner.analyze_interaction(
            user_message="Remember that our CI uses GitHub Actions with 4 workers.",
            assistant_response="I'll save that.",
        )
        assert obs is not None
        assert obs.memory_type in (MemoryType.REFERENCE, MemoryType.PROJECT)

    def test_no_observation_for_casual_chat(self, learner):
        obs = learner.analyze_interaction(
            user_message="What's the weather today?",
            assistant_response="I don't have access to weather data.",
        )
        assert obs is None

    def test_save_observation_persists_memory(self, learner):
        obs = ConversationObservation(
            memory_type=MemoryType.USER,
            name="Python Expert",
            content="User has 10 years Python experience. Frame explanations accordingly.",
            confidence=0.9,
        )
        learner.save_observation(obs)
        loaded = learner.manager.load_all(MemoryType.USER)
        assert len(loaded) == 1
        assert "10 years Python" in loaded[0].content

    def test_low_confidence_observations_not_saved(self, learner):
        obs = ConversationObservation(
            memory_type=MemoryType.USER,
            name="Maybe Expert",
            content="User might know Python",
            confidence=0.3,
        )
        learner.save_observation(obs)
        loaded = learner.manager.load_all(MemoryType.USER)
        assert len(loaded) == 0

    def test_detect_user_role_from_introduction(self, learner):
        obs = learner.analyze_interaction(
            user_message="I'm a data scientist working on our logging pipeline.",
            assistant_response="Great, I'll help with the logging pipeline.",
        )
        assert obs is not None
        assert obs.memory_type == MemoryType.USER
