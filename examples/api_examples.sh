#!/bin/bash
# Cabinet API Usage Examples
# Prerequisites: cabinet serve --port 8000

BASE_URL="http://localhost:8000"
TOKEN="${CABINET_TOKEN:-}"

echo "========================================="
echo "  Cabinet API Usage Examples"
echo "========================================="
echo ""

# === Health Check ===
echo "=== Health Check ==="
echo "GET /health"
curl -s "$BASE_URL/health" | python -m json.tool 2>/dev/null || curl -s "$BASE_URL/health"
echo ""
echo "GET /ready"
curl -s "$BASE_URL/ready" | python -m json.tool 2>/dev/null || curl -s "$BASE_URL/ready"
echo ""

# === Chat (REST) ===
echo "=== Chat (REST) ==="
echo "POST /api/chat"
curl -s -X POST "$BASE_URL/api/chat" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"message": "Hello Cabinet!", "captain_id": "captain"}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""

# === Chat (WebSocket) ===
echo "=== Chat (WebSocket) ==="
echo "Connect: ws://localhost:8000/api/chat/ws?captain_id=captain"
echo "Use wscat: wscat -c \"ws://localhost:8000/api/chat/ws?captain_id=captain${TOKEN:+&token=$TOKEN}\""
echo ""

# === Employees ===
echo "=== Employees ==="
echo "GET /api/employees/"
curl -s ${TOKEN:+-H "Authorization: Bearer $TOKEN"} "$BASE_URL/api/employees/" | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""
echo "POST /api/employees/ (create)"
curl -s -X POST "$BASE_URL/api/employees/" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"name": "Analyst", "role": "analyst", "kind": "ai"}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""

# === Skills ===
echo "=== Skills ==="
echo "GET /api/skills/"
curl -s ${TOKEN:+-H "Authorization: Bearer $TOKEN"} "$BASE_URL/api/skills/" | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""

# === Knowledge ===
echo "=== Knowledge ==="
echo "POST /api/knowledge/index"
curl -s -X POST "$BASE_URL/api/knowledge/index" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"path": "data/knowledge"}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""
echo "POST /api/knowledge/query"
curl -s -X POST "$BASE_URL/api/knowledge/query" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"question": "What is Cabinet?", "top_k": 3}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""

# === Rooms ===
echo "=== Rooms ==="
echo "POST /api/rooms/meeting"
curl -s -X POST "$BASE_URL/api/rooms/meeting" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"topic": "Product strategy", "level": "multi_party"}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""
echo "POST /api/rooms/decision"
curl -s -X POST "$BASE_URL/api/rooms/decision" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"title": "Launch timing", "decision_type": "strategic"}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""
echo "POST /api/rooms/office/task"
curl -s -X POST "$BASE_URL/api/rooms/office/task" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"description": "Write market analysis report"}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""
echo "POST /api/rooms/strategy"
curl -s -X POST "$BASE_URL/api/rooms/strategy" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"proposal": "Expand to healthcare vertical"}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""
echo "POST /api/rooms/summary/review"
curl -s -X POST "$BASE_URL/api/rooms/summary/review" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"review_type": "project_review"}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""

# === Config ===
echo "=== Config ==="
echo "GET /api/config/"
curl -s ${TOKEN:+-H "Authorization: Bearer $TOKEN"} "$BASE_URL/api/config/" | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""

# === Prometheus Metrics ===
echo "=== Prometheus Metrics ==="
echo "GET http://localhost:9090/metrics (cabinet_ prefixed metrics)"
curl -s "http://localhost:9090/metrics" 2>/dev/null | grep "^cabinet_" | head -20 || echo "(Prometheus not available)"
echo ""

echo "========================================="
echo "  Examples complete!"
echo "========================================="
