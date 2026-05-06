from __future__ import annotations

import json
import os

from cabinet.cli.config import load_config
from cabinet.core.knowledge.local_kb import ChromaDBKnowledgeBase
from cabinet.core.memory.vector_store import ChromaDBMemoryStore
from cabinet.runtime import CabinetRuntime


async def setup_runtime(data_dir: str, live: bool = False):
    config = load_config(os.path.join(data_dir, "cabinet.json"))
    db_path = os.path.join(data_dir, "db", "cabinet.db")

    from cabinet.core.security import KeyVault
    master_key_path = os.path.join(data_dir, ".master_key")
    vault = KeyVault(key_file=master_key_path)

    migrated = False
    for provider, key in config.api_keys.items():
        if key.startswith("vault:"):
            decrypted = vault.decrypt(key[6:])
            os.environ.setdefault(f"{provider.upper()}_API_KEY", decrypted)
        else:
            os.environ.setdefault(f"{provider.upper()}_API_KEY", key)
            encrypted = vault.encrypt(key)
            config.api_keys[provider] = f"vault:{encrypted}"
            migrated = True
    if migrated:
        from cabinet.cli.config import save_config
        save_config(config, os.path.join(data_dir, "cabinet.json"))

    if live:
        from cabinet.agents.employee_store import JsonEmployeeStore
        from cabinet.agents.llm_factory import LLMAgentFactory
        from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway

        model_list_path = os.path.join(data_dir, config.model_config_path)
        with open(model_list_path) as f:
            model_list = json.load(f)
        gateway = LiteLLMRouterGateway(model_list=model_list, api_keys=config.api_keys)
        employee_store = JsonEmployeeStore(path=os.path.join(data_dir, config.employees_path))
        await employee_store.initialize()
        agent_factory = LLMAgentFactory(gateway, memory_store=None, employee_store=employee_store)
    else:
        from cabinet.agents.stub_factory import StubAgentFactory

        agent_factory = StubAgentFactory()

    memory_store = ChromaDBMemoryStore(persist_dir=os.path.join(data_dir, "vectors"))
    knowledge_base = ChromaDBKnowledgeBase(persist_dir=os.path.join(data_dir, "vectors"))

    runtime = CabinetRuntime(
        agent_factory=agent_factory,
        db_path=db_path,
        memory_store=memory_store,
        knowledge_base=knowledge_base,
    )
    await runtime.start()
    return runtime, config
