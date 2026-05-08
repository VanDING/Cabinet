from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_PROTECTED_NAMES: set[str] = {
    ".git",
    ".gitconfig",
    ".gitattributes",
    ".gitmodules",
    ".gitignore",
    ".bashrc",
    ".bash_profile",
    ".zshrc",
    ".zprofile",
    ".profile",
    ".env",
    ".envrc",
    ".claude",
    ".vscode",
    ".idea",
    ".mcp.json",
    "credentials.json",
    "keyfile.json",
    "service-account.json",
}

DEFAULT_PROTECTED_PATTERNS: set[str] = {
    "*.pem",
    "*.key",
    "*.pfx",
    "*.p12",
    "*.keystore",
}


class FileSystemSandbox:
    def __init__(
        self,
        protected_names: set[str] | None = None,
        protected_patterns: set[str] | None = None,
    ):
        self._protected_names = set(protected_names or DEFAULT_PROTECTED_NAMES)
        self._protected_patterns = set(protected_patterns or DEFAULT_PROTECTED_PATTERNS)

    def is_protected(self, path: Path) -> bool:
        resolved = path.resolve()

        if self._matches_name(resolved):
            return True

        if self._matches_pattern(resolved):
            return True

        if self._is_inside_protected_dir(resolved):
            return True

        return False

    def _matches_name(self, path: Path) -> bool:
        return path.name in self._protected_names

    def _matches_pattern(self, path: Path) -> bool:
        from fnmatch import fnmatch

        name = path.name
        for pattern in self._protected_patterns:
            if fnmatch(name, pattern):
                return True
        return False

    def _is_inside_protected_dir(self, path: Path) -> bool:
        parts = path.parts
        for name in self._protected_names:
            if name in parts and name.startswith("."):
                return True
        return False

    def add_protected_pattern(self, pattern: str) -> None:
        self._protected_patterns.add(pattern)
        logger.info("Added protected pattern: %s", pattern)

    def remove_protected_pattern(self, pattern: str) -> None:
        self._protected_patterns.discard(pattern)
        self._protected_names.discard(pattern)
        logger.info("Removed protected pattern: %s", pattern)

    @property
    def protected_paths(self) -> list[str]:
        return sorted(self._protected_names | self._protected_patterns)
