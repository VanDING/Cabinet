# CI/CD Full Pipeline + Performance Discovery & Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete CI/CD pipeline (coverage upload + publish) and execute the performance discovery-and-fix cycle (baseline benchmarks → bottleneck analysis → fixes with verification).

**Architecture:** Two independent subsystems. Subsystem A: 3 tasks to add coverage upload, README badges, and PyPI publish job to existing `.github/workflows/ci.yml`. Subsystem B: 4 tasks to upgrade soak test, collect baseline performance data, identify bottlenecks, and implement fixes.

**Tech Stack:** GitHub Actions, pytest-cov, Codecov, PyPI publish action, py-spy, tracemalloc, psutil, httpx

---

## Subsystem A: CI/CD Pipeline Completion

---

### Task A1: Add Codecov Coverage Upload

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Read the existing ci.yml**

Read `.github/workflows/ci.yml`. Locate the `test` job (lines 34-52).

- [ ] **Step 2: Add coverage upload step to test job**

In the `test` job, after the `- name: Test with observability` step block (after line 52), append:

```yaml
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          file: coverage.xml
          fail_ci_if_error: false
```

Keep indentation consistent with other steps (6 spaces for steps within the job).

- [ ] **Step 3: Verify YAML syntax**

Run:
```bash
cd "e:/AI转型/项目实践/Cabinet"
python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('YAML OK')"
```

Expected: `YAML OK`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add Codecov coverage upload to test job"
```

---

### Task A2: Add README Badges

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read README.md**

Read `README.md` to find the best placement for badges (typically right after the title/H1).

- [ ] **Step 2: Add CI and Codecov badges**

After the title line (`# Cabinet` or similar), insert:

```markdown
[![CI](https://github.com/<owner>/Cabinet/actions/workflows/ci.yml/badge.svg)](https://github.com/<owner>/Cabinet/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/<owner>/Cabinet/branch/master/graph/badge.svg)](https://codecov.io/gh/<owner>/Cabinet)
```

Replace `<owner>` with the actual GitHub org/username found in `git remote -v`.

Run to find the owner:
```bash
git remote get-url origin
```
Extract owner from URL (e.g., `https://github.com/annie/Cabinet` → owner=`annie`).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add CI and Codecov badges to README"
```

---

### Task A3: Add PyPI Publish Job

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Read the existing ci.yml**

Read `.github/workflows/ci.yml` to see the full file structure and find where to append the new job.

- [ ] **Step 2: Append publish job at end of file**

Append after the last job (after `docker-build`):

```yaml
  publish:
    name: Publish to PyPI
    runs-on: ubuntu-latest
    if: startsWith(github.ref, 'refs/tags/v')
    needs: [lint, type-check, test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Build package
        run: |
          pip install build
          python -m build
      - name: Publish to PyPI
        uses: pypa/gh-action-pypi-publish@release/v1
        with:
          password: ${{ secrets.PYPI_TOKEN }}
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          files: dist/*
          generate_release_notes: true
```

Keep indentation consistent with other jobs (2 spaces for job name, 4 spaces for properties, 6 spaces for step properties).

- [ ] **Step 3: Verify YAML syntax**

Run:
```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('YAML OK')"
```

Expected: `YAML OK`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add PyPI publish job on tag push"
```

---

## Subsystem B: Performance Discovery & Fix

---

### Task B1: Upgrade Soak Test (30min → 60min + Concurrent Load)

**Files:**
- Modify: `tests/load/soak_test.py`

- [ ] **Step 1: Read the current soak_test.py**

Read `tests/load/soak_test.py` fully. The key change points are at lines 11, 17, 54, 83.

- [ ] **Step 2: Change duration from 30 to 60 minutes**

```python
# Line 11: CHANGE
DURATION_SECONDS = 1800  # 30 minutes
# TO:
DURATION_SECONDS = 3600  # 60 minutes
```

- [ ] **Step 3: Add concurrent API load**

In the main loop, after the health check (after line 69), add an API chat request every 10 seconds:

```python
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
                except Exception as e:
                    print(f"    chat error: {e}")
```

- [ ] **Step 4: Add GC stats collection**

At the top of the file, add `import gc` to imports. After the memory sampling line (after line 65), add:

```python
            # GC stats
            gc_stats = gc.get_stats()
            gc_collections = sum(s["collections"] for s in gc_stats)
            gc_collected = sum(s["collected"] for s in gc_stats)
```

Update the print line to include GC info:

```python
            print(f"  [{elapsed / 60:5.1f}min] health={health}  mem={mem_str}  "
                  f"gc_collections={gc_collections}  errors={errors}")
```

- [ ] **Step 5: Run soak test to verify it starts**

```bash
cd "e:/AI转型/项目实践/Cabinet"
python tests/load/soak_test.py data 8000 &
SOAK_PID=$!
sleep 10
kill $SOAK_PID 2>/dev/null
echo "Soak test started and stopped successfully"
```

Expected: Soak test starts, prints initial samples, stops cleanly.

- [ ] **Step 6: Commit**

```bash
git add tests/load/soak_test.py
git commit -m "perf: upgrade soak test to 60min with concurrent API load and GC tracking"
```

---

### Task B2: Run Baseline Benchmarks

**Files:** No code changes — execution only.

- [ ] **Step 1: Run bench_api.py**

```bash
cd "e:/AI转型/项目实践/Cabinet"
python tests/load/bench_api.py
```

Expected: Prints throughput and latency for `/health` and `/api/chat`.
Capture the output and save for comparison.

- [ ] **Step 2: Run bench_memory.py**

```bash
python tests/load/bench_memory.py
```

Expected: Prints memory peak and allocation counts during 2000 event appends.
Capture the output.

- [ ] **Step 3: Run bench_sqlite.py**

```bash
python tests/load/bench_sqlite.py
```

Expected: Prints write rate (events/s) and query latency.
Capture the output.

- [ ] **Step 4: Run soak_test.py (60 minutes, background)**

```bash
python tests/load/soak_test.py data 8000 &
SOAK_PID=$!
echo "Soak test PID: $SOAK_PID"
```

Let it run the full 60 minutes. Monitor output periodically.

Expected: `RESULT: STABLE` or `RESULT: UNSTABLE`.

- [ ] **Step 5: Collect all results into a baseline file**

```bash
cat > docs/perf-baseline-$(date +%Y-%m-%d).md << 'PERF'
# Performance Baseline (YYYY-MM-DD)

## Environment
- CPU:
- RAM:
- OS:
- Python: 3.14.4

## bench_api.py
[paste output here]

## bench_memory.py
[paste output here]

## bench_sqlite.py
[paste output here]

## soak_test.py (60 min)
[paste output here]
PERF
```

Fill in the results from Steps 1-4.

- [ ] **Step 6: Commit baseline**

```bash
git add docs/perf-baseline-*.md
git commit -m "perf: add baseline benchmark results (YYYY-MM-DD)"
```

---

### Task B3: Analyze Bottlenecks

**Files:** No code changes — analysis only. May produce small diagnostic scripts.

- [ ] **Step 1: Check memory trend from soak test**

From the soak output, compute:
```
Memory growth = max_valid - min_valid (MB)
Growth rate = memory_growth / 60 (MB/h)
```

If growth rate > 50 MB/h → **memory leak suspected** → go to Step 4.
Otherwise → memory is stable, go to Step 2.

- [ ] **Step 2: Check API latency from bench_api.py**

From the bench output, compute:
```
avg_latency = elapsed / n
```

If `POST /api/chat` avg_latency > 2s → **API latency issue** → run:

```bash
pip install py-spy
py-spy record -o profile.svg -- python -c "
import asyncio
from tests.load.bench_api import bench_chat
asyncio.run(bench_chat(10))
"
```

Open `profile.svg` and identify top 3 functions by CPU time.

- [ ] **Step 3: Check SQLite performance from bench_sqlite.py**

From the bench output:
```
write_rate = count / elapsed (events/s)
```

If write_rate < 1000 events/s → **SQLite bottleneck** → check WAL mode and indexes:

```python
# Run diagnostic:
python -c "
import sqlite3
conn = sqlite3.connect('data/db/cabinet.db')
print('journal_mode:', conn.execute('PRAGMA journal_mode').fetchone()[0])
print('indexes:', conn.execute(\"SELECT name FROM sqlite_master WHERE type='index'\").fetchall())
conn.close()
"
```

Expected: `journal_mode: wal` and at least 2-3 indexes.

- [ ] **Step 4: tracemalloc snapshot comparison (if memory leak suspected)**

```bash
python -c "
import tracemalloc
tracemalloc.start()
# ... run operation that may leak ...
snapshot = tracemalloc.take_snapshot()
top = snapshot.statistics('lineno')
for s in top[:10]:
    print(s)
"
```

Identify top 5 memory-consuming lines.

- [ ] **Step 5: Document findings**

Create `docs/perf-findings-<date>.md` listing each identified bottleneck with:
- Symptom (numbers from baseline)
- Root cause hypothesis
- Proposed fix

Commit this document.

---

### Task B4: Fix Bottlenecks & Re-Verify

**Files:** Depends on findings from Task B3. Likely candidates:
- `src/cabinet/core/db/connection_manager.py` (SQLite connection pool)
- `src/cabinet/core/events/sqlite_store.py` (event store queries)
- `src/cabinet/agents/llm_agent.py` (LLM agent memory usage)

- [ ] **Step 1: Implement fix for each identified bottleneck**

For each bottleneck identified in Task B3:

1. Write a minimal fix addressing the root cause
2. Run the relevant benchmark to verify improvement
3. Record before/after numbers

Common fixes (apply only if relevant to findings):
- SQLite: Increase WAL autocheckpoint, add missing indexes
- Memory: Add explicit `del` for large objects, close unclosed connections
- API latency: Add connection pooling, reduce retry delays

- [ ] **Step 2: Run full test suite to verify no regressions**

```bash
pytest tests/ -q --tb=line
```

Expected: all 1069 tests pass.

- [ ] **Step 3: Re-run benchmarks to confirm improvement**

```bash
python tests/load/bench_api.py
python tests/load/bench_memory.py
python tests/load/bench_sqlite.py
```

Compare with baseline numbers from Task B2.

- [ ] **Step 4: Commit each fix separately**

```bash
git add <fixed files>
git commit -m "perf: <describe fix and improvement percentage>"
```

- [ ] **Step 5: Create final performance report commit**

```bash
git add docs/perf-findings-*.md
git commit -m "perf: add bottleneck analysis and final performance report

Before / After:
- bench_api: X req/s → Y req/s
- bench_memory: X MB → Y MB
- bench_sqlite: X events/s → Y events/s
- soak_test: STABLE (0 errors, memory min X MB, max Y MB)"
```

---

## Execution Order

Subsystem A and B are independent — can run in parallel.

Within A: A1 → A2 → A3 (all independent, but sequential for clean commits)
Within B: B1 → B2 → B3 → B4 (B3 depends on B2 results, B4 depends on B3 findings)

Recommended: Run B1 and B2 first (takes 60+ min for soak test), do A1-A3 while waiting, then B3-B4.

## File Summary

```
Modify (4):
  .github/workflows/ci.yml        +coverage upload +publish job (~35 lines)
  README.md                        +2 badge lines
  tests/load/soak_test.py         30→60min +concurrent load +GC tracking (+30 lines)

Create (2):
  docs/perf-baseline-YYYY-MM-DD.md (baseline data)
  docs/perf-findings-YYYY-MM-DD.md (analysis + before/after)
```
