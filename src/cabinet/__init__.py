try:
    from importlib.metadata import version as _pkg_version

    __version__ = _pkg_version("cabinet")
except Exception:
    __version__ = "0.1.0"


def __getattr__(name: str):
    if name == "CabinetRuntime":
        from cabinet.runtime import CabinetRuntime

        return CabinetRuntime
    if name == "CabinetConfig":
        from cabinet.cli.config import CabinetConfig

        return CabinetConfig
    raise AttributeError(f"module 'cabinet' has no attribute {name!r}")


__all__ = ["CabinetRuntime", "CabinetConfig", "__version__"]
