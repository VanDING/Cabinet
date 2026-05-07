# CI/CD 完整流水线 + 性能稳定性 — 设计方案

**Date**: 2026-05-07
**Status**: Approved
**Scope**: 补全 CI/CD 到完整流水线 + 性能发现与修复三阶段

---

## 子系统 A：CI/CD 完整流水线

### 现状

`.github/workflows/ci.yml` 已有 5 个 job：

| Job | 状态 | 内容 |
|-----|------|------|
| `lint` | ✅ | ruff check src/ tests/ |
| `type-check` | ✅ | mypy src/cabinet/ (ignore-missing-imports) |
| `test` | ✅ | pytest 矩阵 (3.12, 3.13) + coverage xml + --cov-fail-under=75 |
| `security` | ✅ | pip-audit |
| `docker-build` | ✅ | docker build + docker run verify |

触发条件：push/PR to master ✅

### 补充项

**1. 覆盖率上传 (Codecov)**

在 `test` job 末尾追加：

```yaml
- name: Upload coverage to Codecov
  uses: codecov/codecov-action@v4
  with:
    file: coverage.xml
    fail_ci_if_error: false
```

需要添加 `CODECOV_TOKEN` 到 GitHub Secrets（公开仓库可省略 token）。

**2. README 徽章**

在 README.md 顶部添加：

```markdown
[![CI](https://github.com/<owner>/Cabinet/actions/workflows/ci.yml/badge.svg)](https://github.com/<owner>/Cabinet/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/<owner>/Cabinet/branch/master/graph/badge.svg)](https://codecov.io/gh/<owner>/Cabinet)
```

**3. 自动发布 (publish job)**

新增 job，仅在 tag `v*` 推送时触发：

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

需要添加 `PYPI_TOKEN` 到 GitHub Secrets。

### 文件变更

| 文件 | 操作 | 行数 |
|------|------|------|
| `.github/workflows/ci.yml` | 追加 publish job + coverage upload (~30行) | +30 |
| `README.md` | 追加 CI + coverage badge | +3 |

---

## 子系统 B：性能与稳定性 — 发现并修复

### 三阶段流程

```
阶段 1: 基准采集        →   阶段 2: 瓶颈定位       →   阶段 3: 修复验证
(运行已有工具)              (分析数据定位根因)          (修复 → 重跑 → 记录)
```

### 阶段 1：基准采集

使用已有 `tests/load/` 下的 4 个脚本：

| 脚本 | 测量内容 | 关键指标 |
|------|---------|---------|
| `bench_api.py` | `GET /health` ×100 + `POST /api/chat` ×50 | 吞吐量 (req/s)、平均延迟 |
| `bench_memory.py` | 2000 条事件追加 (tracemalloc) | 内存峰值 (MB)、分配次数 |
| `bench_sqlite.py` | 5000 条事件写入 + 查询 | 写入速率 (events/s)、查询延迟 (ms) |
| `soak_test.py` | 服务持续运行 60 分钟 | 内存趋势 (min/mean/max/stdev)、错误数 |

**soak_test.py 改进：**
- 运行时长：30 分钟 → 60 分钟
- 新增：每 10 秒发送 1 个 `POST /api/chat` 请求（并发负载），替代纯被动健康检查
- 新增：GC 统计 (`gc.get_stats()`)
- 输出：每分钟采样一行，最终输出稳定性判定 `STABLE / UNSTABLE`

### 阶段 2：瓶颈定位

收集阶段 1 数据后，按优先级排查：

| 信号 | 阈值 | 排查工具 | 定位目标 |
|------|------|---------|---------|
| API 延迟高 | p95 > 2s (chat) | py-spy 火焰图 | 热点函数 |
| 内存持续增长 | soak 线性增长 > 50MB/h | tracemalloc 快照对比 | 泄漏对象 |
| SQLite 慢 | 5000 条写入 > 5s | sqlite3 查询计划 | 缺失索引/锁竞争 |
| 错误率 | soak 错误 > 0 | 日志 + 异常堆栈 | 未处理异常路径 |

**排查优先级：** 内存泄漏 > API 延迟 > SQLite 性能 > 错误

### 阶段 3：修复验证

每个瓶颈：记录根因 → 最小化修复 → 重跑对应基准 → 确认改善幅度 → 提交。

交付物：
- 1-3 个性能修复 commit
- 修复前后的基准对比数据
- 最终性能报告（记录在 commit message 中）

### 文件变更

| 文件 | 操作 | 内容 |
|------|------|------|
| `tests/load/soak_test.py` | 修改 | 30min→60min + 并发负载 + GC 统计 |

无新增文件 —— 复用已有基准脚本，仅加强 soak_test。

---

## 风险

| 风险 | 缓解 |
|------|------|
| Codecov upload 需要 org token | 先尝试无 token（公开仓库自动工作），失败则加 secret |
| PyPI publish 需要 API token | 手动创建 PyPI token 加入 GitHub Secrets |
| 性能基准依赖本地环境（需运行 `cabinet serve`） | 基准结果标注运行环境（CPU/内存/OS），不作为 CI 硬门禁 |
| 浸泡测试可能发现 0 个瓶颈 | 仍产出 soak 稳定性报告，归档为基线数据 |
