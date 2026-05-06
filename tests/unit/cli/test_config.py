import json
import os
import tempfile
import uuid

import pytest
from pydantic import ValidationError

from cabinet.cli.config import CabinetConfig, load_config, save_config
from cabinet.models.primitives import Organization


def test_cabinet_config_creation():
    org = Organization(name="TestOrg", captain_id="captain-1")
    config = CabinetConfig(organization=org, default_project=uuid.uuid4())
    assert config.organization.name == "TestOrg"
    assert config.model_config_path == "data/models.json"


def test_save_and_load_config():
    org = Organization(name="TestOrg", captain_id="captain-1")
    proj_id = uuid.uuid4()
    config = CabinetConfig(organization=org, default_project=proj_id)

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "cabinet.json")
        save_config(config, path)
        assert os.path.exists(path)

        loaded = load_config(path)
        assert loaded.organization.name == "TestOrg"
        assert loaded.default_project == proj_id


def test_save_config_creates_valid_json():
    org = Organization(name="TestOrg", captain_id="captain-1")
    proj_id = uuid.uuid4()
    config = CabinetConfig(organization=org, default_project=proj_id)

    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "cabinet.json")
        save_config(config, path)

        with open(path) as f:
            data = json.load(f)
        assert data["organization"]["name"] == "TestOrg"


def test_cabinet_config_has_mcp_servers_field():
    org = Organization(name="test", captain_id="cap1")
    config = CabinetConfig(organization=org, default_project=uuid.uuid4())
    assert config.mcp_servers == []


def test_cabinet_config_with_mcp_servers():
    org = Organization(name="test", captain_id="cap1")
    from cabinet.cli.config import MCPServerConfig
    server = MCPServerConfig(name="fs", command="npx", args=["-y", "server-fs"])
    config = CabinetConfig(
        organization=org,
        default_project=uuid.uuid4(),
        mcp_servers=[server],
    )
    assert len(config.mcp_servers) == 1
    assert config.mcp_servers[0].name == "fs"


def test_cabinet_config_roundtrip_with_mcp_servers(tmp_path):
    org = Organization(name="test", captain_id="cap1")
    from cabinet.cli.config import MCPServerConfig
    server = MCPServerConfig(name="fs", command="npx", args=["-y", "server-fs"])
    config = CabinetConfig(
        organization=org,
        default_project=uuid.uuid4(),
        mcp_servers=[server],
    )
    path = str(tmp_path / "config.json")
    save_config(config, path)
    loaded = load_config(path)
    assert len(loaded.mcp_servers) == 1
    assert loaded.mcp_servers[0].name == "fs"


def test_cabinet_config_has_api_keys_field():
    org = Organization(name="test", captain_id="cap1")
    config = CabinetConfig(organization=org, default_project=uuid.uuid4())
    assert config.api_keys == {}


def test_cabinet_config_with_api_keys():
    org = Organization(name="test", captain_id="cap1")
    config = CabinetConfig(
        organization=org,
        default_project=uuid.uuid4(),
        api_keys={"openai": "sk-test123", "groq": "gsk_test456"},
    )
    assert config.api_keys["openai"] == "sk-test123"
    assert config.api_keys["groq"] == "gsk_test456"


def test_cabinet_config_roundtrip_with_api_keys(tmp_path):
    org = Organization(name="test", captain_id="cap1")
    config = CabinetConfig(
        organization=org,
        default_project=uuid.uuid4(),
        api_keys={"openai": "sk-test123"},
    )
    path = str(tmp_path / "config.json")
    save_config(config, path)
    loaded = load_config(path)
    assert loaded.api_keys["openai"] == "sk-test123"


def test_cabinet_config_has_new_paths():
    org = Organization(name="test", captain_id="cap1")
    config = CabinetConfig(organization=org, default_project=uuid.uuid4())
    assert config.employees_path == "data/employees.json"
    assert config.skills_dir == "data/skills"
    assert config.knowledge_dir == "data/knowledge"


def test_cabinet_config_roundtrip_with_new_paths(tmp_path):
    org = Organization(name="test", captain_id="cap1")
    config = CabinetConfig(
        organization=org,
        default_project=uuid.uuid4(),
        employees_path="custom/employees.json",
        skills_dir="custom/skills",
    )
    path = str(tmp_path / "config.json")
    save_config(config, path)
    loaded = load_config(path)
    assert loaded.employees_path == "custom/employees.json"
    assert loaded.skills_dir == "custom/skills"


def test_cabinet_config_memory_type_default():
    org = Organization(name="test", captain_id="cap1")
    config = CabinetConfig(organization=org, default_project=uuid.uuid4())
    assert config.memory_type == "chromadb"


def test_cabinet_config_memory_type_custom():
    org = Organization(name="test", captain_id="cap1")
    config = CabinetConfig(
        organization=org,
        default_project=uuid.uuid4(),
        memory_type="sqlite",
    )
    assert config.memory_type == "sqlite"


def test_cabinet_config_roundtrip_memory_type(tmp_path):
    org = Organization(name="test", captain_id="cap1")
    config = CabinetConfig(
        organization=org,
        default_project=uuid.uuid4(),
        memory_type="sqlite",
    )
    path = str(tmp_path / "config.json")
    save_config(config, path)
    loaded = load_config(path)
    assert loaded.memory_type == "sqlite"


def test_load_config_missing_file():
    with pytest.raises(FileNotFoundError):
        load_config("/nonexistent/path/cabinet.json")


def test_load_config_friendly_error():
    try:
        load_config("/nonexistent/path/cabinet.json")
    except FileNotFoundError as e:
        msg = str(e).lower()
        assert "init" in msg


def test_mcp_server_config_validates():
    from cabinet.cli.config import MCPServerConfig
    config = MCPServerConfig(name="test", transport="stdio", command="echo")
    assert config.name == "test"
    assert config.transport == "stdio"


def test_mcp_server_config_requires_name():
    from cabinet.cli.config import MCPServerConfig
    with pytest.raises(ValidationError):
        MCPServerConfig(transport="stdio", command="echo")


def test_mcp_server_config_requires_command():
    from cabinet.cli.config import MCPServerConfig
    with pytest.raises(ValidationError):
        MCPServerConfig(name="test", transport="stdio")


def test_mcp_server_config_sse_transport():
    from cabinet.cli.config import MCPServerConfig
    config = MCPServerConfig(name="test", transport="sse", command="npx", url="http://localhost:8080")
    assert config.transport == "sse"
    assert config.url == "http://localhost:8080"


def test_cabinet_config_with_mcp_server_config():
    from cabinet.cli.config import MCPServerConfig
    org = Organization(name="test", captain_id="cap1")
    server = MCPServerConfig(name="fs", command="npx", args=["-y", "server-fs"])
    config = CabinetConfig(
        organization=org,
        default_project=uuid.uuid4(),
        mcp_servers=[server],
    )
    assert len(config.mcp_servers) == 1
    assert config.mcp_servers[0].name == "fs"


def test_load_config_invalid_json():
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "bad.json")
        with open(path, "w") as f:
            f.write("not valid json{{{")
        with pytest.raises(ValueError, match="Invalid configuration"):
            load_config(path)
