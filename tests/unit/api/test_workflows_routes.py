from __future__ import annotations

from uuid import uuid4


async def test_execute_workflow(client):
    response = await client.post("/api/workflows/execute", json={
        "workflow_id": str(uuid4()), "inputs": {},
    })
    assert response.status_code == 200


async def test_resume_workflow(client, mock_runtime):
    exec_id = uuid4()
    response = await client.post(f"/api/workflows/{exec_id}/resume", json={
        "decision_result": {"approved": True},
    })
    assert response.status_code == 200
    mock_runtime.office.resume_workflow.assert_awaited_once()


async def test_cancel_workflow(client, mock_runtime):
    exec_id = uuid4()
    response = await client.post(f"/api/workflows/{exec_id}/cancel", json={
        "reason": "no longer needed",
    })
    assert response.status_code == 200
    mock_runtime.office.cancel_workflow.assert_awaited_once()


async def test_get_workflow_execution_not_found(client, mock_runtime):
    exec_id = uuid4()
    response = await client.get(f"/api/workflows/{exec_id}")
    assert response.status_code == 404
