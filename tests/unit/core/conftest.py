from __future__ import annotations

import pytest


@pytest.fixture
def tmp_db(tmp_path):
    return str(tmp_path / "test.db")
