from __future__ import annotations

import json
import logging
from uuid import UUID

import aiosqlite

from cabinet.rooms.office.models import WorkflowExecution

logger = logging.getLogger(__name__)


class WorkflowExecutionStore:
    def __init__(self, db: aiosqlite.Connection):
        self._db = db

    async def save(self, execution: WorkflowExecution) -> None:
        row = await self._db.execute(
            "SELECT id FROM workflow_executions WHERE id = ?",
            (str(execution.id),),
        )
        existing = await row.fetchone()
        if existing:
            await self._db.execute(
                """
                UPDATE workflow_executions
                SET workflow_id = ?, project_id = ?, status = ?, current_node_id = ?,
                    completed_nodes = ?, results = ?, gate_results = ?
                WHERE id = ?
                """,
                (
                    str(execution.workflow_id),
                    str(execution.project_id),
                    execution.status,
                    str(execution.current_node_id) if execution.current_node_id else None,
                    json.dumps([str(n) for n in execution.completed_nodes]),
                    json.dumps(execution.results),
                    json.dumps({k: v.model_dump() for k, v in execution.gate_results.items()}),
                    str(execution.id),
                ),
            )
        else:
            await self._db.execute(
                """
                INSERT INTO workflow_executions
                    (id, workflow_id, project_id, status, current_node_id,
                     completed_nodes, results, gate_results, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(execution.id),
                    str(execution.workflow_id),
                    str(execution.project_id),
                    execution.status,
                    str(execution.current_node_id) if execution.current_node_id else None,
                    json.dumps([str(n) for n in execution.completed_nodes]),
                    json.dumps(execution.results),
                    json.dumps({k: v.model_dump() for k, v in execution.gate_results.items()}),
                    execution.created_at.isoformat(),
                ),
            )
        await self._db.commit()

    async def load(self, execution_id: UUID) -> WorkflowExecution | None:
        cursor = await self._db.execute(
            "SELECT * FROM workflow_executions WHERE id = ?",
            (str(execution_id),),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return self._row_to_execution(row)

    async def list_by_workflow(self, workflow_id: UUID) -> list[WorkflowExecution]:
        cursor = await self._db.execute(
            "SELECT * FROM workflow_executions WHERE workflow_id = ? ORDER BY created_at DESC",
            (str(workflow_id),),
        )
        rows = await cursor.fetchall()
        return [self._row_to_execution(row) for row in rows]

    @staticmethod
    def _row_to_execution(row) -> WorkflowExecution:
        from cabinet.core.harness.models import GateResult
        from datetime import datetime

        gate_results_raw = json.loads(row[7]) if row[7] else {}
        gate_results = {}
        for k, v in gate_results_raw.items():
            if isinstance(v, dict):
                gate_results[k] = GateResult(**v)

        return WorkflowExecution(
            id=UUID(row[0]),
            workflow_id=UUID(row[1]),
            project_id=UUID(row[2]),
            status=row[3],
            current_node_id=UUID(row[4]) if row[4] else None,
            completed_nodes=[UUID(n) for n in json.loads(row[5])] if row[5] else [],
            results=json.loads(row[6]) if row[6] else {},
            gate_results=gate_results,
            created_at=datetime.fromisoformat(row[8]) if row[8] else datetime.now(),
        )
