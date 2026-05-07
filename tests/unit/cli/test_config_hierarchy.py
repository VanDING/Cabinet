from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

from cabinet.cli.config import (
    _deep_merge,
    _default_config_dict,
    load_config_hierarchical,
)

PROJECT_ID = str(uuid4())


def test_deep_merge_overrides_scalar():
    base = {"a": 1, "b": 2}
    override = {"b": 3}
    result = _deep_merge(base, override)
    assert result == {"a": 1, "b": 3}


def test_deep_merge_adds_new_keys():
    base = {"a": 1}
    override = {"b": 2}
    result = _deep_merge(base, override)
    assert result == {"a": 1, "b": 2}


def test_deep_merge_nested_dicts():
    base = {"org": {"name": "Base", "size": 5}}
    override = {"org": {"name": "Override"}}
    result = _deep_merge(base, override)
    assert result["org"]["name"] == "Override"
    assert result["org"]["size"] == 5


def test_deep_merge_does_not_mutate_base():
    base = {"a": 1}
    override = {"b": 2}
    _deep_merge(base, override)
    assert base == {"a": 1}


def test_default_config_has_required_keys():
    d = _default_config_dict()
    assert "organization" in d
    assert "memory_type" in d
    assert d["memory_type"] == "sqlite"


def test_load_config_minimal_valid(tmp_path):
    (tmp_path / "cabinet.json").write_text(json.dumps({"default_project": PROJECT_ID}))
    cfg = load_config_hierarchical(str(tmp_path))
    assert str(cfg.default_project) == PROJECT_ID
    assert cfg.memory_type == "sqlite"
    assert cfg.auth_required is False


def test_load_config_project_override(tmp_path):
    (tmp_path / "cabinet.json").write_text(
        json.dumps({"default_project": PROJECT_ID, "memory_type": "chromadb", "auth_required": True})
    )
    cfg = load_config_hierarchical(str(tmp_path))
    assert cfg.memory_type == "chromadb"
    assert cfg.auth_required is True


def test_load_config_local_override(tmp_path):
    (tmp_path / "cabinet.json").write_text(
        json.dumps({"default_project": PROJECT_ID, "memory_type": "chromadb"})
    )
    (tmp_path / "cabinet.local.json").write_text(
        json.dumps({"memory_type": "sqlite"})
    )
    cfg = load_config_hierarchical(str(tmp_path))
    assert cfg.memory_type == "sqlite"


def test_load_config_user_override(tmp_path, monkeypatch):
    user_config = tmp_path / ".cabinet" / "config.json"
    user_config.parent.mkdir(parents=True, exist_ok=True)
    user_config.write_text(json.dumps({"cors_origins": ["http://custom"]}))

    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    (tmp_path / "data").mkdir(parents=True, exist_ok=True)
    (tmp_path / "data" / "cabinet.json").write_text(
        json.dumps({"default_project": PROJECT_ID})
    )

    cfg = load_config_hierarchical(str(tmp_path / "data"))
    assert "http://custom" in cfg.cors_origins
