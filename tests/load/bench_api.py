from __future__ import annotations

import asyncio
import time

import httpx


BASE_URL = "http://localhost:8000"


async def bench_health(n: int = 100) -> float:
    async with httpx.AsyncClient() as client:
        start = time.monotonic()
        for _ in range(n):
            await client.get(f"{BASE_URL}/health")
        return time.monotonic() - start


async def bench_chat(n: int = 50) -> float:
    async with httpx.AsyncClient() as client:
        start = time.monotonic()
        for _ in range(n):
            await client.post(
                f"{BASE_URL}/api/chat",
                json={"message": "Hello", "captain_id": "captain"},
            )
        return time.monotonic() - start


async def main():
    print("=== Cabinet API Load Benchmark ===\n")

    elapsed = await bench_health(100)
    print(f"GET /health: 100 requests in {elapsed:.2f}s ({100/elapsed:.0f} req/s)")

    try:
        elapsed = await bench_chat(50)
        print(f"POST /api/chat: 50 requests in {elapsed:.2f}s ({50/elapsed:.0f} req/s)")
    except Exception as e:
        print(f"POST /api/chat: skipped ({e})")


if __name__ == "__main__":
    asyncio.run(main())
