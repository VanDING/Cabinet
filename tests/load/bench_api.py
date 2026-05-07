from __future__ import annotations

import asyncio
import time
from uuid import uuid4

import httpx

BASE_URL = "http://localhost:8000"


async def bench_health(n: int = 100) -> dict:
    async with httpx.AsyncClient() as client:
        start = time.monotonic()
        for _ in range(n):
            await client.get(f"{BASE_URL}/health")
        elapsed = time.monotonic() - start
    return {"name": "GET /health", "n": n, "elapsed": elapsed, "rate": n / elapsed}


async def bench_chat(n: int = 50) -> dict:
    async with httpx.AsyncClient() as client:
        start = time.monotonic()
        for _ in range(n):
            await client.post(
                f"{BASE_URL}/api/chat",
                json={"message": "Hello", "captain_id": "bench-captain"},
            )
        elapsed = time.monotonic() - start
    return {"name": "POST /api/chat", "n": n, "elapsed": elapsed, "rate": n / elapsed}


async def bench_employees_list(n: int = 50) -> dict:
    async with httpx.AsyncClient() as client:
        start = time.monotonic()
        for _ in range(n):
            await client.get(f"{BASE_URL}/api/employees")
        elapsed = time.monotonic() - start
    return {"name": "GET /api/employees", "n": n, "elapsed": elapsed, "rate": n / elapsed}


async def bench_concurrent_health(n_users: int = 10, n_reqs: int = 20) -> dict:
    async def user_loop():
        async with httpx.AsyncClient() as client:
            for _ in range(n_reqs):
                await client.get(f"{BASE_URL}/health")

    start = time.monotonic()
    tasks = [asyncio.create_task(user_loop()) for _ in range(n_users)]
    await asyncio.gather(*tasks)
    elapsed = time.monotonic() - start
    total = n_users * n_reqs
    return {
        "name": f"GET /health ({n_users} concurrent)",
        "n": total,
        "elapsed": elapsed,
        "rate": total / elapsed,
    }


def format_result(r: dict) -> str:
    if "error" in r:
        return f"{r['name']}: skipped ({r['error']})"
    return f"{r['name']}: {r['n']} requests in {r['elapsed']:.2f}s ({r['rate']:.0f} req/s)"


async def main():
    print("=== Cabinet API Load Benchmark ===\n")

    try:
        await httpx.AsyncClient().get(f"{BASE_URL}/health")
    except Exception:
        print("ERROR: API server not running at", BASE_URL)
        print("Start with: cabinet serve")
        return

    results = []

    results.append(await bench_health(100))
    results.append(await bench_concurrent_health(10, 20))
    results.append(await bench_employees_list(50))

    try:
        results.append(await bench_chat(50))
    except Exception as e:
        results.append({"name": "POST /api/chat", "error": str(e)})

    print()
    for r in results:
        print(format_result(r))


if __name__ == "__main__":
    asyncio.run(main())
