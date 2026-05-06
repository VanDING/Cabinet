from __future__ import annotations

import hashlib
import json
import logging
from uuid import UUID

from cabinet.core.workflow.version_store import WorkflowVersionStore

logger = logging.getLogger(__name__)


class CompatibilityChecker:
    def check(self, old_def: dict, new_def: dict) -> dict:
        breaking_changes = []
        old_nodes = {n.get("id"): n for n in old_def.get("nodes", [])}
        new_nodes = {n.get("id"): n for n in new_def.get("nodes", [])}

        removed = set(old_nodes.keys()) - set(new_nodes.keys())
        if removed:
            breaking_changes.append(f"Nodes removed: {removed}")

        for node_id, old_node in old_nodes.items():
            if node_id in new_nodes:
                new_node = new_nodes[node_id]
                if old_node.get("kind") != new_node.get("kind"):
                    breaking_changes.append(f"Node {node_id} kind changed: {old_node.get('kind')} -> {new_node.get('kind')}")

        return {
            "compatible": len(breaking_changes) == 0,
            "breaking_changes": breaking_changes,
        }


class VersionedWorkflowManager:
    def __init__(self, store: WorkflowVersionStore):
        self._store = store

    async def register(self, workflow_id: UUID, definition: str) -> int:
        checksum = hashlib.sha256(definition.encode()).hexdigest()
        if await self._store.checksum_matches(workflow_id, checksum):
            latest = await self._store.get_latest(workflow_id)
            return latest["version"]

        latest = await self._store.get_latest(workflow_id)
        next_version = (latest["version"] + 1) if latest else 1
        await self._store.save(
            workflow_id=workflow_id,
            version=next_version,
            definition=definition,
            checksum=checksum,
        )
        logger.info("Registered workflow %s version %d", workflow_id, next_version)
        return next_version

    async def get_definition(self, workflow_id: UUID, version: int) -> str | None:
        record = await self._store.get_version(workflow_id, version)
        return record["definition"] if record else None

    async def list_versions(self, workflow_id: UUID) -> list[dict]:
        return await self._store.list_versions(workflow_id)

    async def check_compatibility(self, workflow_id: UUID, new_definition: str) -> dict:
        latest = await self._store.get_latest(workflow_id)
        if latest is None:
            return {"compatible": True, "breaking_changes": []}

        checker = CompatibilityChecker()
        old_def = json.loads(latest["definition"])
        new_def = json.loads(new_definition)
        return checker.check(old_def, new_def)
