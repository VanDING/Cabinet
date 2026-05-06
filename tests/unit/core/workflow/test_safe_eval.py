from cabinet.core.workflow.safe_eval import safe_eval


def test_safe_eval_arithmetic():
    assert safe_eval("1 + 2", {}) == 3
    assert safe_eval("10 / 3", {}) == 10 / 3


def test_safe_eval_comparison():
    assert safe_eval("x > 0", {"x": 1}) is True
    assert safe_eval("x < 0", {"x": 1}) is False


def test_safe_eval_logical():
    assert safe_eval("x > 0 and y > 0", {"x": 1, "y": 2}) is True
    assert safe_eval("x > 0 or y > 0", {"x": -1, "y": 2}) is True


def test_safe_eval_attribute_access():
    assert safe_eval("context.x", {"context": {"x": 42}}) == 42


def test_safe_eval_subscript():
    assert safe_eval("items[0]", {"items": [10, 20, 30]}) == 10


def test_safe_eval_rejects_function_call():
    assert safe_eval("open('/etc/passwd')", {}) is None


def test_safe_eval_rejects_import():
    assert safe_eval("__import__('os')", {}) is None


def test_safe_eval_invalid_syntax():
    assert safe_eval("!!!invalid", {}) is None


def test_safe_eval_in_operator():
    assert safe_eval("x in items", {"x": 1, "items": [1, 2, 3]}) is True
