from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from cabinet.core.auth import Role
from cabinet.core.observability import ObservabilityConfig
from cabinet.models.primitives import Organization


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ApiTokenEntry(BaseModel):
    token_hash: str
    role: Role = Role.VIEWER
    label: str = ""


class MCPServerConfig(BaseModel):
    name: str = Field(..., min_length=1)
    transport: Literal["stdio", "sse"] = "stdio"
    command: str = Field(..., min_length=1)
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    url: str = ""


class CabinetConfig(BaseModel):
    organization: Organization
    default_project: UUID
    model_config_path: str = "data/models.json"
    mcp_servers: list[MCPServerConfig] = []
    api_keys: dict[str, str] = {}
    api_token: str = ""
    api_tokens: list[ApiTokenEntry] = []
    auth_required: bool = False
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:8000"]
    memory_type: Literal["chromadb", "sqlite"] = "chromadb"
    employees_path: str = "data/employees.json"
    skills_dir: str = "data/skills"
    knowledge_dir: str = "data/knowledge"
    created_at: datetime = Field(default_factory=_now)
    observability: ObservabilityConfig = Field(default_factory=ObservabilityConfig)
    vault_enabled: bool = False


def save_config(config: CabinetConfig, path: str = "data/cabinet.json") -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(config.model_dump_json(indent=2))


def _deep_merge(base: dict, override: dict) -> dict:
    result = dict(base)
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def _default_config_dict() -> dict:
    return {
        "organization": {"name": "Default Org", "captain_id": ""},
        "default_project": None,
        "memory_type": "sqlite",
        "auth_required": False,
        "model_config_path": "data/models.json",
        "employees_path": "data/employees.json",
        "skills_dir": "data/skills",
        "mcp_servers": [],
        "api_keys": {},
        "api_tokens": [],
        "cors_origins": ["*"],
        "observability": {"enabled": True, "log_level": "INFO", "log_format": "text"},
    }


def load_config_hierarchical(data_dir: str) -> CabinetConfig:
    config_dict: dict = _default_config_dict()

    user_config = Path.home() / ".cabinet" / "config.json"
    if user_config.exists():
        config_dict = _deep_merge(config_dict, json.loads(user_config.read_text()))

    project_config = Path(data_dir) / "cabinet.json"
    if project_config.exists():
        config_dict = _deep_merge(config_dict, json.loads(project_config.read_text()))

    local_config = Path(data_dir) / "cabinet.local.json"
    if local_config.exists():
        config_dict = _deep_merge(config_dict, json.loads(local_config.read_text()))

    config_dict = {k: v for k, v in config_dict.items() if v is not None}
    return CabinetConfig.model_validate(config_dict)


def load_config(path: str = "data/cabinet.json") -> CabinetConfig:
    if not Path(path).exists():
        raise FileNotFoundError(
            f"Configuration file not found: {path}. "
            f"Please run 'cabinet init' first to create a new organization."
        )
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid configuration in {path}: {e}") from e
    try:
        return CabinetConfig.model_validate(data)
    except Exception as e:
        raise ValueError(f"Invalid configuration in {path}: {e}") from e
