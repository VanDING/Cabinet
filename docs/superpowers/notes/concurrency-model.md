# Cabinet 并发模型

> 记录日期：2026-06-01
> 影响范围：BrowserPool 设计、系统工具权限边界、Agent 工具并发安全

## 模型概述

Cabinet 是一个基于 HTTP/WebSocket 的 **多会话 server 应用**，支持以下并发场景：

1. **多 Captain 会话并发**：`SessionManager` 管理多个活跃会话，每个会话有独立的 message history 和 short-term memory
2. **前台请求与后台任务并发**：Curator 后台任务（consolidation、pattern extraction、harness analysis）与前台用户请求同时运行
3. **工作流内并行**：`parallel` 节点支持多个子 agent 同时执行
4. **子 agent 调用**：`invoke_agent` 可触发独立的 AgentLoop 实例

## 关键组件的并发策略

### SessionManager

- 每个 session 有唯一 ID，内存中独立存储
- 无全局锁，session 间操作互不阻塞
- 会话过期清理：每 6 小时扫描一次过期会话

### AgentLoop / ToolExecutor

- 每个请求创建独立的 `AgentLoop` 实例（见 `secretary.ts:createAgentLoopForRole`）
- `ToolExecutor` 实例按 loop 隔离，但底层 capabilities 共享同一进程资源
- **ToolPruner** 按 loop 实例级别裁剪工具列表（不影响其他 loop）

### BrowserPool（Phase 2 引入）

- **设计约束**：Playwright 的 `Browser`/`Context`/`Page` 不是进程安全的，必须在单进程中管理
- **会话隔离方案**：`Map<string, SessionPage>` 按 `sessionId` 隔离 page
  - 每个会话调用 `browser_navigate` 时获取/创建独立 page
  - 后续 click/type/read/screenshot/evaluate 操作该会话的专属 page
  - 空闲超过 10 分钟的会话 page 自动释放
- **并发上限**：`maxContexts = 3`，超过时新会话需要等待或报错

### 后台 Curator 队列

- 双队列优先级控制：`highPriorityQueue` + `lowPriorityQueue`
- 单线程执行：`curatorBusy` 标志确保只有一个 Curator 任务在运行
- 同标签去重：相同 label 的任务在队列中只保留最新一个

## 对工具设计的约束

| 工具类别                                   | 并发安全要求                                                     |
| :----------------------------------------- | :--------------------------------------------------------------- |
| 文件工具（read/write/edit）                | 无状态，依赖 OS 文件锁。并发写入同一文件可能冲突，由调用方负责。 |
| Web 工具（web_fetch/http）                 | 无状态，每次调用独立 fetch。                                     |
| Shell 工具（exec_command）                 | 无状态，每次调用独立子进程。                                     |
| 浏览器工具（browser\_\*）                  | **有状态**，必须通过 `sessionId` 隔离。                          |
| 系统工具（clipboard/process/notification） | **全局状态**，影响整个 OS。仅单用户桌面模式可用。                |
| 知识工具（index/search）                   | 依赖 SQLite，SQLite 文件级锁天然串行化写操作。                   |

## 部署模式差异

| 模式             | 并发模型                    | BrowserPool               | 系统工具（剪贴板/通知/进程）                                 |
| :--------------- | :-------------------------- | :------------------------ | :----------------------------------------------------------- |
| 桌面端（Tauri）  | 单用户，但支持多标签/多会话 | 可用，会话隔离            | 可用，影响当前用户 OS                                        |
| 服务器（server） | 多用户，多会话              | 可用，会话隔离 + 全局上限 | **禁用**，返回 `{ error: 'Only available in desktop mode' }` |

## 决策记录

- **BrowserPool 不使用独立进程**：Playwright 的 Chromium 进程启动成本太高（2-3s），独立进程模型会抵消性能优势。
- **系统工具不限制为单会话**：剪贴板/通知/进程是 OS 全局资源，无法会话隔离。通过部署模式限制（仅桌面端）和角色权限（仅 ORGANIZE_ROLE 可用 start_process）来管控风险。
- **不引入分布式锁**：当前架构为单进程 Node.js，无需分布式锁。如未来扩展为多进程/多实例，需在 BrowserPool 和系统工具层引入外部锁（如 Redis）。
