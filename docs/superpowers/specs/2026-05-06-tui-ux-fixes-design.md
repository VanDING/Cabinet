# TUI UX Fixes Design

**Date**: 2026-05-06
**Status**: Approved
**Scope**: 6 TUI bugs targeted fix — Rich+prompt_toolkit architecture preserved

## Problem Summary

User reported 6 pain points with the `cabinet chat` cockpit TUI:

| # | Issue | Root Cause | Severity |
|---|-------|-----------|----------|
| 1 | Secretary messages don't wrap, overflow screen | `size=1` fixed-height bar + no text wrapping | High |
| 2 | Chat streaming truncates / freezes | Per-chunk full Layout rebuild with `refresh_per_second=1` | High |
| 3 | Blue color too dark to read | `CABINET_BLUE = "#081D60"` on black terminals | Medium |
| 4 | No thinking chain visible | No parsing of `<thinking>` tags or `reasoning_content` | Medium |
| 5 | New blank lines appear at top on mode switch | `Live(vertical_overflow="visible")` doesn't properly overwrite | Medium |
| 6 | Input text invisible while typing | Rich `Live` refresh overwrites prompt_toolkit input area | High |

## Design Decisions

- **Keep Rich+prompt_toolkit architecture** — all bugs are fixable within the current stack
- **No new dependencies** — changes confined to `tui.py`, `tui_components.py`, `tui_themes.py`
- **Event-driven over polling** — remove `_periodic_refresh`; only `live.update()` when state actually changes

---

## Fix 1: Secretary Bar Text Wrapping

**Files**: `tui.py:131`, `tui_components.py:69-79`

**Changes**:
- `secretary_bar` Layout: `size=1` → `size=3` (allow up to 3 rows)
- `render_secretary_bar()`: return `Text` with `overflow="fold"` for automatic wrapping
- Truncate very long messages (>200 chars) with ellipsis to prevent layout breaking

```python
# render_secretary_bar after fix
def render_secretary_bar(message: str, urgent: bool = False) -> Text:
    display = message[:200] + "…" if len(message) > 200 else (message or "Captain，一切正常")
    style = STYLE_BLUE_BOLD if urgent else STYLE_DEFAULT
    return Text.assemble(
        ("📋 秘书：", STYLE_DEFAULT),
        (display, style),
    )
```

---

## Fix 2: Streaming Throttle

**Files**: `tui.py:369-397`

**Changes**:
- Chunk accumulation with 100ms flush interval
- Also flush on sentence-ending punctuation (`.`, `。`, `\n`)
- Final flush after stream exhaustion to guarantee completeness
- Raise `refresh_per_second` from 1 to 10

```python
async def _handle_chat(user_input, state, runtime, live):
    response = await runtime.secretary.process_input_stream(...)
    chunks = []
    last_flush = time.monotonic()
    async for chunk in response.stream:
        chunks.append(chunk)
        now = time.monotonic()
        if now - last_flush > 0.1 or chunk.rstrip().endswith((".", "。", "\n")):
            state.left_content = Markdown("".join(chunks))
            live.update(_build_cockpit_layout(state))
            last_flush = now
    # Final flush
    state.left_content = Markdown("".join(chunks))
    live.update(_build_cockpit_layout(state))
    await response.finalize()
    if hasattr(response, "usage") and response.usage:
        state.token_count += response.usage.get("total_tokens", 0)
```

---

## Fix 3: Color Palette

**Files**: `tui_themes.py`

**Changes**:
- `CABINET_BLUE`: `#081D60` → `#3B82F6` (Tailwind blue-500, contrast ratio ~4.6:1 on black)
- `STYLE_DEFAULT`: `white` → `#E2E8F0` (slate-200, softer on eyes)
- `STYLE_DIM`: `grey62 dim` → `#64748B dim` (slate-500)
- Add `STYLE_SUCCESS = Style(color="#22C55E")` for success messages

`CABINET_RED` and `CABINET_YELLOW` unchanged — they already have adequate contrast.

---

## Fix 4: Thinking Chain Display

**Files**: `tui.py` (parsing), `tui_components.py` (rendering)

**Changes**:
- Parse `<thinking>...</thinking>` XML tags from stream chunks
- Detect `reasoning_content` field in chunk objects (DeepSeek/OpenAI compatible)
- New `render_thinking_block(thoughts: list[str], expanded: bool) -> Panel` component
- Default: collapsed, showing "💭 思考中... (N steps, Ctrl+T to expand)"
- `Ctrl+T` keybinding toggles expand/collapse
- After stream completes, auto-collapse with summary

**State additions to `CockpitState`**:
```python
thinking_steps: list[str] = field(default_factory=list)
thinking_expanded: bool = False
```

**Edge cases to handle**:
- `<thinking>` tag spans multiple chunks → buffer partial content until `</thinking>` found
- Stream ends with unclosed `<thinking>` tag → auto-close and render whatever was buffered
- No thinking content → `render_thinking_block` returns empty `Text("")`, no panel shown

---

## Fix 5: Screen Flicker / Extra Lines

**Files**: `tui.py:427`

**Changes**:
- `Live(screen=True)` — use alternate screen buffer (like `less` or `vim`)
- On exit, terminal state is automatically restored
- Remove `_periodic_refresh()` entirely — no polling, only event-driven updates
- `live.update()` called only when state actually changes (after input handling, after stream flush)

---

## Fix 6: Input Text Visibility

**Files**: `tui.py:427-435`, `tui_themes.py`

**Changes**:
- `PromptSession` gets explicit `style` parameter setting input text to `#FFFFFF` (bright white)
- Before `prompt_async()`: call `live.stop()` to pause Rich rendering
- After `prompt_async()` returns: call `live.start()` to resume
- Prompt color uses new `#3B82F6` (visible blue)

```python
INPUT_STYLE = Style.from_dict({
    "": "#ffffff",           # user input text
    "prompt": "#3B82F6 bold", # prompt text (decision >)
})

# In run_cockpit:
live.stop()
try:
    user_input = await session.prompt_async(
        HTML(f"<b fg='#3B82F6'>{state.mode} &gt;</b> "),
        style=INPUT_STYLE,
    )
finally:
    live.start()
```

---

## Files Changed

| File | Changes | Est. Lines |
|------|---------|------------|
| `src/cabinet/cli/tui.py` | Live(screen=True), streaming throttle, live.stop/start, thinking parse, remove _periodic_refresh, prompt_toolkit style + keybinding | ~80 |
| `src/cabinet/cli/tui_components.py` | Secretary wrap, thinking block renderer | ~35 |
| `src/cabinet/cli/tui_themes.py` | Color palette update + INPUT_STYLE + STYLE_SUCCESS | ~15 |

**Total**: ~130 lines changed across 3 files.

Note: `PromptSession` is already created in `tui.py:415`, so prompt_toolkit style and `Ctrl+T` keybinding changes stay in `tui.py` — no `main.py` changes needed.

## Testing

- Unit tests for `render_secretary_bar` with short/long/overflow messages
- Unit tests for `render_thinking_block` in expanded/collapsed states
- Unit tests for chunk throttle logic (mock async stream)
- Manual verification: `cabinet chat` smoke test — type, send, verify streaming, verify Ctrl+T, verify mode switch
- Color contrast verification on both dark and light terminal backgrounds

## Out of Scope (Future)

- Full Textual framework migration
- Slash command autocomplete
- Scrollback buffer for content panel
- Right panel repurposing (currently shows mostly idle)
