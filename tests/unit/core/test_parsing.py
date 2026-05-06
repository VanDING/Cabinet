from cabinet.core.parsing import (
    AuditOutput,
    AuthorizationCheckResult,
    BlueprintOutput,
    BlueprintValidationResult,
    CascadeOutput,
    DecisionTreeOutput,
    InsightsOutput,
    PermissionCheckResult,
    SuggestionsOutput,
    TreeNode,
    extract_json_block,
    parse_llm_json,
)


def test_extract_json_block_from_code_fence():
    content = 'Here is the result:\n```json\n{"auto_process": true, "reason": "ok"}\n```\nDone.'
    result = extract_json_block(content)
    assert '"auto_process"' in result


def test_extract_json_block_bare_object():
    content = 'Result: {"auto_process": false, "reason": "needs captain"}'
    result = extract_json_block(content)
    assert '"auto_process"' in result


def test_extract_json_block_bare_array():
    content = 'Titles:\n["title1", "title2"]'
    result = extract_json_block(content)
    assert '"title1"' in result


def test_extract_json_block_no_json():
    import pytest
    with pytest.raises(ValueError, match="No JSON found"):
        extract_json_block("Just plain text, no JSON here.")


def test_parse_llm_json_success():
    content = '```json\n{"auto_process": true, "reason": "safe"}\n```'
    result = parse_llm_json(content, AuthorizationCheckResult)
    assert result is not None
    assert result.auto_process is True
    assert result.reason == "safe"


def test_parse_llm_json_fallback_on_failure():
    result = parse_llm_json("No JSON here at all", AuthorizationCheckResult)
    assert result is None


def test_authorization_check_result():
    result = AuthorizationCheckResult(auto_process=False, reason="needs captain")
    assert result.auto_process is False


def test_cascade_output():
    result = CascadeOutput(titles=["title1", "title2"])
    assert len(result.titles) == 2


def test_permission_check_result():
    result = PermissionCheckResult(allowed=True, level="L2")
    assert result.level == "L2"


def test_blueprint_validation_result():
    result = BlueprintValidationResult(is_valid=True, notes=["ok"])
    assert result.is_valid is True


def test_blueprint_output():
    result = BlueprintOutput(domains=["tech"], constraints=["budget"], criteria=["revenue"])
    assert len(result.domains) == 1


def test_insights_output():
    from cabinet.core.parsing import InsightItem
    result = InsightsOutput(insights=[InsightItem(content="test", insight_type="observation", confidence=0.8)])
    assert result.insights[0].confidence == 0.8


def test_decision_tree_output():
    result = DecisionTreeOutput(root_label="root", children=[TreeNode(label="child1")])
    assert len(result.children) == 1


def test_suggestions_output():
    from cabinet.core.parsing import SuggestionItem
    result = SuggestionsOutput(suggestions=[SuggestionItem(description="fix", category="workflow", impact="high")])
    assert result.suggestions[0].impact == "high"


def test_audit_output():
    result = AuditOutput(total_decisions=10, manually_approved=3, could_auto_process=7, suggestion="add rules")
    assert result.total_decisions == 10
