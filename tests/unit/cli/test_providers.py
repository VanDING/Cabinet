from cabinet.cli.providers import (
    PROVIDER_REGISTRY,
    ProviderPreset,
    build_model_entry,
)


def test_provider_preset_is_frozen_dataclass():
    preset = ProviderPreset(
        id="test",
        display_name="Test",
        litellm_prefix="test",
        base_url=None,
        api_key_env="TEST_API_KEY",
        default_model="test-model",
        models=("test-model",),
        is_openai_compatible=False,
    )
    assert preset.id == "test"
    assert preset.models == ("test-model",)


def test_provider_registry_has_five_presets():
    assert len(PROVIDER_REGISTRY) == 5
    expected_ids = {"deepseek", "qwen", "glm", "openai", "anthropic"}
    assert set(PROVIDER_REGISTRY.keys()) == expected_ids


def test_deepseek_preset():
    p = PROVIDER_REGISTRY["deepseek"]
    assert p.litellm_prefix == "deepseek"
    assert p.base_url == "https://api.deepseek.com"
    assert p.api_key_env == "DEEPSEEK_API_KEY"
    assert p.default_model == "deepseek-v4-flash"
    assert p.is_openai_compatible is False


def test_qwen_preset():
    p = PROVIDER_REGISTRY["qwen"]
    assert p.litellm_prefix == "openai"
    assert p.base_url == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert p.api_key_env == "DASHSCOPE_API_KEY"
    assert p.is_openai_compatible is True


def test_glm_preset():
    p = PROVIDER_REGISTRY["glm"]
    assert p.litellm_prefix == "zai"
    assert p.base_url is None
    assert p.api_key_env == "ZAI_API_KEY"
    assert p.is_openai_compatible is False


def test_openai_preset():
    p = PROVIDER_REGISTRY["openai"]
    assert p.litellm_prefix == "openai"
    assert p.base_url == "https://api.openai.com/v1"
    assert p.api_key_env == "OPENAI_API_KEY"


def test_anthropic_preset():
    p = PROVIDER_REGISTRY["anthropic"]
    assert p.litellm_prefix == "anthropic"
    assert p.base_url is None
    assert p.api_key_env == "ANTHROPIC_API_KEY"


def test_build_model_entry_deepseek():
    entry = build_model_entry(PROVIDER_REGISTRY["deepseek"], "deepseek-v4-flash")
    assert entry == {
        "model_name": "default",
        "litellm_params": {
            "model": "deepseek/deepseek-v4-flash",
            "api_base": "https://api.deepseek.com",
        },
    }


def test_build_model_entry_qwen():
    entry = build_model_entry(PROVIDER_REGISTRY["qwen"], "qwen3-plus")
    assert entry["litellm_params"]["model"] == "openai/qwen3-plus"
    assert entry["litellm_params"]["api_base"] == "https://dashscope.aliyuncs.com/compatible-mode/v1"


def test_build_model_entry_glm_no_api_base():
    entry = build_model_entry(PROVIDER_REGISTRY["glm"], "glm-4.5-flash")
    assert entry["litellm_params"]["model"] == "zai/glm-4.5-flash"
    assert "api_base" not in entry["litellm_params"]


def test_build_model_entry_custom_alias():
    entry = build_model_entry(
        PROVIDER_REGISTRY["deepseek"], "deepseek-v4-pro", model_alias="reasoning"
    )
    assert entry["model_name"] == "reasoning"
    assert entry["litellm_params"]["model"] == "deepseek/deepseek-v4-pro"
