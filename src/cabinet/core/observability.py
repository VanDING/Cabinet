from __future__ import annotations

import json
import logging
import uuid as _uuid

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.sdk.resources import Resource
from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram
from pydantic import BaseModel as _BaseModel


class ObservabilityConfig(_BaseModel):
    enabled: bool = True
    service_name: str = "cabinet"
    log_level: str = "INFO"
    log_format: str = "json"
    otlp_endpoint: str | None = None
    prometheus_port: int = 9090


PROMETHEUS_REGISTRY = CollectorRegistry()

REQUEST_COUNT = Counter(
    "cabinet_http_requests_total",
    "HTTP request count",
    ["method", "endpoint", "status"],
    registry=PROMETHEUS_REGISTRY,
)
REQUEST_LATENCY = Histogram(
    "cabinet_http_request_duration_seconds",
    "HTTP request latency",
    ["method", "endpoint"],
    registry=PROMETHEUS_REGISTRY,
)
LLM_CALL_COUNT = Counter(
    "cabinet_llm_calls_total",
    "LLM call count",
    ["model", "status"],
    registry=PROMETHEUS_REGISTRY,
)
LLM_CALL_LATENCY = Histogram(
    "cabinet_llm_call_duration_seconds",
    "LLM call latency",
    ["model"],
    registry=PROMETHEUS_REGISTRY,
)
LLM_TOKEN_USAGE = Counter(
    "cabinet_llm_tokens_total",
    "LLM token usage",
    ["model", "type"],
    registry=PROMETHEUS_REGISTRY,
)
EVENT_PUBLISHED = Counter(
    "cabinet_events_published_total",
    "Events published",
    ["message_type"],
    registry=PROMETHEUS_REGISTRY,
)
ROOM_OPERATION = Counter(
    "cabinet_room_operations_total",
    "Room operations",
    ["room", "operation"],
    registry=PROMETHEUS_REGISTRY,
)
DB_OPERATION_LATENCY = Histogram(
    "cabinet_db_operation_duration_seconds",
    "DB operation latency",
    ["store", "operation"],
    registry=PROMETHEUS_REGISTRY,
)
VECTOR_OPERATION_LATENCY = Histogram(
    "cabinet_vector_operation_duration_seconds",
    "Vector operation latency",
    ["operation"],
    registry=PROMETHEUS_REGISTRY,
)
ACTIVE_CONNECTIONS = Gauge(
    "cabinet_active_connections",
    "Active WebSocket connections",
    registry=PROMETHEUS_REGISTRY,
)
STARTUP_TIME = Gauge(
    "cabinet_startup_seconds",
    "Runtime startup time in seconds",
    registry=PROMETHEUS_REGISTRY,
)
WORKFLOW_EXECUTION = Histogram(
    "cabinet_workflow_duration_seconds",
    "Workflow execution time",
    registry=PROMETHEUS_REGISTRY,
)


class TraceInjectingFilter(logging.Filter):
    def filter(self, record):
        span = trace.get_current_span()
        ctx = span.get_span_context()
        record.trace_id = format(ctx.trace_id, "032x") if ctx.is_valid else ""
        record.span_id = format(ctx.span_id, "016x") if ctx.is_valid else ""
        if not hasattr(record, "request_id"):
            record.request_id = _cli_request_id
        return True


_cli_request_id: str = ""


def set_cli_request_id() -> str:
    global _cli_request_id
    _cli_request_id = str(_uuid.uuid4())[:8]
    return _cli_request_id


def get_cli_request_id() -> str:
    return _cli_request_id


class JsonFormatter(logging.Formatter):
    def format(self, record):
        log_entry = {
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "trace_id": getattr(record, "trace_id", ""),
            "span_id": getattr(record, "span_id", ""),
            "request_id": getattr(record, "request_id", ""),
        }
        if record.exc_info and record.exc_info[1]:
            log_entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_entry, ensure_ascii=False)


def setup_logging(config: ObservabilityConfig | None = None, level: str = "INFO") -> None:
    if config is None:
        config = ObservabilityConfig(log_level=level)
    root = logging.getLogger()
    root.setLevel(config.log_level)
    handler = logging.StreamHandler()
    if config.log_format == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
                " | trace_id=%(trace_id)s span_id=%(span_id)s request_id=%(request_id)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )
    handler.addFilter(TraceInjectingFilter())
    root.handlers.clear()
    root.addHandler(handler)


def setup_tracing(config: ObservabilityConfig) -> TracerProvider:
    resource = Resource.create({"service.name": config.service_name})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    if config.otlp_endpoint:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

        exporter = OTLPSpanExporter(endpoint=config.otlp_endpoint)
        provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    return provider


def setup_observability(config: ObservabilityConfig) -> None:
    if not config.enabled:
        return
    setup_logging(config)
    setup_tracing(config)


def get_tracer(name: str = "cabinet"):
    return trace.get_tracer(name)


def get_registry() -> CollectorRegistry:
    return PROMETHEUS_REGISTRY
