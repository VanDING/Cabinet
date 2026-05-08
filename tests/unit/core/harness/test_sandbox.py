from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from cabinet.core.harness.sandbox import FileSystemSandbox


@pytest.fixture
def sandbox():
    return FileSystemSandbox()


@pytest.fixture
def temp_dir():
    with tempfile.TemporaryDirectory() as d:
        yield Path(d)


class TestProtectedPaths:
    def test_gitconfig_is_protected(self, sandbox):
        assert sandbox.is_protected(Path.home() / ".gitconfig")

    def test_git_dir_is_protected(self, sandbox, temp_dir):
        git_dir = temp_dir / ".git"
        git_dir.mkdir()
        assert sandbox.is_protected(git_dir)

    def test_dot_env_is_protected(self, sandbox, temp_dir):
        env_file = temp_dir / ".env"
        env_file.touch()
        assert sandbox.is_protected(env_file)

    def test_claude_dir_is_protected(self, sandbox, temp_dir):
        claude_dir = temp_dir / ".claude"
        claude_dir.mkdir()
        assert sandbox.is_protected(claude_dir)

    def test_bashrc_is_protected(self, sandbox, temp_dir):
        bashrc = temp_dir / ".bashrc"
        bashrc.touch()
        assert sandbox.is_protected(bashrc)


class TestSafePaths:
    def test_regular_py_file_is_allowed(self, sandbox, temp_dir):
        py_file = temp_dir / "app.py"
        py_file.touch()
        assert not sandbox.is_protected(py_file)

    def test_src_directory_is_allowed(self, sandbox, temp_dir):
        src = temp_dir / "src"
        src.mkdir()
        assert not sandbox.is_protected(src)

    def test_data_directory_is_allowed(self, sandbox, temp_dir):
        data = temp_dir / "data"
        data.mkdir()
        assert not sandbox.is_protected(data)

    def test_regular_txt_file_is_allowed(self, sandbox, temp_dir):
        txt = temp_dir / "README.md"
        txt.touch()
        assert not sandbox.is_protected(txt)


class TestSymlinkProtection:
    def test_symlink_to_protected_path_is_detected(self, sandbox, temp_dir):
        if os.name == "nt":
            pytest.skip("Symlinks require admin on Windows")
        real_gitconfig = temp_dir / ".gitconfig"
        real_gitconfig.touch()
        symlink = temp_dir / "safe_link"
        symlink.symlink_to(real_gitconfig)
        assert sandbox.is_protected(symlink)


class TestCustomRules:
    def test_can_add_custom_protected_patterns(self, sandbox, temp_dir):
        sandbox.add_protected_pattern("*.secret")
        secret_file = temp_dir / "db.secret"
        secret_file.touch()
        assert sandbox.is_protected(secret_file)

    def test_can_remove_default_patterns(self, sandbox, temp_dir):
        sandbox.remove_protected_pattern(".gitconfig")
        gitconfig = temp_dir / ".gitconfig"
        gitconfig.touch()
        assert not sandbox.is_protected(gitconfig)
