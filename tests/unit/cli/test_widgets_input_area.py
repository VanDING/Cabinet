from cabinet.cli.widgets.input_area import _filter_completions, SLASH_COMMANDS_LIST


def test_slash_commands_list():
    assert "/decision" in SLASH_COMMANDS_LIST
    assert "/meeting" in SLASH_COMMANDS_LIST
    assert "/help" in SLASH_COMMANDS_LIST
    assert len(SLASH_COMMANDS_LIST) >= 10


def test_filter_completions_slash():
    result = _filter_completions("/dec")
    assert "/decision" in result
    assert "/decide" in result


def test_filter_completions_plain_text():
    result = _filter_completions("hello")
    assert len(result) == 0
