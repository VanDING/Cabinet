from rich.style import Style

from cabinet.cli.tui_themes import (
    CABINET_BLUE,
    CABINET_RED,
    CABINET_YELLOW,
    CABINET_LOGO,
    STYLE_BLUE_BOLD,
    STYLE_RED_BOLD,
    STYLE_YELLOW_BOLD,
    STYLE_DEFAULT,
    STYLE_DIM,
    STYLE_BLUE,
)


def test_color_constants():
    assert CABINET_BLUE == "#081D60"
    assert CABINET_RED == "#CB220C"
    assert CABINET_YELLOW == "#EDB61B"


def test_style_objects():
    assert STYLE_BLUE_BOLD == Style(color="#081D60", bold=True)
    assert STYLE_RED_BOLD == Style(color="#CB220C", bold=True)
    assert STYLE_YELLOW_BOLD == Style(color="#EDB61B", bold=True)
    assert STYLE_DEFAULT == Style(color="white")
    assert STYLE_DIM == Style(color="grey62", dim=True)
    assert STYLE_BLUE == Style(color="#081D60")


def test_logo_contains_color_blocks():
    assert "#CB220C" in CABINET_LOGO
    assert "#EDB61B" in CABINET_LOGO
    assert "#081D60" in CABINET_LOGO


def test_logo_contains_ascii_art():
    assert "██████╗" in CABINET_LOGO
    assert "╚═════╝" in CABINET_LOGO


def test_logo_is_non_empty_string():
    assert isinstance(CABINET_LOGO, str)
    assert len(CABINET_LOGO.strip()) > 0
