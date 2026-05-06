from unittest.mock import AsyncMock, patch

import pytest

from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
from cabinet.core.gateway.protocol import ModelGateway


def test_gateway_satisfies_protocol():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
    ])
    assert isinstance(gateway, ModelGateway)


@pytest.mark.asyncio
async def test_complete_with_router():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
    ])
    mock_response = AsyncMock()
    mock_response.choices = [AsyncMock()]
    mock_response.choices[0].message.content = "Hello, Captain!"
    mock_response.usage = AsyncMock()
    mock_response.usage.prompt_tokens = 10
    mock_response.usage.completion_tokens = 5

    with patch("litellm.Router.acompletion", return_value=mock_response):
        response = await gateway.complete(
            messages=[{"role": "user", "content": "Hello"}],
            model="default",
        )
    assert response.content == "Hello, Captain!"
    assert response.model == "default"
    assert response.usage["prompt_tokens"] == 10


@pytest.mark.asyncio
async def test_complete_with_temperature():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
    ])
    mock_response = AsyncMock()
    mock_response.choices = [AsyncMock()]
    mock_response.choices[0].message.content = "Creative response"
    mock_response.usage = AsyncMock()
    mock_response.usage.prompt_tokens = 10
    mock_response.usage.completion_tokens = 5

    with patch("litellm.Router.acompletion", return_value=mock_response) as mock_call:
        await gateway.complete(
            messages=[{"role": "user", "content": "Be creative"}],
            model="default",
            temperature=0.9,
        )
        call_kwargs = mock_call.call_args[1]
        assert call_kwargs["temperature"] == 0.9


def test_list_models():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
        {"model_name": "fast", "litellm_params": {"model": "groq/llama3-70b-8192"}},
    ])
    models = gateway.list_models()
    assert len(models) == 2
    names = [m.id for m in models]
    assert "default" in names
    assert "fast" in names


def test_cost_tracking():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
    ])
    assert gateway.total_cost == 0.0


def test_gateway_injects_api_keys_into_model_list():
    model_list = [
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
        {"model_name": "fast", "litellm_params": {"model": "groq/llama3-70b-8192"}},
    ]
    api_keys = {"openai": "sk-test-openai", "groq": "gsk-test-groq"}
    gateway = LiteLLMRouterGateway(model_list=model_list, api_keys=api_keys)
    injected = gateway._model_list
    assert injected[0]["litellm_params"]["api_key"] == "sk-test-openai"
    assert injected[1]["litellm_params"]["api_key"] == "gsk-test-groq"


def test_gateway_without_api_keys():
    model_list = [
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
    ]
    gateway = LiteLLMRouterGateway(model_list=model_list)
    assert "api_key" not in gateway._model_list[0]["litellm_params"]


def test_gateway_api_keys_does_not_override_existing():
    model_list = [
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini", "api_key": "existing-key"}},
    ]
    api_keys = {"openai": "new-key"}
    gateway = LiteLLMRouterGateway(model_list=model_list, api_keys=api_keys)
    assert gateway._model_list[0]["litellm_params"]["api_key"] == "existing-key"


def test_add_model_updates_list_models():
    gateway = LiteLLMRouterGateway(model_list=[])
    gateway.add_model({
        "model_name": "default",
        "litellm_params": {"model": "deepseek/deepseek-v4-flash"},
    })
    models = gateway.list_models()
    assert len(models) == 1
    assert models[0].id == "default"
    assert models[0].provider == "deepseek"


def test_add_model_with_api_key():
    gateway = LiteLLMRouterGateway(model_list=[])
    gateway.add_model(
        {"model_name": "default", "litellm_params": {"model": "deepseek/deepseek-v4-flash"}},
        api_key="sk-test-key",
    )
    assert gateway._model_list[0]["litellm_params"]["api_key"] == "sk-test-key"


def test_add_model_does_not_override_existing_api_key():
    gateway = LiteLLMRouterGateway(model_list=[])
    gateway.add_model(
        {
            "model_name": "default",
            "litellm_params": {"model": "deepseek/deepseek-v4-flash", "api_key": "existing"},
        },
        api_key="new-key",
    )
    assert gateway._model_list[0]["litellm_params"]["api_key"] == "existing"


def test_remove_model_success():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "deepseek/deepseek-v4-flash"}},
        {"model_name": "fast", "litellm_params": {"model": "groq/llama3-70b-8192"}},
    ])
    result = gateway.remove_model("default")
    assert result is True
    assert len(gateway.list_models()) == 1
    assert gateway.list_models()[0].id == "fast"


def test_remove_model_not_found():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "deepseek/deepseek-v4-flash"}},
    ])
    result = gateway.remove_model("nonexistent")
    assert result is False
    assert len(gateway.list_models()) == 1


def test_replace_model_updates_existing():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
    ])
    gateway.replace_model("default", {
        "model_name": "default",
        "litellm_params": {"model": "deepseek/deepseek-v4-flash"},
    })
    models = gateway.list_models()
    assert len(models) == 1
    assert models[0].provider == "deepseek"


def test_replace_model_appends_if_not_found():
    gateway = LiteLLMRouterGateway(model_list=[
        {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
    ])
    gateway.replace_model("reasoning", {
        "model_name": "reasoning",
        "litellm_params": {"model": "deepseek/deepseek-v4-pro"},
    })
    models = gateway.list_models()
    assert len(models) == 2
    ids = [m.id for m in models]
    assert "default" in ids
    assert "reasoning" in ids


def test_replace_model_with_api_key():
    gateway = LiteLLMRouterGateway(model_list=[])
    gateway.replace_model(
        "default",
        {"model_name": "default", "litellm_params": {"model": "deepseek/deepseek-v4-flash"}},
        api_key="sk-test",
    )
    assert gateway._model_list[0]["litellm_params"]["api_key"] == "sk-test"


@pytest.mark.asyncio
async def test_stream_records_error_on_exception():
    gateway = LiteLLMRouterGateway(model_list=[{
        "model_name": "test",
        "litellm_params": {"model": "openai/test"},
    }])

    async def failing_stream():
        raise RuntimeError("stream error")
        yield

    with patch.object(gateway._router, "acompletion", return_value=failing_stream()):
        with pytest.raises(RuntimeError, match="stream error"):
            chunks = []
            async for chunk in gateway.stream([], "test"):
                chunks.append(chunk)


def test_gateway_cache_disabled_by_default():
    gateway = LiteLLMRouterGateway(model_list=[{
        "model_name": "test", "litellm_params": {"model": "openai/test"},
    }])
    assert gateway._enable_cache is False


def test_gateway_cache_can_be_enabled():
    gateway = LiteLLMRouterGateway(
        model_list=[{"model_name": "test", "litellm_params": {"model": "openai/test"}}],
        enable_cache=True, cache_ttl=60,
    )
    assert gateway._enable_cache is True
    assert gateway._cache_ttl == 60
