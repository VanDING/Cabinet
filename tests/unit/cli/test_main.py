import json
import os
import tempfile

import pytest
from typer.testing import CliRunner

from cabinet.cli.main import app

runner = CliRunner()


def test_version():
    result = runner.invoke(app, ["version"])
    assert result.exit_code == 0
    assert "Cabinet" in result.output


def test_init_creates_structure():
    with tempfile.TemporaryDirectory() as tmpdir:
        result = runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "TestOrg" in result.output
        assert os.path.exists(os.path.join(tmpdir, "cabinet.json"))
        assert os.path.isdir(os.path.join(tmpdir, "db"))
        assert os.path.isdir(os.path.join(tmpdir, "vectors"))
        assert os.path.isdir(os.path.join(tmpdir, "knowledge"))
        assert os.path.isdir(os.path.join(tmpdir, "skills"))


def test_init_prevents_duplicate():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        assert result.exit_code != 0
        assert "already initialized" in result.output.lower()


def test_status_without_init():
    with tempfile.TemporaryDirectory() as tmpdir:
        result = runner.invoke(app, ["status", "--data-dir", tmpdir])
        assert result.exit_code != 0


def test_help():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "init" in result.output
    assert "status" in result.output
    assert "employee" in result.output
    assert "skill" in result.output
    assert "knowledge" in result.output


@pytest.mark.asyncio
async def test_init_runtime_creates_sqlite_memory_store(tmp_path):
    from unittest.mock import AsyncMock, MagicMock, patch

    from cabinet.cli.config import CabinetConfig, save_config
    from cabinet.models.primitives import Organization, Project

    data_dir = str(tmp_path / "data")
    os.makedirs(os.path.join(data_dir, "db"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "skills"), exist_ok=True)
    org = Organization(name="test", captain_id="cap1")
    project = Project(organization_id=org.id, name="default", description="test")
    org.projects.append(project.id)
    config = CabinetConfig(
        organization=org,
        default_project=project.id,
        memory_type="sqlite",
    )
    save_config(config, os.path.join(data_dir, "cabinet.json"))

    with open(os.path.join(data_dir, "employees.json"), "w") as f:
        f.write("[]")

    mock_gateway = MagicMock()
    mock_skill_store = AsyncMock()
    mock_skill_store.initialize = AsyncMock()

    with patch("cabinet.core.gateway.litellm_adapter.LiteLLMRouterGateway", return_value=mock_gateway), \
         patch("cabinet.core.tools.skill_store.SkillStore", return_value=mock_skill_store), \
         patch("cabinet.agents.employee_store.JsonEmployeeStore") as MockEmployeeStore, \
         patch("cabinet.agents.llm_factory.LLMAgentFactory") as MockAgentFactory, \
         patch("cabinet.core.knowledge.local_kb.ChromaDBKnowledgeBase"):
        MockEmployeeStore.return_value = AsyncMock()
        MockEmployeeStore.return_value.initialize = AsyncMock()
        MockAgentFactory.return_value = MagicMock()

        from cabinet.cli.main import _init_runtime
        runtime, cfg = await _init_runtime(data_dir)
        assert runtime is not None
        from cabinet.core.memory.sqlite_store import SQLiteMemoryStore
        assert isinstance(runtime._memory_store, SQLiteMemoryStore)
        await runtime.stop()


@pytest.mark.asyncio
async def test_init_runtime_creates_chromadb_memory_store(tmp_path):
    from unittest.mock import AsyncMock, MagicMock, patch

    from cabinet.cli.config import CabinetConfig, save_config
    from cabinet.models.primitives import Organization, Project

    data_dir = str(tmp_path / "data")
    os.makedirs(os.path.join(data_dir, "db"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "skills"), exist_ok=True)
    org = Organization(name="test", captain_id="cap1")
    project = Project(organization_id=org.id, name="default", description="test")
    org.projects.append(project.id)
    config = CabinetConfig(
        organization=org,
        default_project=project.id,
        memory_type="chromadb",
    )
    save_config(config, os.path.join(data_dir, "cabinet.json"))

    with open(os.path.join(data_dir, "employees.json"), "w") as f:
        f.write("[]")

    mock_gateway = MagicMock()
    mock_skill_store = AsyncMock()
    mock_skill_store.initialize = AsyncMock()

    with patch("cabinet.core.gateway.litellm_adapter.LiteLLMRouterGateway", return_value=mock_gateway), \
         patch("cabinet.core.tools.skill_store.SkillStore", return_value=mock_skill_store), \
         patch("cabinet.agents.employee_store.JsonEmployeeStore") as MockEmployeeStore, \
         patch("cabinet.agents.llm_factory.LLMAgentFactory") as MockAgentFactory, \
         patch("cabinet.core.knowledge.local_kb.ChromaDBKnowledgeBase"):
        MockEmployeeStore.return_value = AsyncMock()
        MockEmployeeStore.return_value.initialize = AsyncMock()
        MockAgentFactory.return_value = MagicMock()

        from cabinet.cli.main import _init_runtime
        runtime, cfg = await _init_runtime(data_dir)
        assert runtime is not None
        from cabinet.core.memory.vector_store import ChromaDBMemoryStore
        assert isinstance(runtime._memory_store, ChromaDBMemoryStore)
        await runtime.stop()


def test_config_set_key():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, ["config", "set-key", "openai", "sk-test123", "--data-dir", tmpdir])
        assert result.exit_code == 0
        from cabinet.cli.config import load_config
        config = load_config(os.path.join(tmpdir, "cabinet.json"))
        assert config.api_keys["openai"].startswith("vault:")


def test_config_get_key():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        runner.invoke(app, ["config", "set-key", "openai", "sk-test123", "--data-dir", tmpdir])
        result = runner.invoke(app, ["config", "get-key", "openai", "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "vault:" in result.output or "openai" in result.output


def test_config_list_keys():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        runner.invoke(app, ["config", "set-key", "openai", "sk-test123", "--data-dir", tmpdir])
        runner.invoke(app, ["config", "set-key", "groq", "gsk-test456", "--data-dir", tmpdir])
        result = runner.invoke(app, ["config", "list-keys", "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "openai" in result.output
        assert "groq" in result.output


def test_config_get_key_not_found():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, ["config", "get-key", "anthropic", "--data-dir", tmpdir])
        assert result.exit_code != 0


def test_init_creates_models_json():
    with tempfile.TemporaryDirectory() as tmpdir:
        result = runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        assert result.exit_code == 0
        models_path = os.path.join(tmpdir, "models.json")
        assert os.path.exists(models_path)
        with open(models_path) as f:
            data = json.load(f)
        assert any(m["model_name"] == "default" for m in data)


def test_employee_add():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, [
            "employee", "add", "--name", "策略顾问", "--role", "advisor",
            "--data-dir", tmpdir,
        ])
        assert result.exit_code == 0
        assert "策略顾问" in result.output


def test_employee_list():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        runner.invoke(app, [
            "employee", "add", "--name", "顾问A", "--role", "advisor",
            "--data-dir", tmpdir,
        ])
        result = runner.invoke(app, ["employee", "list", "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "顾问A" in result.output


def test_skill_load(tmp_path):
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        skill_file = tmp_path / "test_skill.md"
        skill_file.write_text("\n---\nname: test_skill\ndescription: A test skill\ninput_schema:\n  type: object\noutput_schema:\n  type: object\n---\n\nDo something\n")
        result = runner.invoke(app, ["skill", "load", str(skill_file), "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "test_skill" in result.output


def test_skill_list():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, ["skill", "list", "--data-dir", tmpdir])
        assert result.exit_code == 0


def test_knowledge_index(tmp_path):
    tmpdir = str(tmp_path / "data")
    runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
    doc_file = tmp_path / "doc.md"
    doc_file.write_text("# Test Document\n\nThis is test content for knowledge base.")
    result = runner.invoke(app, ["knowledge", "index", str(doc_file), "--data-dir", tmpdir])
    assert result.exit_code == 0
    assert "indexed" in result.output.lower() or "Indexed" in result.output


def test_knowledge_query_without_data(tmp_path):
    tmpdir = str(tmp_path / "data")
    runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
    result = runner.invoke(app, ["knowledge", "query", "test question", "--data-dir", tmpdir])
    assert result.exit_code == 0


def test_help_shows_employee_and_skill_commands():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "employee" in result.output
    assert "skill" in result.output
    assert "knowledge" in result.output


def test_serve_help_shows_host_and_port():
    result = runner.invoke(app, ["serve", "--help"])
    assert result.exit_code == 0
    assert "--host" in result.output
    assert "--port" in result.output


def test_config_set_key_uses_vault():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, ["config", "set-key", "openai", "sk-test-vault-123", "--data-dir", tmpdir])
        assert result.exit_code == 0
        from cabinet.cli.config import load_config
        config = load_config(os.path.join(tmpdir, "cabinet.json"))
        assert config.api_keys["openai"].startswith("vault:")


def test_config_set_key_shows_deprecation_warning():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, ["config", "set-key", "openai", "sk-test-dep", "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "deprecated" in result.output.lower() or "set-api-key" in result.output


def test_set_api_key_command():
    with tempfile.TemporaryDirectory() as tmpdir:
        runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        result = runner.invoke(app, ["set-api-key", "sk-test-secure", "--provider", "openai", "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "vault" in result.output.lower() or "securely" in result.output.lower()
        from cabinet.cli.config import load_config
        config = load_config(os.path.join(tmpdir, "cabinet.json"))
        assert config.api_keys["openai"].startswith("vault:")


@pytest.mark.asyncio
async def test_init_agent_runtime_returns_none_without_config(tmp_path):
    from cabinet.cli.main import _init_agent_runtime
    result = await _init_agent_runtime(str(tmp_path))
    assert result is None


@pytest.mark.asyncio
async def test_init_runtime_does_not_set_env_vars(tmp_path):
    from unittest.mock import AsyncMock, MagicMock, patch

    from cabinet.cli.config import CabinetConfig, save_config
    from cabinet.models.primitives import Organization, Project

    data_dir = str(tmp_path / "data")
    os.makedirs(os.path.join(data_dir, "db"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "skills"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "vectors"), exist_ok=True)
    org = Organization(name="test", captain_id="cap1")
    project = Project(organization_id=org.id, name="default", description="test")
    org.projects.append(project.id)
    config = CabinetConfig(
        organization=org,
        default_project=project.id,
        api_keys={"openai": "sk-test-key-12345678"},
    )
    save_config(config, os.path.join(data_dir, "cabinet.json"))

    with open(os.path.join(data_dir, "employees.json"), "w") as f:
        f.write("[]")

    mock_gateway = MagicMock()
    mock_skill_store = AsyncMock()
    mock_skill_store.initialize = AsyncMock()

    original_openai = os.environ.get("OPENAI_API_KEY")
    if "OPENAI_API_KEY" in os.environ:
        del os.environ["OPENAI_API_KEY"]

    try:
        with patch("cabinet.core.gateway.litellm_adapter.LiteLLMRouterGateway", return_value=mock_gateway), \
             patch("cabinet.core.tools.skill_store.SkillStore", return_value=mock_skill_store), \
             patch("cabinet.agents.employee_store.JsonEmployeeStore") as MockEmployeeStore, \
             patch("cabinet.agents.llm_factory.LLMAgentFactory") as MockAgentFactory, \
             patch("cabinet.core.knowledge.local_kb.ChromaDBKnowledgeBase"):
            MockEmployeeStore.return_value = AsyncMock()
            MockEmployeeStore.return_value.initialize = AsyncMock()
            MockAgentFactory.return_value = MagicMock()

            from cabinet.cli.main import _init_runtime
            runtime, cfg = await _init_runtime(data_dir)
            assert runtime is not None
            assert "OPENAI_API_KEY" not in os.environ
            await runtime.stop()
    finally:
        if original_openai is not None:
            os.environ["OPENAI_API_KEY"] = original_openai


def test_init_shows_setup_provider_hint():
    with tempfile.TemporaryDirectory() as tmpdir:
        result = runner.invoke(app, ["init", "TestOrg", "--data-dir", tmpdir])
        assert result.exit_code == 0
        assert "setup-provider" in result.output
