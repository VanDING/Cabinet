from cabinet.agents.protocol import AgentFactory
from cabinet.agents.stub_factory import StubAgentFactory


def __getattr__(name: str):
    if name == "LiteLLMAgent":
        from cabinet.agents.llm_agent import LiteLLMAgent
        return LiteLLMAgent
    raise AttributeError(f"module 'cabinet.agents' has no attribute {name!r}")


__all__ = ["LiteLLMAgent", "AgentFactory", "StubAgentFactory"]
