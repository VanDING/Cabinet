from __future__ import annotations

import json
from pathlib import Path
from uuid import UUID

from cabinet.models.primitives import Employee


class JsonEmployeeStore:
    def __init__(self, path: str = "data/employees.json"):
        self._path = path
        self._employees: dict[UUID, Employee] = {}

    async def initialize(self) -> None:
        p = Path(self._path)
        if p.exists():
            with open(p, encoding="utf-8") as f:
                data = json.load(f)
            for item in data:
                emp = Employee.model_validate(item)
                self._employees[emp.id] = emp
        else:
            p.parent.mkdir(parents=True, exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                json.dump([], f)

    async def add(self, employee: Employee) -> None:
        self._employees[employee.id] = employee
        await self.save()

    async def get(self, employee_id: UUID) -> Employee | None:
        return self._employees.get(employee_id)

    async def list_all(self) -> list[Employee]:
        return list(self._employees.values())

    async def mount_skill(self, employee_id: UUID, skill_id: UUID) -> None:
        emp = self._employees.get(employee_id)
        if emp is None:
            raise KeyError(f"Employee {employee_id} not found")
        self._employees[employee_id] = emp.model_copy(
            update={"skills": [*emp.skills, skill_id]}
        )
        await self.save()

    async def save(self) -> None:
        data = [emp.model_dump(mode="json") for emp in self._employees.values()]
        Path(self._path).parent.mkdir(parents=True, exist_ok=True)
        with open(self._path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
