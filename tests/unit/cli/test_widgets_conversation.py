from cabinet.cli.widgets.conversation import _render_user_message, _render_assistant_message


def test_render_user_message():
    msg = {"role": "user", "content": "Hello"}
    result = _render_user_message(msg)
    assert result is not None


def test_render_assistant_message():
    msg = {"role": "assistant", "content": "Hi there"}
    result = _render_assistant_message(msg)
    assert result is not None
