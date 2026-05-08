from __future__ import annotations

import logging
import time
from typing import AsyncIterator

from litellm import Router

from cabinet.core.cost_tracker import CostTracker
from cabinet.core.gateway.protocol import ModelChunk, ModelInfo, ModelResponse


logger = logging.getLogger(__name__)

try:
    from cabinet.core.observability import (
        LLM_CALL_COUNT,
        LLM_CALL_LATENCY,
        LLM_TOKEN_USAGE,
        get_tracer,
    )

    _tracer = get_tracer("cabinet.gateway")
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False


class LiteLLMRouterGateway:
    def __init__(
        self,
        model_list: list[dict],
        fallbacks: list[dict] | None = None,
        context_window_fallbacks: list[dict] | None = None,
        num_retries: int = 3,
        timeout: int = 30,
        api_keys: dict[str, str] | None = None,
        enable_cache: bool = False,
        cache_ttl: int = 300,
        cost_tracker: "CostTracker | None" = None,
    ):
        self._api_keys = api_keys or {}
        self._fallbacks = fallbacks or []
        self._context_window_fallbacks = context_window_fallbacks or []
        self._num_retries = num_retries
        self._timeout = timeout
        self._model_list = []
        for entry in model_list:
            entry_copy = {
                "model_name": entry["model_name"],
                "litellm_params": dict(entry["litellm_params"]),
            }
            model_id = entry_copy["litellm_params"]["model"]
            provider = model_id.split("/")[0]
            if provider == model_id:
                provider = "openai"
            if provider in self._api_keys:
                entry_copy["litellm_params"].setdefault("api_key", self._api_keys[provider])
            self._model_list.append(entry_copy)
        self._router = Router(
            model_list=self._model_list,
            fallbacks=self._fallbacks,
            context_window_fallbacks=self._context_window_fallbacks,
            num_retries=self._num_retries,
            timeout=self._timeout,
        )
        self._total_cost = 0.0
        self._enable_cache = enable_cache
        self._cache_ttl = cache_ttl
        self._cache: dict[str, tuple[float, str]] = {}
        self._cost_tracker = cost_tracker

    async def complete(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ) -> ModelResponse:
        start = time.monotonic()
        span = None
        if _OBSERVABILITY_ENABLED:
            span = _tracer.start_span("llm.complete")
            span.set_attribute("llm.model", model)
        if self._enable_cache:
            cache_key = self._cache_key(model, messages, temperature)
            cached = self._get_cached(cache_key)
            if cached is not None:
                return cached
        try:
            response = await self._router.acompletion(
                model=model,
                messages=messages,
                temperature=temperature,
                **kwargs,
            )
            usage = {}
            if response.usage:
                usage = {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                }
            if self._cost_tracker and response.usage:
                self._cost_tracker.record_usage(
                    model=model,
                    prompt_tokens=response.usage.prompt_tokens or 0,
                    completion_tokens=response.usage.completion_tokens or 0,
                    cache_read_tokens=getattr(response.usage, "cache_read_input_tokens", 0) or 0,
                    cache_creation_tokens=getattr(response.usage, "cache_creation_input_tokens", 0) or 0,
                )
            logger.debug("LLM complete: model=%s tokens=%s", model, usage)
            if _OBSERVABILITY_ENABLED:
                duration = time.monotonic() - start
                LLM_CALL_COUNT.labels(model=model, status="success").inc()
                LLM_CALL_LATENCY.labels(model=model).observe(duration)
                if response.usage:
                    LLM_TOKEN_USAGE.labels(model=model, type="prompt").inc(
                        response.usage.prompt_tokens or 0
                    )
                    LLM_TOKEN_USAGE.labels(model=model, type="completion").inc(
                        response.usage.completion_tokens or 0
                    )
                    if span:
                        span.set_attribute("llm.tokens.prompt", response.usage.prompt_tokens or 0)
                        span.set_attribute(
                            "llm.tokens.completion", response.usage.completion_tokens or 0
                        )
            result = ModelResponse(
                content=response.choices[0].message.content,
                model=model,
                usage=usage,
            )
            if self._enable_cache:
                self._set_cache(cache_key, result)
            return result
        except Exception as e:
            if _OBSERVABILITY_ENABLED:
                LLM_CALL_COUNT.labels(model=model, status="error").inc()
                if span:
                    span.set_attribute("error", True)
                    span.set_attribute("error.message", str(e))
            raise
        finally:
            if span:
                span.end()

    async def stream(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ) -> AsyncIterator[ModelChunk]:
        logger.debug("LLM stream start: model=%s", model)
        start = time.monotonic()
        chunk_count = 0
        span = None
        stream_error = None
        if _OBSERVABILITY_ENABLED:
            span = _tracer.start_span("llm.stream")
            span.set_attribute("llm.model", model)
        try:
            async for chunk in await self._router.acompletion(
                model=model,
                messages=messages,
                temperature=temperature,
                stream=True,
                **kwargs,
            ):
                delta = chunk.choices[0].delta
                if delta.content:
                    chunk_count += 1
                    yield ModelChunk(content=delta.content, model=model)
        except Exception as e:
            stream_error = e
            if _OBSERVABILITY_ENABLED:
                LLM_CALL_COUNT.labels(model=model, status="error").inc()
                if span:
                    span.set_attribute("error", True)
                    span.set_attribute("error.message", str(e))
            raise
        finally:
            if _OBSERVABILITY_ENABLED and stream_error is None:
                duration = time.monotonic() - start
                LLM_CALL_COUNT.labels(model=model, status="success").inc()
                LLM_CALL_LATENCY.labels(model=model).observe(duration)
            if _OBSERVABILITY_ENABLED and span:
                span.set_attribute("llm.chunks.count", chunk_count)
            if span:
                span.end()

    def list_models(self) -> list[ModelInfo]:
        seen = set()
        models = []
        for entry in self._model_list:
            name = entry["model_name"]
            if name not in seen:
                seen.add(name)
                provider = entry["litellm_params"]["model"].split("/")[0]
                if provider == entry["litellm_params"]["model"]:
                    provider = "openai"
                models.append(ModelInfo(id=name, provider=provider))
        return models

    def add_model(self, entry: dict, api_key: str | None = None) -> None:
        entry_copy = {
            "model_name": entry["model_name"],
            "litellm_params": dict(entry["litellm_params"]),
        }
        if api_key:
            entry_copy["litellm_params"].setdefault("api_key", api_key)
        self._model_list.append(entry_copy)
        self._rebuild_router()
        self._invalidate_cache()

    def remove_model(self, model_name: str) -> bool:
        original_len = len(self._model_list)
        self._model_list = [
            e for e in self._model_list if e["model_name"] != model_name
        ]
        removed = len(self._model_list) < original_len
        if removed:
            self._rebuild_router()
            self._invalidate_cache()
        return removed

    def replace_model(self, model_name: str, new_entry: dict, api_key: str | None = None) -> None:
        entry_copy = {
            "model_name": new_entry["model_name"],
            "litellm_params": dict(new_entry["litellm_params"]),
        }
        if api_key:
            entry_copy["litellm_params"].setdefault("api_key", api_key)
        replaced = False
        for i, e in enumerate(self._model_list):
            if e["model_name"] == model_name:
                self._model_list[i] = entry_copy
                replaced = True
                break
        if not replaced:
            self._model_list.append(entry_copy)
        self._rebuild_router()
        self._invalidate_cache()

    def _rebuild_router(self) -> None:
        self._router = Router(
            model_list=self._model_list,
            fallbacks=self._fallbacks,
            context_window_fallbacks=self._context_window_fallbacks,
            num_retries=self._num_retries,
            timeout=self._timeout,
        )

    @staticmethod
    def _cache_key(model: str, messages: list[dict], temperature: float) -> str:
        import hashlib
        import json

        data = json.dumps({"model": model, "messages": messages, "temperature": temperature}, sort_keys=True)
        return hashlib.sha256(data.encode()).hexdigest()

    def _get_cached(self, key: str) -> ModelResponse | None:
        entry = self._cache.get(key)
        if entry is None:
            return None
        ts, _ = entry
        if time.monotonic() - ts > self._cache_ttl:
            del self._cache[key]
            return None
        return ModelResponse.model_validate_json(self._cache[key][1])

    def _set_cache(self, key: str, response: ModelResponse) -> None:
        self._cache[key] = (time.monotonic(), response.model_dump_json())

    def _invalidate_cache(self) -> None:
        self._cache.clear()

    @property
    def total_cost(self) -> float:
        return self._total_cost

    @property
    def cost_tracker(self):
        return self._cost_tracker
