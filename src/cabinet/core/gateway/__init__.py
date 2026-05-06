def __getattr__(name: str):
    if name == "LiteLLMRouterGateway":
        from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
        return LiteLLMRouterGateway
    raise AttributeError(f"module 'cabinet.core.gateway' has no attribute {name!r}")


__all__ = ["LiteLLMRouterGateway"]
