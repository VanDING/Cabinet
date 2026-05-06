# Cabinet API Usage Examples (Windows PowerShell)
# Prerequisites: cabinet serve --port 8000

$BaseUrl = "http://localhost:8000"
$Token = if ($env:CABINET_TOKEN) { $env:CABINET_TOKEN } else { "" }
$Headers = @{
    "Content-Type" = "application/json"
}
if ($Token) {
    $Headers["Authorization"] = "Bearer $Token"
}

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Cabinet API Usage Examples (Windows)" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# === Health Check ===
Write-Host "=== Health Check ===" -ForegroundColor Yellow
Write-Host "GET /health"
try { Invoke-RestMethod -Uri "$BaseUrl/health" | ConvertTo-Json } catch { Write-Host "(request failed)" }
Write-Host ""
Write-Host "GET /ready"
try { Invoke-RestMethod -Uri "$BaseUrl/ready" | ConvertTo-Json } catch { Write-Host "(request failed)" }
Write-Host ""

# === Chat (REST) ===
Write-Host "=== Chat (REST) ===" -ForegroundColor Yellow
Write-Host "POST /api/chat"
$body = '{"message": "Hello Cabinet!", "captain_id": "captain"}'
try { Invoke-RestMethod -Uri "$BaseUrl/api/chat" -Method Post -Headers $Headers -Body $body | ConvertTo-Json } catch { Write-Host "(request failed)" }
Write-Host ""

# === Chat (WebSocket) ===
Write-Host "=== Chat (WebSocket) ===" -ForegroundColor Yellow
Write-Host "Connect: ws://localhost:8000/api/chat/ws?captain_id=captain"
Write-Host "Use a WebSocket client or browser console:"
Write-Host '  const ws = new WebSocket("ws://localhost:8000/api/chat/ws?captain_id=captain");'
Write-Host ""

# === Employees ===
Write-Host "=== Employees ===" -ForegroundColor Yellow
Write-Host "GET /api/employees/"
try { Invoke-RestMethod -Uri "$BaseUrl/api/employees/" -Headers $Headers | ConvertTo-Json } catch { Write-Host "(request failed)" }
Write-Host ""
Write-Host "POST /api/employees/ (create)"
$body = '{"name": "Analyst", "role": "analyst", "kind": "ai"}'
try { Invoke-RestMethod -Uri "$BaseUrl/api/employees/" -Method Post -Headers $Headers -Body $body | ConvertTo-Json } catch { Write-Host "(request failed)" }
Write-Host ""

# === Skills ===
Write-Host "=== Skills ===" -ForegroundColor Yellow
Write-Host "GET /api/skills/"
try { Invoke-RestMethod -Uri "$BaseUrl/api/skills/" -Headers $Headers | ConvertTo-Json } catch { Write-Host "(request failed)" }
Write-Host ""

# === Knowledge ===
Write-Host "=== Knowledge ===" -ForegroundColor Yellow
Write-Host "POST /api/knowledge/index"
$body = '{"path": "data/knowledge"}'
try { Invoke-RestMethod -Uri "$BaseUrl/api/knowledge/index" -Method Post -Headers $Headers -Body $body | ConvertTo-Json } catch { Write-Host "(request failed)" }
Write-Host ""
Write-Host "POST /api/knowledge/query"
$body = '{"question": "What is Cabinet?", "top_k": 3}'
try { Invoke-RestMethod -Uri "$BaseUrl/api/knowledge/query" -Method Post -Headers $Headers -Body $body | ConvertTo-Json } catch { Write-Host "(request failed)" }
Write-Host ""

# === Rooms ===
Write-Host "=== Rooms ===" -ForegroundColor Yellow
Write-Host "POST /api/rooms/meeting"
$body = '{"topic": "Product strategy", "level": "multi_party"}'
try { Invoke-RestMethod -Uri "$BaseUrl/api/rooms/meeting" -Method Post -Headers $Headers -Body $body | ConvertTo-Json } catch { Write-Host "(request failed)" }
Write-Host ""
Write-Host "POST /api/rooms/decision"
$body = '{"title": "Launch timing", "decision_type": "strategic"}'
try { Invoke-RestMethod -Uri "$BaseUrl/api/rooms/decision" -Method Post -Headers $Headers -Body $body | ConvertTo-Json } catch { Write-Host "(request failed)" }
Write-Host ""
Write-Host "POST /api/rooms/office/task"
$body = '{"description": "Write market analysis report"}'
try { Invoke-RestMethod -Uri "$BaseUrl/api/rooms/office/task" -Method Post -Headers $Headers -Body $body | ConvertTo-Json } catch { Write-Host "(request failed)" }
Write-Host ""
Write-Host "POST /api/rooms/strategy"
$body = '{"proposal": "Expand to healthcare vertical"}'
try { Invoke-RestMethod -Uri "$BaseUrl/api/rooms/strategy" -Method Post -Headers $Headers -Body $body | ConvertTo-Json } catch { Write-Host "(request failed)" }
Write-Host ""
Write-Host "POST /api/rooms/summary/review"
$body = '{"review_type": "project_review"}'
try { Invoke-RestMethod -Uri "$BaseUrl/api/rooms/summary/review" -Method Post -Headers $Headers -Body $body | ConvertTo-Json } catch { Write-Host "(request failed)" }
Write-Host ""

# === Config ===
Write-Host "=== Config ===" -ForegroundColor Yellow
Write-Host "GET /api/config/"
try { Invoke-RestMethod -Uri "$BaseUrl/api/config/" -Headers $Headers | ConvertTo-Json } catch { Write-Host "(request failed)" }
Write-Host ""

# === Prometheus Metrics ===
Write-Host "=== Prometheus Metrics ===" -ForegroundColor Yellow
Write-Host "GET http://localhost:9090/metrics (cabinet_ prefixed metrics)"
try {
    $metrics = Invoke-WebRequest -Uri "http://localhost:9090/metrics" -UseBasicParsing
    $metrics.Content -split "`n" | Where-Object { $_ -match "^cabinet_" } | Select-Object -First 20
} catch { Write-Host "(Prometheus not available)" }
Write-Host ""

Write-Host "=========================================" -ForegroundColor Green
Write-Host "  Examples complete!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
