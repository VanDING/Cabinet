from __future__ import annotations

from unittest.mock import MagicMock

from cabinet.agents.tools import (
    CONCURRENT_SAFE_TOOLS,
    EXCLUSIVE_TOOLS,
    is_concurrency_safe,
    partition_tool_calls,
)


def _tc(name):
    tc = MagicMock()
    tc.function.name = name
    return tc


def test_is_concurrency_safe_read():
    assert is_concurrency_safe("Read") is True
    assert is_concurrency_safe("Grep") is True


def test_is_concurrency_safe_bash():
    assert is_concurrency_safe("Bash") is False


def test_is_concurrency_safe_unknown():
    assert is_concurrency_safe("UnknownTool") is False


def test_partition_mixed_tools():
    """Read + Grep + Bash + Glob + Write → [[Read,Grep], [Bash], [Glob], [Write]]"""
    tcs = [_tc("Read"), _tc("Grep"), _tc("Bash"), _tc("Glob"), _tc("Write")]
    partitions = partition_tool_calls(tcs)
    assert len(partitions) == 4
    assert len(partitions[0]) == 2  # Read, Grep
    assert partitions[1][0].function.name == "Bash"
    assert partitions[2][0].function.name == "Glob"
    assert partitions[3][0].function.name == "Write"


def test_partition_all_safe():
    tcs = [_tc("Read"), _tc("Grep"), _tc("Glob")]
    partitions = partition_tool_calls(tcs)
    assert len(partitions) == 1
    assert len(partitions[0]) == 3


def test_partition_all_exclusive():
    tcs = [_tc("Bash"), _tc("Write"), _tc("Edit")]
    partitions = partition_tool_calls(tcs)
    assert len(partitions) == 3
    assert all(len(p) == 1 for p in partitions)


def test_partition_starts_with_exclusive():
    tcs = [_tc("Bash"), _tc("Read"), _tc("Grep")]
    partitions = partition_tool_calls(tcs)
    assert len(partitions) == 2
    assert len(partitions[0]) == 1  # Bash
    assert len(partitions[1]) == 2  # Read, Grep


def test_partition_empty():
    assert partition_tool_calls([]) == []


def test_concurrent_safe_list_has_expected():
    assert "Read" in CONCURRENT_SAFE_TOOLS
    assert "Grep" in CONCURRENT_SAFE_TOOLS
    assert "Glob" in CONCURRENT_SAFE_TOOLS
    assert "WebSearch" in CONCURRENT_SAFE_TOOLS


def test_exclusive_list_has_expected():
    assert "Bash" in EXCLUSIVE_TOOLS
    assert "Write" in EXCLUSIVE_TOOLS
    assert "Edit" in EXCLUSIVE_TOOLS
    assert "NotebookEdit" in EXCLUSIVE_TOOLS
