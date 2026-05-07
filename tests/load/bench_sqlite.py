from __future__ import annotations

import asyncio
import os
import tempfile
import time
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


async def bench_event_store_append(count: int = 5000) -> dict:
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "bench.db")
        store = await _setup_store(db_path)

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
    return {"name": "Event store append", "n": count, "elapsed": elapsed, "rate": count / elapsed}


async def bench_event_store_read(count: int = 1000) -> dict:
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "bench.db")
        store = await _setup_store(db_path)

        msg_id = uuid4()
        for i in range(count):
            envelope = MessageEnvelope(
                message_id=msg_id if i == 0 else uuid4(),
                correlation_id=uuid4(),
                causation_id=uuid4(),
                sender="bench",
                recipients=["test"],
                message_type="bench.event",
                payload={"index": i},
            )
            await store.append(envelope)

        start = time.monotonic()
        for _ in range(100):
            await store.get(msg_id)
        elapsed = time.monotonic() - start

        await store.close()
    return {"name": "Event store read (100x)", "n": 100, "elapsed": elapsed,
            "avg_ms": (elapsed / 100) * 1000}


async def bench_causation_chain(chain_length: int = 50) -> dict:
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "bench.db")
        store = await _setup_store(db_path)

        root_id = uuid4()
        prev_id = root_id
        for i in range(chain_length):
            envelope = MessageEnvelope(
                message_id=prev_id,
                correlation_id=uuid4(),
                causation_id=root_id if i == 0 else uuid4(),
                sender="bench",
                recipients=["test"],
                message_type="bench.event",
                payload={"index": i},
            )
            await store.append(envelope)
            if i < chain_length - 1:
                prev_id = uuid4()

        start = time.monotonic()
        chain = await store.get_causation_chain(root_id)
        elapsed = time.monotonic() - start

        await store.close()
    return {
        "name": "Causation chain query",
        "chain_len": len(chain),
        "elapsed_ms": elapsed * 1000,
    }


def format_result(r: dict) -> str:
    if "rate" in r:
        return f"{r['name']}: {r['n']} items in {r['elapsed']:.2f}s ({r['rate']:.0f} items/s)"
    if "avg_ms" in r:
        return f"{r['name']}: {r['elapsed']:.4f}s total ({r['avg_ms']:.2f}ms avg)"
    return f"{r['name']}: chain_len={r.get('chain_len', '?')}, {r.get('elapsed_ms', 0):.2f}ms"


async def main():
    print("=== Cabinet SQLite Performance Benchmarks ===\n")

    result = await bench_event_store_append(5000)
    print(format_result(result))

    result = await bench_event_store_read(1000)
    print(format_result(result))

    result = await bench_causation_chain(50)
    print(format_result(result))


if __name__ == "__main__":
    asyncio.run(main())
