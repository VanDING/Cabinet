import os
import subprocess
import sys
import time

from typer.testing import CliRunner

from cabinet.cli.main import app

runner = CliRunner()


def test_init_creates_data_directory(tmp_path):
    data_dir = str(tmp_path / "data")
    result = runner.invoke(
        app,
        ["init", "test-org", "--data-dir", data_dir],
    )
    assert result.exit_code == 0
    assert os.path.exists(os.path.join(data_dir, "cabinet.json"))
    db_path = os.path.join(data_dir, "db", "cabinet.db")
    assert os.path.exists(db_path)


def test_status_shows_initialized(tmp_path):
    data_dir = str(tmp_path / "data")
    runner.invoke(
        app,
        ["init", "test-org", "--data-dir", data_dir],
    )
    result = runner.invoke(app, ["status", "--data-dir", data_dir])
    assert result.exit_code == 0
    assert "test-org" in result.stdout


def test_serve_starts_successfully(tmp_path):
    data_dir = str(tmp_path / "data")
    runner.invoke(
        app,
        ["init", "test-org", "--data-dir", data_dir],
    )
    proc = subprocess.Popen(
        [sys.executable, "-m", "cabinet.cli.main", "serve", "--data-dir", data_dir, "--port", "0"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    time.sleep(2)
    assert proc.poll() is None  # Still running after 2 seconds
    proc.terminate()
    proc.wait()
