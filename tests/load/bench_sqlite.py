from __future__ import annotations

import asyncio
import os
import tempfile
import time

from cabinet.core.events.migrations import MigrationRunner
from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema
from cabinet.core.events.sqlite_store import SqliteEventStore
from cabinet.models.events import MessageEnvelope
from uuid import uuid4


async def bench_event_store_append(count: int = 1000) -> float:
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "bench.db")
        runner = MigrationRunner(db_path, [V001InitialSchema()])
        await runner.initialize()
        await runner.run_pending()
        await runner.close()

        store = SqliteEventStore(db_path)
        await store.initialize()

        start = time.monotonic()
        for i in range(count):
            envelope = MessageEnvelope(
                message_id=uuid4(),
                correlation_id=uuid4(),
                causation_id=uuid4(),
                sender="bench",
                recipients=["test"],
                message_type="bench.event",
                payload={"index": i},
            )
            await store.append(envelope)
        elapsed = time.monotonic() - start

        await store.close()
        return elapsed


async def main():
    count = 1000
    elapsed = await bench_event_store_append(count)
    rate = count / elapsed
    print(f"Event store append: {count} events in {elapsed:.2f}s ({rate:.0f} events/s)")


if __name__ == "__main__":
    asyncio.run(main())
