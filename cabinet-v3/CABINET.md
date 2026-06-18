# CABINET.md — Cabinet v3 项目指令

> Cabinet v3: Rust Coding Agent。从零重写，聚焦终端中的极致性能代码助手。

## 项目结构

```
cabinet-v3/
  crates/               ← 18 个 crate，5 层架构
  deliverables/          ← 架构设计 + 细节设计文档
  reports/              ← 7 份对标分析报告
  Cargo.toml            ← workspace root
```

## 技术栈

- **语言**: Rust edition 2024
- **异步**: tokio (full)
- **数据库**: SQLite (rusqlite, WAL mode, FTS5)
- **TUI**: ratatui + crossterm
- **LLM**: reqwest (HTTP) + 自研 MCP 客户端
- **代码智能**: tree-sitter (Rust/TypeScript/Python/Go/JavaScript)
- **WASM**: wasmtime
- **序列化**: serde + serde_json + toml
- **可观测性**: tracing + opentelemetry

## 架构原则 (11 条不可妥协)

1. 先有场景，后有架构
2. 类型/实现分离
3. 依赖单向可校验（cargo deny 强制执行）
4. 沙箱是安全底线
5. CodeGraph 是代码理解的唯一入口
6. 窄腰设计（22 个内置工具，新能力通过 Skill/Plugin/MCP 添加）
7. Prompt 缓存不可侵犯
8. 事件溯源用于会话（N=20 snapshot）
9. Plan Mode 默认开启
10. 500 行/文件，800 行硬上限
11. 不留骨架

## 构建命令

```bash
cargo build                    # 构建
cargo test --all-features      # 测试
cargo clippy --all-features -- -D warnings  # Lint
cargo fmt --check              # 格式检查
cargo deny check               # 依赖审计
```

## 设计文档

开发时始终打开两份文档作为规格参考：

- `deliverables/cabinet-v3-architecture-final.md` — 系统做什么
- `deliverables/cabinet-v3-detailed-design.md` — 每个子系统怎么做

## 对标参考

- Claude Code: prompt 缓存、Plan Mode、子代理体系、Workflow、权限模式
- Hermes: 4 阶段压缩、环境感知、模型专属指令、Skill 自主创建
- OpenCode: 事件溯源、Effect-TS 插件系统
- DeerFlow: 沙箱隔离、Skill 安全扫描、置信度过滤
- Codex CLI: 3 层沙箱、execpolicy
- jcode: Sideagent 记忆验证、Swarm 并行

## 开发顺序 (建议)

1. Foundation 层: base → types → exec-types → gateway-types → storage → otel → codegraph
2. Engine 层: sandbox → exec → gateway → session → tool → plugin
3. Intelligence 层: skill → memory → agent
4. Application 层: app-core
5. Interface 层: tui
