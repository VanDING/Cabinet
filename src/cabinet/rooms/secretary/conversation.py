from __future__ import annotations

from typing import TYPE_CHECKING

from cabinet.core.compact import TokenBudget

if TYPE_CHECKING:
    from cabinet.core.memory.protocol import MemoryStore


class ConversationStore:
    def __init__(self, memory_store: MemoryStore, max_turns: int = 20, max_tokens: int = 160_000):
        self._memory_store = memory_store
        self._max_turns = max_turns
        self._token_budget = TokenBudget(model_max_tokens=max_tokens)

    async def get_history(self, captain_id: str) -> list[dict]:
        from uuid import NAMESPACE_DNS, uuid5

        from cabinet.models.primitives import MemoryScope

        captain_uuid = uuid5(NAMESPACE_DNS, captain_id)
        items = await self._memory_store.search(
            str(captain_uuid),
            MemoryScope.SHORT_TERM,
            limit=self._max_turns,
        )
        history: list[dict] = []
        for item in reversed(items):
            user_msg = item.metadata.get("user", "")
            if user_msg:
                history.append({"role": "user", "content": user_msg})
            history.append({"role": "assistant", "content": item.content})
        result = self._token_budget.fit_messages([], history, {"role": "user", "content": ""})
        return result[:-1]

    async def add_turn(self, captain_id: str, user_msg: str, assistant_msg: str) -> None:
        from uuid import NAMESPACE_DNS, uuid4, uuid5

        from cabinet.models.primitives import MemoryItem, MemoryScope

        captain_uuid = uuid5(NAMESPACE_DNS, captain_id)
        await self._memory_store.store(
            f"conv:{uuid4()}",
            MemoryItem(
                owner_id=captain_uuid,
                content=assistant_msg,
                scope=MemoryScope.SHORT_TERM,
                metadata={"captain_id": captain_id, "user": user_msg, "type": "conversation"},
            ),
            MemoryScope.SHORT_TERM,
        )
