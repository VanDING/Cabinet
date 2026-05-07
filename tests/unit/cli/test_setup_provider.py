import json
import os
import tempfile

from cabinet.cli.config import CabinetConfig, load_config, save_config
from cabinet.cli.providers import PROVIDER_REGISTRY, build_model_entry
from cabinet.models.primitives import Organization


def test_update_models_json_replaces_existing_alias():
    from cabinet.cli.main import _update_models_json

    with tempfile.TemporaryDirectory() as tmpdir:
        models_path = os.path.join(tmpdir, "models.json")
        initial = [
            {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
            {"model_name": "fast", "litellm_params": {"model": "groq/llama3-70b-8192"}},
        ]
        with open(models_path, "w") as f:
            json.dump(initial, f)

        new_entry = build_model_entry(PROVIDER_REGISTRY["deepseek"], "deepseek-v4-flash")
        _update_models_json(models_path, new_entry, model_alias="default")

        with open(models_path) as f:
            result = json.load(f)
        assert len(result) == 2
        assert result[0]["litellm_params"]["model"] == "deepseek/deepseek-v4-flash"
        assert result[1]["model_name"] == "fast"


def test_update_models_json_appends_new_alias():
    from cabinet.cli.main import _update_models_json

    with tempfile.TemporaryDirectory() as tmpdir:
        models_path = os.path.join(tmpdir, "models.json")
        initial = [
            {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
        ]
        with open(models_path, "w") as f:
            json.dump(initial, f)

        new_entry = build_model_entry(PROVIDER_REGISTRY["deepseek"], "deepseek-v4-pro", model_alias="reasoning")
        _update_models_json(models_path, new_entry, model_alias="reasoning")

        with open(models_path) as f:
            result = json.load(f)
        assert len(result) == 2
        assert result[1]["model_name"] == "reasoning"


def test_update_models_json_idempotent():
    from cabinet.cli.main import _update_models_json

    with tempfile.TemporaryDirectory() as tmpdir:
        models_path = os.path.join(tmpdir, "models.json")
        initial = [
            {"model_name": "default", "litellm_params": {"model": "gpt-4o-mini"}},
        ]
        with open(models_path, "w") as f:
            json.dump(initial, f)

        entry1 = build_model_entry(PROVIDER_REGISTRY["deepseek"], "deepseek-v4-flash")
        _update_models_json(models_path, entry1, model_alias="default")

        entry2 = build_model_entry(PROVIDER_REGISTRY["deepseek"], "deepseek-v4-flash")
        _update_models_json(models_path, entry2, model_alias="default")

        with open(models_path) as f:
            result = json.load(f)
        assert len(result) == 1
        assert result[0]["litellm_params"]["model"] == "deepseek/deepseek-v4-flash"


def _create_test_data_dir(tmpdir):
    data_dir = os.path.join(tmpdir, "data")
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(os.path.join(data_dir, "db"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "vectors"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "knowledge"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "skills"), exist_ok=True)

    org = Organization(name="TestOrg", captain_id="captain")
    from uuid import uuid4
    config = CabinetConfig(organization=org, default_project=uuid4())
    save_config(config, os.path.join(data_dir, "cabinet.json"))

    with open(os.path.join(data_dir, "models.json"), "w") as f:
        json.dump([], f)

    return data_dir


def test_setup_provider_non_interactive_deepseek():
    from typer.testing import CliRunner
    from cabinet.cli.main import app

    runner = CliRunner()

    with tempfile.TemporaryDirectory() as tmpdir:
        data_dir = _create_test_data_dir(tmpdir)

        result = runner.invoke(app, [
            "setup-provider",
            "--provider", "deepseek",
            "--model", "deepseek-v4-flash",
            "--api-key", "sk-test-deepseek-key",
            "--data-dir", data_dir,
        ])

        assert result.exit_code == 0, f"Output: {result.output}"
        assert "DeepSeek" in result.output

        loaded = load_config(os.path.join(data_dir, "cabinet.json"))
        assert "deepseek" in loaded.api_keys
        assert loaded.api_keys["deepseek"].startswith("vault:")

        with open(os.path.join(data_dir, "models.json")) as f:
            models = json.load(f)
        assert any(m["litellm_params"]["model"] == "deepseek/deepseek-v4-flash" for m in models)


def test_setup_provider_non_interactive_qwen():
    from typer.testing import CliRunner
    from cabinet.cli.main import app

    runner = CliRunner()

    with tempfile.TemporaryDirectory() as tmpdir:
        data_dir = _create_test_data_dir(tmpdir)

        result = runner.invoke(app, [
            "setup-provider",
            "--provider", "qwen",
            "--model", "qwen3-plus",
            "--api-key", "sk-test-dashscope-key",
            "--data-dir", data_dir,
        ])

        assert result.exit_code == 0, f"Output: {result.output}"

        with open(os.path.join(data_dir, "models.json")) as f:
            models = json.load(f)
        assert any(m["litellm_params"]["model"] == "openai/qwen3-plus" for m in models)
        assert any("dashscope.aliyuncs.com" in m["litellm_params"].get("api_base", "") for m in models)


def test_setup_provider_invalid_provider():
    from typer.testing import CliRunner
    from cabinet.cli.main import app

    runner = CliRunner()

    with tempfile.TemporaryDirectory() as tmpdir:
        data_dir = _create_test_data_dir(tmpdir)

        result = runner.invoke(app, [
            "setup-provider",
            "--provider", "nonexistent",
            "--model", "some-model",
            "--api-key", "sk-test",
            "--data-dir", data_dir,
        ])

        assert result.exit_code != 0


def test_setup_provider_not_initialized():
    from typer.testing import CliRunner
    from cabinet.cli.main import app

    runner = CliRunner()

    with tempfile.TemporaryDirectory() as tmpdir:
        data_dir = os.path.join(tmpdir, "nonexistent")

        result = runner.invoke(app, [
            "setup-provider",
            "--provider", "deepseek",
            "--model", "deepseek-v4-flash",
            "--api-key", "sk-test",
            "--data-dir", data_dir,
        ])

        assert result.exit_code != 0
