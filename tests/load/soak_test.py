#!/usr/bin/env python3
"""Continuous soak test: run cabinet serve for 60 minutes, monitor memory."""

from __future__ import annotations

import subprocess
import time
import sys
import os
import gc

DURATION_SECONDS = 3600  # 60 minutes
CHECK_INTERVAL = 30
HEALTH_URL = "http://localhost:8000/health"


def get_memory_mb(pid: int) -> float:
    """Get RSS memory in MB for a process."""
    try:
        import psutil
        return psutil.Process(pid).memory_info().rss / (1024 * 1024)
    except ImportError:
        return -1


def main():
    data_dir = sys.argv[1] if len(sys.argv) > 1 else "data"
    port = sys.argv[2] if len(sys.argv) > 2 else "8000"

    print(f"=== Cabinet Soak Test: {DURATION_SECONDS // 60} minutes ===\n")
    print(f"Data dir: {data_dir}")
    print(f"Port: {port}\n")

    proc = subprocess.Popen(
        [sys.executable, "-m", "cabinet.cli.main", "serve", "--data-dir", data_dir, "--port", port],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(3)

    if proc.poll() is not None:
        print("ERROR: Server failed to start")
        return 1

    pid = proc.pid
    print(f"Server started (PID: {pid})")

    import httpx

    start = time.monotonic()
    samples = []
    errors = 0

    try:
        while time.monotonic() - start < DURATION_SECONDS:
            time.sleep(CHECK_INTERVAL)
            elapsed = time.monotonic() - start

            try:
                r = httpx.get(HEALTH_URL, timeout=5)
                health = "OK" if r.status_code == 200 else f"HTTP {r.status_code}"
            except Exception as e:
                health = f"DOWN ({e})"
                errors += 1

            # Concurrent load: send a chat request every 10s
            if int(elapsed) % 10 == 0:
                try:
                    chat_r = httpx.post(
                        f"http://localhost:{port}/api/chat",
                        json={"message": "ping", "captain_id": "soak-captain"},
                        timeout=10,
                    )
                    if chat_r.status_code != 200:
                        print(f"    chat returned {chat_r.status_code}")
                except Exception as chat_e:
                    print(f"    chat error: {chat_e}")

            mem = get_memory_mb(pid)
            mem_str = f"{mem:.1f}MB" if mem >= 0 else "N/A"
            samples.append(mem)

            gc_stats = gc.get_stats()
            gc_collections = sum(s["collections"] for s in gc_stats)
            gc_collected = sum(s["collected"] for s in gc_stats)

            print(f"  [{elapsed / 60:5.1f}min] health={health}  mem={mem_str}  "
                  f"gc={gc_collections}  errors={errors}")

            if errors > 5:
                print("\nFAILED: Too many errors")
                proc.terminate()
                return 1

    except KeyboardInterrupt:
        print("\nStopped by user")

    finally:
        proc.terminate()
        proc.wait()

    elapsed_min = (time.monotonic() - start) / 60

    print(f"\n=== Soak Test Results ===")
    print(f"Duration: {elapsed_min:.1f} minutes")
    print(f"Errors: {errors}")

    if samples:
        import statistics
        valid = [s for s in samples if s > 0]
        if valid:
            print(f"Memory: min={min(valid):.1f}MB  max={max(valid):.1f}MB  "
                  f"mean={statistics.mean(valid):.1f}MB  stdev={statistics.stdev(valid):.1f}MB")

    if errors > 0:
        print("RESULT: UNSTABLE")
        return 1
    else:
        print("RESULT: STABLE")
        return 0


if __name__ == "__main__":
    sys.exit(main())
