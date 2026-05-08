"""DEPRECATED: CockpitState has been migrated to textual.reactive on CockpitScreen.

Import CockpitScreen directly:
    from cabinet.cli.screens.cockpit import CockpitScreen

Or access reactive attributes directly on the screen instance.
"""

from __future__ import annotations

# Backward-compat: re-export CockpitScreen
from cabinet.cli.screens.cockpit import CockpitScreen as _CockpitScreen  # noqa: F401
