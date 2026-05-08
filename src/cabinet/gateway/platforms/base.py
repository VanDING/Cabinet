from __future__ import annotations

from abc import ABC, abstractmethod

from cabinet.gateway.models import GatewayMessage, Platform


class BasePlatformAdapter(ABC):
    @property
    @abstractmethod
    def platform(self) -> Platform:
        ...

    @abstractmethod
    async def start(self) -> None:
        ...

    @abstractmethod
    async def stop(self) -> None:
        ...

    @abstractmethod
    async def send_message(self, message: GatewayMessage) -> None:
        ...
