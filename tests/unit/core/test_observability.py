from __future__ import annotations

import json
import logging


def test_observability_config_defaults():
    from cabinet.core.observability import ObservabilityConfig

    config = ObservabilityConfig()
    assert config.enabled is True
    assert config.service_name == "cabinet"
    assert config.log_level == "INFO"
    assert config.log_format == "json"
    assert config.otlp_endpoint is None
    assert config.prometheus_port == 9090


def test_setup_logging_json_format():
    from cabinet.core.observability import ObservabilityConfig, setup_logging

    config = ObservabilityConfig(log_format="json", log_level="DEBUG")
    setup_logging(config)
    root = logging.getLogger()
    assert root.level == logging.DEBUG
    handler = root.handlers[0]
    from cabinet.core.observability import JsonFormatter

    assert isinstance(handler.formatter, JsonFormatter)


def test_setup_logging_text_format():
    from cabinet.core.observability import ObservabilityConfig, JsonFormatter, setup_logging

    config = ObservabilityConfig(log_format="text", log_level="INFO")
    setup_logging(config)
    root = logging.getLogger()
    handler = root.handlers[0]
    assert not isinstance(handler.formatter, JsonFormatter)


def test_setup_logging_backward_compat():
    from cabinet.core.observability import setup_logging

    setup_logging(level="WARNING")
    root = logging.getLogger()
    assert root.level == logging.WARNING


def test_json_formatter_output():
    from cabinet.core.observability import JsonFormatter

    formatter = JsonFormatter()
    record = logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname="",
        lineno=0,
        msg="hello",
        args=(),
        exc_info=None,
    )
    output = formatter.format(record)
    data = json.loads(output)
    assert data["level"] == "INFO"
    assert data["logger"] == "test"
    assert data["message"] == "hello"
    assert "timestamp" in data


def test_trace_injecting_filter():
    from cabinet.core.observability import TraceInjectingFilter

    filt = TraceInjectingFilter()
    record = logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname="",
        lineno=0,
        msg="msg",
        args=(),
        exc_info=None,
    )
    result = filt.filter(record)
    assert result is True
    assert hasattr(record, "trace_id")
    assert hasattr(record, "span_id")


def test_metrics_registered():
    from cabinet.core.observability import (
        REQUEST_COUNT,
        REQUEST_LATENCY,
        LLM_CALL_COUNT,
        LLM_CALL_LATENCY,
        LLM_TOKEN_USAGE,
        EVENT_PUBLISHED,
        ROOM_OPERATION,
        DB_OPERATION_LATENCY,
        VECTOR_OPERATION_LATENCY,
        ACTIVE_CONNECTIONS,
        STARTUP_TIME,
    )

    assert REQUEST_COUNT is not None
    assert REQUEST_LATENCY is not None
    assert LLM_CALL_COUNT is not None
    assert LLM_CALL_LATENCY is not None
    assert LLM_TOKEN_USAGE is not None
    assert EVENT_PUBLISHED is not None
    assert ROOM_OPERATION is not None
    assert DB_OPERATION_LATENCY is not None
    assert VECTOR_OPERATION_LATENCY is not None
    assert ACTIVE_CONNECTIONS is not None
    assert STARTUP_TIME is not None


def test_setup_tracing_creates_provider():
    from cabinet.core.observability import ObservabilityConfig, setup_tracing

    config = ObservabilityConfig()
    provider = setup_tracing(config)
    assert provider is not None


def test_get_tracer():
    from cabinet.core.observability import get_tracer

    tracer = get_tracer("test")
    assert tracer is not None


def test_get_registry():
    from cabinet.core.observability import get_registry

    registry = get_registry()
    assert registry is not None


def test_setup_observability_disabled():
    from cabinet.core.observability import ObservabilityConfig, setup_observability

    config = ObservabilityConfig(enabled=False)
    setup_observability(config)


def test_cli_request_id_contextvar_isolation():
    import asyncio

    from cabinet.core.observability import set_cli_request_id, get_cli_request_id

    async def task_a():
        set_cli_request_id()
        id_a = get_cli_request_id()
        await asyncio.sleep(0.05)
        assert get_cli_request_id() == id_a
        return id_a

    async def task_b():
        set_cli_request_id()
        id_b = get_cli_request_id()
        await asyncio.sleep(0.05)
        assert get_cli_request_id() == id_b
        return id_b

    async def main():
        id_a, id_b = await asyncio.gather(task_a(), task_b())
        assert id_a != id_b

    asyncio.run(main())
