"""Cabinet API Usage Examples (cross-platform Python).

Usage:
    python examples/api_examples.py
    python examples/api_examples.py --base-url http://localhost:8000 --token mytoken
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import httpx

BASE_URL = "http://localhost:8000"
TOKEN = ""


def _headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    return headers


def _print(label: str, response: httpx.Response) -> None:
    print(f"\n=== {label} ===")
    print(f"Status: {response.status_code}")
    try:
        print(json.dumps(response.json(), indent=2, ensure_ascii=False))
    except Exception:
        print(response.text[:500])


def main():
    global BASE_URL, TOKEN

    parser = argparse.ArgumentParser(description="Cabinet API Usage Examples")
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--token", default="")
    args = parser.parse_args()
    BASE_URL = args.base_url
    TOKEN = args.token or os.environ.get("CABINET_TOKEN", "")

    print("=" * 45)
    print("  Cabinet API Usage Examples (Python)")
    print("=" * 45)

    with httpx.Client(timeout=30.0) as client:
        print("\n--- Health Check ---")
        _print("GET /health", client.get(f"{BASE_URL}/health"))
        _print("GET /ready", client.get(f"{BASE_URL}/ready"))

        print("\n--- Chat (REST) ---")
        _print("POST /api/chat", client.post(
            f"{BASE_URL}/api/chat",
            headers=_headers(),
            json={"message": "Hello Cabinet!", "captain_id": "captain"},
        ))

        print("\n--- Employees ---")
        _print("GET /api/employees/", client.get(f"{BASE_URL}/api/employees/", headers=_headers()))
        _print("POST /api/employees/ (create)", client.post(
            f"{BASE_URL}/api/employees/",
            headers=_headers(),
            json={"name": "Analyst", "role": "analyst", "kind": "ai"},
        ))

        print("\n--- Skills ---")
        _print("GET /api/skills/", client.get(f"{BASE_URL}/api/skills/", headers=_headers()))

        print("\n--- Knowledge ---")
        _print("POST /api/knowledge/index", client.post(
            f"{BASE_URL}/api/knowledge/index",
            headers=_headers(),
            json={"path": "data/knowledge"},
        ))
        _print("POST /api/knowledge/query", client.post(
            f"{BASE_URL}/api/knowledge/query",
            headers=_headers(),
            json={"question": "What is Cabinet?", "top_k": 3},
        ))

        print("\n--- Rooms ---")
        _print("POST /api/rooms/meeting", client.post(
            f"{BASE_URL}/api/rooms/meeting",
            headers=_headers(),
            json={"topic": "Product strategy", "level": "multi_party"},
        ))
        _print("POST /api/rooms/decision", client.post(
            f"{BASE_URL}/api/rooms/decision",
            headers=_headers(),
            json={"title": "Launch timing", "decision_type": "strategic"},
        ))
        _print("POST /api/rooms/office/task", client.post(
            f"{BASE_URL}/api/rooms/office/task",
            headers=_headers(),
            json={"description": "Write market analysis report"},
        ))
        _print("POST /api/rooms/strategy", client.post(
            f"{BASE_URL}/api/rooms/strategy",
            headers=_headers(),
            json={"proposal": "Expand to healthcare vertical"},
        ))
        _print("POST /api/rooms/summary/review", client.post(
            f"{BASE_URL}/api/rooms/summary/review",
            headers=_headers(),
            json={"review_type": "project_review"},
        ))

        print("\n--- Config ---")
        _print("GET /api/config/", client.get(f"{BASE_URL}/api/config/", headers=_headers()))

        print("\n--- Prometheus Metrics ---")
        try:
            metrics_resp = httpx.get("http://localhost:9090/metrics", timeout=5.0)
            lines = [l for l in metrics_resp.text.splitlines() if l.startswith("cabinet_")]
            print(f"\n=== Prometheus Metrics (showing first 20 cabinet_ lines) ===")
            for line in lines[:20]:
                print(line)
        except Exception:
            print("(Prometheus not available)")

    print("\n" + "=" * 45)
    print("  Examples complete!")
    print("=" * 45)


if __name__ == "__main__":
    main()
