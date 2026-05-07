from cabinet.cli.intent import detect_intent


def test_detect_intent_meeting():
    result = detect_intent("开个会讨论一下Q3预算")
    assert result is not None
    assert result["type"] == "meeting"
    assert "Q3预算" in result["topic"]


def test_detect_intent_meeting_short():
    result = detect_intent("聊聊新产品规划")
    assert result is not None
    assert result["type"] == "meeting"


def test_detect_intent_task():
    result = detect_intent("提醒我下午3点review代码")
    assert result is not None
    assert result["type"] == "office"


def test_detect_intent_decision():
    result = detect_intent("是否应该延长项目周期")
    assert result is not None
    assert result["type"] == "decision"


def test_detect_intent_no_match():
    result = detect_intent("帮我分析这个数据")
    assert result is None
