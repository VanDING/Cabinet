from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderPreset:
    id: str
    display_name: str
    litellm_prefix: str
    base_url: str | None
    api_key_env: str
    default_model: str
    models: tuple[str, ...]
    is_openai_compatible: bool


PROVIDER_REGISTRY: dict[str, ProviderPreset] = {
    "deepseek": ProviderPreset(
        id="deepseek",
        display_name="DeepSeek",
        litellm_prefix="deepseek",
        base_url="https://api.deepseek.com",
        api_key_env="DEEPSEEK_API_KEY",
        default_model="deepseek-v4-flash",
        models=("deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat"),
        is_openai_compatible=False,
    ),
    "qwen": ProviderPreset(
        id="qwen",
        display_name="通义千问 (Qwen)",
        litellm_prefix="openai",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        api_key_env="DASHSCOPE_API_KEY",
        default_model="qwen3-plus",
        models=("qwen3-plus", "qwen3-max", "qwen-plus", "qwen-flash"),
        is_openai_compatible=True,
    ),
    "glm": ProviderPreset(
        id="glm",
        display_name="智谱 GLM",
        litellm_prefix="zai",
        base_url=None,
        api_key_env="ZAI_API_KEY",
        default_model="glm-4.5-flash",
        models=("glm-4.5-flash", "glm-4.7", "glm-4.5-air", "glm-4.5"),
        is_openai_compatible=False,
    ),
    "openai": ProviderPreset(
        id="openai",
        display_name="OpenAI",
        litellm_prefix="openai",
        base_url="https://api.openai.com/v1",
        api_key_env="OPENAI_API_KEY",
        default_model="gpt-4o-mini",
        models=("gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini"),
        is_openai_compatible=False,
    ),
    "anthropic": ProviderPreset(
        id="anthropic",
        display_name="Anthropic",
        litellm_prefix="anthropic",
        base_url=None,
        api_key_env="ANTHROPIC_API_KEY",
        default_model="claude-sonnet-4-20250514",
        models=("claude-sonnet-4-20250514", "claude-haiku-4-5"),
        is_openai_compatible=False,
    ),
}


def build_model_entry(preset: ProviderPreset, model_name: str, model_alias: str = "default") -> dict:
    entry = {
        "model_name": model_alias,
        "litellm_params": {
            "model": f"{preset.litellm_prefix}/{model_name}",
        },
    }
    if preset.base_url:
        entry["litellm_params"]["api_base"] = preset.base_url
    return entry
