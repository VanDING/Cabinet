from __future__ import annotations


DEFAULT_MODEL_LIST = [
    {
        "model_name": "default",
        "litellm_params": {
            "model": "deepseek/deepseek-v4-flash",
            "api_base": "https://api.deepseek.com",
            "rpm": 60,
        },
    },
    {
        "model_name": "reasoning",
        "litellm_params": {
            "model": "deepseek/deepseek-v4-pro",
            "api_base": "https://api.deepseek.com",
            "rpm": 30,
        },
    },
    {
        "model_name": "local",
        "litellm_params": {
            "model": "ollama/llama3",
            "api_base": "http://localhost:11434",
        },
    },
]

DEFAULT_FALLBACKS = [{"default": ["local"]}]

DEFAULT_CONTEXT_WINDOW_FALLBACKS = [{"default": ["default"]}]
