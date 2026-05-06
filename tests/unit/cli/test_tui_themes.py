from prompt_toolkit.styles import Style as PromptStyle
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
    STYLE_SUCCESS,
    INPUT_STYLE,
)


def test_color_constants():
    assert CABINET_BLUE == "#3B82F6"
    assert CABINET_RED == "#CB220C"
    assert CABINET_YELLOW == "#EDB61B"


def test_style_objects():
    assert STYLE_BLUE_BOLD == Style(color="#3B82F6", bold=True)
    assert STYLE_RED_BOLD == Style(color="#CB220C", bold=True)
    assert STYLE_YELLOW_BOLD == Style(color="#EDB61B", bold=True)
    assert STYLE_DEFAULT == Style(color="#E2E8F0")
    assert STYLE_DIM == Style(color="#64748B", dim=True)
    assert STYLE_BLUE == Style(color="#3B82F6")


def test_style_success():
    assert STYLE_SUCCESS == Style(color="#22C55E")


def test_input_style():
    assert isinstance(INPUT_STYLE, PromptStyle)
    assert INPUT_STYLE.style_rules == [
        ("", "#ffffff"),
        ("prompt", "#3B82F6 bold"),
    ]


def test_logo_contains_color_blocks():
    assert "#CB220C" in CABINET_LOGO
    assert "#EDB61B" in CABINET_LOGO
    assert "#3B82F6" in CABINET_LOGO


def test_logo_contains_ascii_art():
    assert "██████╗" in CABINET_LOGO
    assert "╚═════╝" in CABINET_LOGO


def test_logo_is_non_empty_string():
    assert isinstance(CABINET_LOGO, str)
    assert len(CABINET_LOGO.strip()) > 0
