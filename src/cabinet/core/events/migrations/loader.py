from __future__ import annotations

import importlib

_MIGRATION_CLASSES = [
    ("v001_initial_schema", "V001InitialSchema"),
    ("v002_add_indexes", "V002AddIndexes"),
    ("v003_memory_fts", "V003MemoryFts"),
    ("v004_workflow_executions", "V004WorkflowExecutions"),
    ("v005_workflow_versions", "V005WorkflowVersions"),
    ("v006_agent_orchestration", "V006AgentOrchestration"),
    ("v007_audit_role", "V007AuditRole"),
]


def load_all_migrations() -> list:
    migrations = []
    for module_name, class_name in _MIGRATION_CLASSES:
        try:
            mod = importlib.import_module(f"cabinet.core.events.migrations.{module_name}")
            cls = getattr(mod, class_name)
            migrations.append(cls())
        except (ImportError, AttributeError):
            pass
    return migrations
