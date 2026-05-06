import sys
from unittest.mock import MagicMock


class _MockRouter:
    def __init__(self, **kwargs):
        self._kwargs = kwargs

    async def acompletion(self, **kwargs):
        raise NotImplementedError("MockRouter.acompletion not patched")


_mock_litellm = MagicMock()
_mock_litellm.Router = _MockRouter
sys.modules.setdefault("litellm", _mock_litellm)
