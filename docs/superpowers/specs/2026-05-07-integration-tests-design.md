# Integration Tests & Test Fixes Design

**Date**: 2026-05-07
**Status**: Approved
**Scope**: Fix 11 pre-existing test failures + add 19 integration tests across 6 files

## Problem Summary

### Pre-existing Failures (11 tests)

| # | File | Count | Root Cause | Fix |
|---|------|-------|-----------|-----|
| 1 | `test_workflows.py` | 2 | `LoopNode` requires `body_entry_id: UUID` but tests don't pass it | Add `body_entry_id=uuid4()` to constructor calls |
| 2 | `test_tui.py` | 9 | `asyncio.get_event_loop().run_until_complete()` broken in Python 3.14 | Replace with `asyncio.run()` |

### New Integration Tests (19 tests, 6 files)

Current: 29 integration tests. Target: 48.

| File | Count | Coverage |
|------|-------|----------|
| `test_api_error_handling.py` | 5 | 400, 404, 405, 500, 413 (payload too large) |
| `test_cross_room_pipeline.py` | 3 | Full meeting→decision→office chain, rejection stops cascade, task data integrity |
| `test_websocket_robust.py` | 3 | Invalid token, missing token, client disconnect |
| `test_cli_e2e.py` | 3 | `cabinet init`, `cabinet status`, `cabinet serve` start |
| `test_backup_edge_cases.py` | 3 | Large data roundtrip, corrupted file error, causality chain after restore |
| `test_agent_orchestration.py` | 2 | Multi-agent handoff, human escalation |

---

## Fix 1: test_workflows.py (2 tests)

**Files**: `tests/unit/models/test_workflows.py`

**Root cause**: `LoopNode` model added `body_entry_id: UUID` (required, no default) during Phase 3 refactoring. Tests were not updated.

**Fix**: Add `body_entry_id=uuid.uuid4()` to the two `LoopNode(...)` calls:
- Line 56: `test_loop_node`
- Line 191: `test_all_node_types_have_id`

---

## Fix 2: test_tui.py asyncio (9 tests)

**Files**: `tests/unit/cli/test_tui.py`

**Root cause**: Python 3.14 removed `asyncio.get_event_loop()` behavior of auto-creating loops. All 9 tests use `asyncio.get_event_loop().run_until_complete(coro)`.

**Fix**: Replace pattern `asyncio.get_event_loop().run_until_complete(some_coro())` with `asyncio.run(some_coro())` in all 9 affected tests.

Affected functions:
- `test_handle_slash_command_mode_switch`
- `test_handle_slash_command_decision`
- `test_handle_slash_command_help`
- `test_handle_slash_command_status`
- `test_handle_slash_command_meeting_with_topic`
- `test_handle_slash_command_decide_with_title`
- `test_handle_slash_command_task_with_desc`
- `test_handle_chat_updates_content`
- `test_handle_chat_thinking_tag_parsing`

---

## New Test 1: test_api_error_handling.py (5 tests)

**Files**: Create `tests/integration/test_api_error_handling.py`

**Infrastructure**: Reuse `tests/unit/api/conftest.py` pattern — `mock_runtime` fixture + `TestClient` from Starlette.

| Test | Method | Endpoint | Expected | Implementation |
|------|--------|----------|----------|----------------|
| `test_400_malformed_json` | POST | `/api/chat` | 400 | Send `content=b"not json"` with `Content-Type: application/json` |
| `test_404_nonexistent_route` | GET | `/api/nonexistent` | 404 | Simple request to unregistered path |
| `test_405_method_not_allowed` | DELETE | `/api/config` | 405 | GET exists but DELETE doesn't |
| `test_500_server_error` | POST | `/api/chat` | 500 | Set `mock_runtime.secretary.process_input.side_effect = Exception("boom")` |
| `test_413_payload_too_large` | POST | `/api/chat` | 413 | Send body >1MB (triggers `input_sanitization_middleware`) |

---

## New Test 2: test_cross_room_pipeline.py (3 tests)

**Files**: Create `tests/integration/test_cross_room_pipeline.py`

**Infrastructure**: Use `CabinetRuntime()` fixture pattern from `test_runtime.py`.

| Test | What It Verifies |
|------|-----------------|
| `test_full_meeting_to_office_chain` | Meeting converges → decision created → decision approved → office task created with correct employee_id. Single coherent scenario covering all 3 rooms. |
| `test_decision_rejection_stops_cascade` | Meeting converges → decision created → decision **rejected** → office task NOT created. Verifies rejection gate. |
| `test_task_data_integrity_across_rooms` | Meeting with topic "Q3 Budget" → decision title matches → office task description contains original context. Verifies data flows correctly. |

---

## New Test 3: test_websocket_robust.py (3 tests)

**Files**: Create `tests/integration/test_websocket_robust.py`

**Infrastructure**: Starlette `TestClient.websocket_connect` (same as existing).

| Test | What It Verifies |
|------|-----------------|
| `test_websocket_invalid_token_rejected` | `?token=bad-token` → close code 4001 |
| `test_websocket_missing_token_rejected` | No `?token=` param when `auth_required=True` → close code 4001 |
| `test_websocket_client_disconnect_clean` | Connect, send one message, `ws.close()` → no server crash, clean termination |

---

## New Test 4: test_cli_e2e.py (3 tests)

**Files**: Create `tests/integration/test_cli_e2e.py`

**Infrastructure**: `typer.testing.CliRunner` + `tmp_path` fixture (pattern from `tests/unit/cli/test_main.py`).

| Test | Command | What It Verifies |
|------|---------|-----------------|
| `test_init_creates_data_directory` | `cabinet init test-org --project test-proj` | Data dir created, `cabinet.json` exists, DB file created |
| `test_status_shows_initialized` | `cabinet status` after init | Output contains project name, no error |
| `test_serve_starts_http` | `cabinet serve --port 0` | Server starts, health endpoint responds 200 |

---

## New Test 5: test_backup_edge_cases.py (3 tests)

**Files**: Create `tests/integration/test_backup_edge_cases.py`

**Infrastructure**: Reuse `backup_env` fixture pattern from `test_backup_restore.py`.

| Test | What It Verifies |
|------|-----------------|
| `test_backup_restore_large_dataset` | Insert 1000 events, backup, restore into fresh DB, verify count matches |
| `test_restore_rejects_corrupted_file` | Create backup, corrupt file (truncate to 50%), call `restore_backup()`, assert `BackupError` raised |
| `test_causality_chain_survives_roundtrip` | Insert 3 causally-linked events, backup, restore, `get_causation_chain()` returns 3 in order |

---

## New Test 6: test_agent_orchestration.py (2 tests)

**Files**: Create `tests/integration/test_agent_orchestration.py`

**Infrastructure**: `CabinetRuntime()` fixture from `test_runtime.py`.

| Test | What It Verifies |
|------|-----------------|
| `test_agent_handoff_delivers_to_mailbox` | Register 2 agents, `handoff_manager.request_handoff(task, from_agent, to_agent)`, assert to_agent's mailbox contains the handoff |
| `test_escalation_on_low_confidence` | Configure `DefaultEscalationProtocol` with confidence threshold, submit low-confidence decision, assert escalation event triggered |

---

## Files Summary

| File | Action | Lines (est.) |
|------|--------|-------------|
| `tests/unit/models/test_workflows.py` | Fix 2 tests | +2 |
| `tests/unit/cli/test_tui.py` | Fix 9 tests | ~18 |
| `tests/integration/test_api_error_handling.py` | Create | ~70 |
| `tests/integration/test_cross_room_pipeline.py` | Create | ~80 |
| `tests/integration/test_websocket_robust.py` | Create | ~60 |
| `tests/integration/test_cli_e2e.py` | Create | ~60 |
| `tests/integration/test_backup_edge_cases.py` | Create | ~75 |
| `tests/integration/test_agent_orchestration.py` | Create | ~65 |

**Total**: ~430 lines, 7 files modified, 6 files created. 966 → 985 tests.
