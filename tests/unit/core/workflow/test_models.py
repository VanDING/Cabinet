from uuid import uuid4

from cabinet.models.workflows import RetryPolicy, GraphResult, LoopNode, NodeExecutionRecord, TimelineEvent


def test_retry_policy_defaults():
    policy = RetryPolicy()
    assert policy.max_retries == 3
    assert policy.backoff_base == 1.0
    assert policy.backoff_max == 60.0
    assert policy.retryable_errors == []


def test_retry_policy_custom():
    policy = RetryPolicy(max_retries=5, backoff_base=2.0, backoff_max=120.0, retryable_errors=["TimeoutError"])
    assert policy.max_retries == 5
    assert policy.backoff_base == 2.0
    assert policy.backoff_max == 120.0
    assert "TimeoutError" in policy.retryable_errors


def test_graph_result_completed():
    result = GraphResult(completed=True, output={"x": 1})
    assert result.completed is True
    assert result.output == {"x": 1}
    assert result.paused is False
    assert result.failed is False
    assert result.cancelled is False


def test_graph_result_paused():
    result = GraphResult(paused=True, pause_info={"node_id": "abc"})
    assert result.paused is True
    assert result.pause_info == {"node_id": "abc"}


def test_graph_result_failed():
    result = GraphResult(failed=True, failed_node_id="n1", error="boom")
    assert result.failed is True
    assert result.failed_node_id == "n1"
    assert result.error == "boom"


def test_graph_result_cancelled():
    result = GraphResult(cancelled=True)
    assert result.cancelled is True


def test_loop_node_count_mode():
    node = LoopNode(
        name="count_loop",
        loop_type="count",
        max_iterations=5,
        body_entry_id=uuid4(),
    )
    assert node.loop_type == "count"
    assert node.max_iterations == 5
    assert node.break_on_error is True


def test_loop_node_condition_mode():
    node = LoopNode(
        name="cond_loop",
        loop_type="condition",
        condition_expr="context.retries < 3",
        body_entry_id=uuid4(),
    )
    assert node.loop_type == "condition"
    assert node.condition_expr == "context.retries < 3"


def test_loop_node_iterator_mode():
    node = LoopNode(
        name="iter_loop",
        loop_type="iterator",
        iterator_expr="context.items",
        body_entry_id=uuid4(),
    )
    assert node.loop_type == "iterator"
    assert node.iterator_expr == "context.items"


def test_loop_node_defaults():
    node = LoopNode(body_entry_id=uuid4())
    assert node.loop_type == "count"
    assert node.max_iterations == 100
    assert node.break_on_error is True
    assert node.body_exit_id is None


def test_node_execution_record_defaults():
    record = NodeExecutionRecord(node_id=uuid4(), node_name="test")
    assert record.status == "pending"
    assert record.retry_count == 0
    assert record.started_at is None
    assert record.duration_ms is None


def test_node_execution_record_completed():
    record = NodeExecutionRecord(
        node_id=uuid4(),
        node_name="skill_1",
        status="completed",
        started_at="2026-01-01T00:00:00Z",
        completed_at="2026-01-01T00:00:01Z",
        duration_ms=1000.0,
        output_data={"result": "ok"},
    )
    assert record.status == "completed"
    assert record.duration_ms == 1000.0


def test_timeline_event():
    event = TimelineEvent(event="node_started", node_id="abc", timestamp="2026-01-01T00:00:00Z")
    assert event.event == "node_started"
    assert event.node_id == "abc"


def test_timeline_event_with_details():
    event = TimelineEvent(
        event="node_failed",
        node_id="abc",
        timestamp="2026-01-01T00:00:00Z",
        details={"error": "timeout"},
    )
    assert event.details == {"error": "timeout"}
