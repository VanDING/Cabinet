from __future__ import annotations

from cabinet.core.harness.denial_tracker import DenialTracker


class TestDenialTracking:
    def test_consecutive_denials_increment(self):
        tracker = DenialTracker(max_consecutive=3, max_total=20)
        assert not tracker.is_circuit_open()

        tracker.record_denial("bash", "rm -rf /")
        tracker.record_denial("bash", "git push --force")
        assert tracker.consecutive == 2
        assert tracker.total == 2
        assert not tracker.is_circuit_open()

    def test_circuit_opens_after_max_consecutive(self):
        tracker = DenialTracker(max_consecutive=3, max_total=20)
        tracker.record_denial("bash", "sudo rm")
        tracker.record_denial("bash", "chmod 777")
        tracker.record_denial("bash", "git push --force main")
        assert tracker.is_circuit_open()

    def test_success_resets_consecutive_but_not_total(self):
        tracker = DenialTracker(max_consecutive=3, max_total=20)
        tracker.record_denial("bash", "sudo rm")
        tracker.record_denial("bash", "chmod 777")
        assert tracker.consecutive == 2

        tracker.record_success("grep")
        assert tracker.consecutive == 0
        assert tracker.total == 2

    def test_total_circuit_opens_at_max_total(self):
        tracker = DenialTracker(max_consecutive=3, max_total=5)
        for i in range(5):
            tracker.record_denial("bash", f"dangerous cmd {i}")
            tracker.record_success("grep")
        assert tracker.consecutive == 0
        assert tracker.is_circuit_open()

    def test_reset_clears_all_counters(self):
        tracker = DenialTracker()
        tracker.record_denial("bash", "rm")
        tracker.record_denial("bash", "sudo")
        tracker.reset()
        assert tracker.consecutive == 0
        assert tracker.total == 0
        assert not tracker.is_circuit_open()

    def test_denials_include_tool_name_and_input(self):
        tracker = DenialTracker()
        tracker.record_denial("bash", "rm -rf /")
        assert len(tracker.recent_denials) == 1
        assert tracker.recent_denials[0]["tool"] == "bash"
        assert "rm -rf" in tracker.recent_denials[0]["input"]
