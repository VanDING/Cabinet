from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter()


class ExecuteWorkflowRequest(BaseModel):
    workflow_id: UUID
    inputs: dict = {}


class ResumeWorkflowRequest(BaseModel):
    decision_result: dict = {}


class CancelWorkflowRequest(BaseModel):
    reason: str | None = None


@router.post("/execute")
async def execute_workflow(request: ExecuteWorkflowRequest, req: Request):
    runtime = req.app.state.runtime
    office = runtime.office
    execution = await office.execute_workflow(request.workflow_id, request.inputs)
    return execution.model_dump(mode="json")


@router.post("/{execution_id}/resume")
async def resume_workflow(execution_id: UUID, request: ResumeWorkflowRequest, req: Request):
    runtime = req.app.state.runtime
    office = runtime.office
    execution = await office.resume_workflow(execution_id, request.decision_result)
    return execution.model_dump(mode="json")


@router.post("/{execution_id}/cancel")
async def cancel_workflow(execution_id: UUID, request: CancelWorkflowRequest, req: Request):
    runtime = req.app.state.runtime
    office = runtime.office
    execution = await office.cancel_workflow(execution_id, request.reason)
    return execution.model_dump(mode="json")


@router.get("/{execution_id}")
async def get_workflow_execution(execution_id: UUID, req: Request):
    runtime = req.app.state.runtime
    office = runtime.office
    if execution_id not in office._executions:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=404, content={"error": "Execution not found"})
    return office._executions[execution_id].model_dump(mode="json")
