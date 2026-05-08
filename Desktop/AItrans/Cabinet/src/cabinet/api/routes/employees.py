from typing import TYPE_CHECKING
from uuid import NAMESPACE_DNS, uuid5

from fastapi import APIRouter, Depends, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from cabinet.api.deps import get_current_user, get_runtime, require_permission
from cabinet.api.models import EmployeeCreate, EmployeeResponse
from cabinet.models.primitives import Employee

if TYPE_CHECKING:
    from cabinet.runtime import CabinetRuntime

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.get("", response_model=list[EmployeeResponse])
@limiter.limit("30/minute")
async def list_employees(
    request: Request,
    runtime: "CabinetRuntime" = Depends(get_runtime),
    _user: dict = Depends(get_current_user),
):
    if runtime.employee_store is None:
        raise HTTPException(status_code=503, detail="Employee store not configured")
    employees = await runtime.employee_store.list_all()
    return [
        EmployeeResponse(
            id=str(e.id),
            name=e.name,
            role=e.role,
            kind=e.kind,
            skills=[str(s) for s in e.skills],
        )
        for e in employees
    ]


@router.post("", response_model=EmployeeResponse)
@limiter.limit("30/minute")
async def create_employee(
    request: Request,
    req: EmployeeCreate,
    runtime: "CabinetRuntime" = Depends(get_runtime),
    _user: dict = Depends(get_current_user),
    _perm: dict = Depends(require_permission("write")),
):
    if runtime.employee_store is None:
        raise HTTPException(status_code=503, detail="Employee store not configured")
    team_id = uuid5(NAMESPACE_DNS, f"team:{req.role}")
    employee = Employee(
        team_id=team_id,
        name=req.name,
        role=req.role,
        kind=req.kind,
        personality=req.personality,
    )
    await runtime.employee_store.add(employee)
    return EmployeeResponse(
        id=str(employee.id),
        name=employee.name,
        role=employee.role,
        kind=employee.kind,
        skills=[],
    )


@router.get("/{employee_id}", response_model=EmployeeResponse)
@limiter.limit("30/minute")
async def get_employee(
    request: Request,
    employee_id: str,
    runtime: "CabinetRuntime" = Depends(get_runtime),
    _user: dict = Depends(get_current_user),
):
    if runtime.employee_store is None:
        raise HTTPException(status_code=503, detail="Employee store not configured")
    from uuid import UUID

    employee = await runtime.employee_store.get(UUID(employee_id))
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    return EmployeeResponse(
        id=str(employee.id),
        name=employee.name,
        role=employee.role,
        kind=employee.kind,
        skills=[str(s) for s in employee.skills],
    )


@router.post("/{employee_id}/skills/{skill_id}")
@limiter.limit("30/minute")
async def mount_skill(
    request: Request,
    employee_id: str,
    skill_id: str,
    runtime: "CabinetRuntime" = Depends(get_runtime),
    _user: dict = Depends(get_current_user),
    _perm: dict = Depends(require_permission("write")),
):
    if runtime.employee_store is None:
        raise HTTPException(status_code=503, detail="Employee store not configured")
    from uuid import UUID

    await runtime.employee_store.mount_skill(UUID(employee_id), UUID(skill_id))
    return {"status": "ok"}
