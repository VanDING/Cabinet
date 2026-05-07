#!/usr/bin/env python3
"""Memory profiling: measure allocations during event store operations."""

from __future__ import annotations

import asyncio
import os
import tempfile
import tracemalloc
from uuid import uuid4

from cabinet.core.events.migrations import MigrationRunner
from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema
from cabinet.core.events.sqlite_store import SqliteEventStore
from cabinet.models.events import MessageEnvelope


async def _setup_store(db_path: str) -> SqliteEventStore:
    runner = MigrationRunner(db_path, [V001InitialSchema()])
    await runner.initialize()
    await runner.run_pending()
    await runner.close()
    store = SqliteEventStore(db_path)
    await store.initialize()
    return store


async def profile_event_append(count: int = 2000):
    """Profile memory during event append workload."""
    tracemalloc.start()

    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "bench.db")
        store = await _setup_store(db_path)

        snapshot_before = tracemalloc.take_snapshot()

        for i in range(count):
            envelope = MessageEnvelope(
                message_id=uuid4(),
                correlation_id=uuid4(),
                causation_id=uuid4(),
                sender="bench",
                recipients=["test"],
                message_type="bench.event",
                payload={"index": i, "data": "x" * 100},
            )
            await store.append(envelope)

        snapshot_after = tracemalloc.take_snapshot()
        await store.close()

    tracemalloc.stop()

    stats = snapshot_after.compare_to(snapshot_before, "lineno")
    top = stats[:10]

    print(f"\n=== Memory Profile: {count} event appends ===\n")
    print(f"{'Allocations':>12} {'Size':>10} {'File:Line'}")
    print("-" * 60)
    for stat in top:
        print(f"{stat.count_diff:>12,} {stat.size_diff:>10,} {stat.traceback.format()[0] if stat.traceback else '?'}")

    total_diff = sum(s.size_diff for s in stats)
    print(f"\nTotal allocated: {total_diff / 1024:.1f} KB")
    print(f"Per event: {total_diff / count / 1024:.2f} KB")

    return total_diff


async def main():
    print("=== Cabinet Memory Profiling ===\n")
    print("Warming up tracemalloc...")
    tracemalloc.start()
    await asyncio.sleep(0.1)
    tracemalloc.stop()

    total = await profile_event_append(2000)

    leak_kb = total / 1024
    if leak_kb < 500:
        print(f"\nRESULT: OK — {leak_kb:.0f}KB allocated, <500KB threshold")
    else:
        print(f"\nRESULT: NEEDS INVESTIGATION — {leak_kb:.0f}KB exceeds 500KB threshold")


if __name__ == "__main__":
    asyncio.run(main())
