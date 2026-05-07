from __future__ import annotations

from cabinet.core.compact import (
    MODEL_TOKEN_LIMITS,
    TOOL_PREVIEW_CHARS,
    TOOL_RESULT_MAX_CHARS,
    TokenBudget,
    compact_tool_result,
)


def test_token_budget_estimation_cjk():
    budget = TokenBudget(model_max_tokens=200_000)
    cn_text = "这是一段中文文本用于测试token估算功能"
    assert budget.estimate_tokens(cn_text) == len(cn_text) // 4


def test_token_budget_estimation_en():
    budget = TokenBudget(model_max_tokens=200_000)
    en_text = "This is a test sentence for token estimation"
    assert budget.estimate_tokens(en_text) == max(1, len(en_text) // 4)


def test_token_budget_short_text_returns_one():
    budget = TokenBudget(model_max_tokens=200_000)
    assert budget.estimate_tokens("Hi") == 1
    assert budget.estimate_tokens("") == 1


def test_token_budget_estimate_messages():
    budget = TokenBudget(model_max_tokens=200_000)
    messages = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "Hello world!"},
    ]
    estimated = budget.estimate_messages(messages)
    expected = len("You are helpful.") // 4 + len("Hello world!") // 4
    assert estimated == expected


def test_token_budget_max_input_tokens_with_reserve():
    budget = TokenBudget(model_max_tokens=200_000, reserve_ratio=0.15)
    assert budget.max_input_tokens == 170_000


def test_token_budget_fit_under_limit():
    budget = TokenBudget(model_max_tokens=200_000)
    system_msgs = [{"role": "system", "content": "You are helpful."}]
    history = [
        {"role": "user", "content": "Q1"},
        {"role": "assistant", "content": "A1"},
    ]
    new_msg = {"role": "user", "content": "Q2"}
    result = budget.fit_messages(system_msgs, history, new_msg)
    assert len(result) == 4
    assert result[0] == system_msgs[0]
    assert result[-1] == new_msg


def test_token_budget_truncates_head():
    budget = TokenBudget(model_max_tokens=2000)
    system_msgs = [{"role": "system", "content": "Sys"}]
    history = [
        {"role": "user", "content": "A" * 8000},
        {"role": "assistant", "content": "B" * 1000},
        {"role": "user", "content": "C" * 500},
    ]
    new_msg = {"role": "user", "content": "D" * 4000}
    result = budget.fit_messages(system_msgs, history, new_msg)
    assert len(result) < 5
    assert result[0] == system_msgs[0]
    assert result[-1] == new_msg


def test_token_budget_preserves_system():
    budget = TokenBudget(model_max_tokens=100)
    system_msgs = [
        {"role": "system", "content": "System prompt"},
        {"role": "system", "content": "Memory context"},
    ]
    history = [{"role": "user", "content": "A" * 500}]
    new_msg = {"role": "user", "content": "Task"}
    result = budget.fit_messages(system_msgs, history, new_msg)
    assert result[0] == system_msgs[0]
    assert result[1] == system_msgs[1]
    assert result[-1] == new_msg


def test_token_budget_drops_history_when_tight():
    budget = TokenBudget(model_max_tokens=3)
    system_msgs = [{"role": "system", "content": "Sys"}]
    history = [{"role": "user", "content": "Old"}]
    new_msg = {"role": "user", "content": "Task"}
    result = budget.fit_messages(system_msgs, history, new_msg)
    assert len(result) == 2
    assert result[0] == system_msgs[0]
    assert result[1] == new_msg


def test_token_budget_empty_history():
    budget = TokenBudget(model_max_tokens=200_000)
    system_msgs = [{"role": "system", "content": "Sys"}]
    result = budget.fit_messages(system_msgs, [], {"role": "user", "content": "Task"})
    assert len(result) == 2


def test_model_token_limits_has_deepseek():
    assert "deepseek/deepseek-v4-pro" in MODEL_TOKEN_LIMITS
    assert MODEL_TOKEN_LIMITS["deepseek/deepseek-v4-pro"] == 200_000


def test_model_token_limits_has_openai():
    assert "openai/gpt-4o" in MODEL_TOKEN_LIMITS
    assert MODEL_TOKEN_LIMITS["openai/gpt-4o"] == 128_000


def test_model_token_limits_has_anthropic():
    assert "anthropic/claude-sonnet-4-6" in MODEL_TOKEN_LIMITS


def test_model_token_limits_has_ollama():
    assert "ollama/llama3" in MODEL_TOKEN_LIMITS


# ── compact_tool_result ────────────────────────────────────

def test_compact_small_result_returns_as_is():
    content = "short result"
    result, path = compact_tool_result(content, "Bash")
    assert result == content
    assert path is None


def test_compact_large_result_writes_file_and_returns_preview(tmp_path):
    content = "X" * 60_000
    result, path = compact_tool_result(content, "Read", str(tmp_path))

    assert path is not None
    assert result.startswith("X" * TOOL_PREVIEW_CHARS)
    assert "truncated" in result.lower()
    assert str(path) in result

    import os
    assert os.path.exists(path)
    with open(path, encoding="utf-8") as f:
        assert f.read() == content


def test_compact_write_tool_returns_summary_only(tmp_path):
    content = "X" * 60_000
    result, path = compact_tool_result(content, "Write", str(tmp_path))
    assert "Write result" in result
    assert str(len(content)) in result
    assert path is None


def test_compact_edit_tool_returns_summary_only(tmp_path):
    content = "X" * 60_000
    result, path = compact_tool_result(content, "Edit", str(tmp_path))
    assert path is None
    assert str(len(content)) in result


def test_compact_notebook_edit_tool_returns_summary_only(tmp_path):
    content = "X" * 60_000
    result, path = compact_tool_result(content, "NotebookEdit", str(tmp_path))
    assert path is None


def test_compact_at_threshold_returns_as_is():
    content = "Y" * TOOL_RESULT_MAX_CHARS
    result, path = compact_tool_result(content, "Bash")
    assert result == content
    assert path is None
