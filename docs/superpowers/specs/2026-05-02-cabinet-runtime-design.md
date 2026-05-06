# CabinetRuntime 系统组装设计

> 2026-05-02, 基于 brainstorming 产出

## 目标

将所有已实现的组件（EventBus + RoomEventWiring + 6 室 Service + EventHandler + AgentFactory）组装为可运行的端到端系统，让 Cabinet 从"零件齐全"变为"机器可运转"。

采用**最小可运行组装**策略：只做组件组装和生命周期管理，不添加新业务能力。

## 前置条件

以下组件已全部实现并通过测试（350 tests passing）：

- `AsyncIOEventBus` + `EventStore` — 异步事件总线
- `RoomEventWiring` + `EventContract` + `RoomEventHandler` + `RoomEventPublisher` — 跨室事件布线
- 6 个 `RoomEventStore` + `EventSourcedRoom` — 事件溯源基础设施
- 6 个 Room Service — 会议室/战略解码/决策室/办公室/总结室/秘书
- 6 个 EventHandler — 跨室事件处理
- 31 个域事件 — 室内状态追踪
- 12 种跨室事件类型 — 室间通信
- `LiteLLMRouterGateway` — 模型网关
- `AgentFactory` 协议 — Agent 工厂接口（但无具体实现）

## 新增组件

### 1. CabinetRuntime

**文件**: `src/cabinet/runtime.py`

**职责**: 将所有组件按正确依赖顺序组装为可运行的系统，提供生命周期管理和服务访问入口。

**接口设计**:

```python
class CabinetRuntime:
    def __init__(self, agent_factory: AgentFactory | None = None):
        ...

    async def start(self) -> None:
        """启动系统：注册所有事件处理器，使事件链路生效。"""

    async def stop(self) -> None:
        """优雅关闭。"""

    @property
    def meeting(self) -> MeetingRoomService: ...

    @property
    def strategy(self) -> StrategyDecoderService: ...

    @property
    def decision(self) -> DecisionRoomService: ...

    @property
    def office(self) -> OfficeSchedulerService: ...

    @property
    def summary(self) -> SummaryRoomService: ...

    @property
    def secretary(self) -> SecretaryAgentService: ...

    @property
    def bus(self) -> AsyncIOEventBus: ...

    @property
    def wiring(self) -> RoomEventWiring: ...
```

**组装顺序**:

```
1. bus = AsyncIOEventBus()                           # 内部自动创建 EventStore
2. wiring = RoomEventWiring(bus=bus)                 # 传入 bus
3. agent_factory = agent_factory or StubAgentFactory()  # 默认使用测试桩
4. 为每个房间创建 RoomEventStore(room_name="xxx")      # 6 个独立存储
5. 创建 6 个 Service(store, wiring, agent_factory)     # wiring 同时充当 publisher
6. 创建 6 个 EventHandler（4 个注入对应 Service）      # decision/office/summary/secretary 依赖 Service
7. await wiring.register(handler) × 6                 # 注册所有处理器
```

**关键设计决策**:

- `RoomEventWiring` 实例本身就是 `RoomEventPublisher` 协议的实现，无需额外适配器
- `__init__` 中完成所有组件创建（同步操作），`start()` 只负责 `await wiring.register()` （异步操作）
- `agent_factory` 参数可选，默认创建 `StubAgentFactory`
- 不持有 `LiteLLMRouterGateway` 引用——Gateway 由调用方按需创建并注入 AgentFactory
- `stop()` 目前为空操作，预留未来扩展（如断开 MCP 连接、关闭数据库等）

### 2. StubAgentFactory

**文件**: `src/cabinet/agents/stub_factory.py`

**职责**: 提供 `AgentFactory` 协议的测试桩实现，返回固定输出的 Agent 和 Team，使系统在不调用真实 LLM 的情况下可运行。

**接口设计**:

```python
class StubAgentFactory:
    """AgentFactory 的测试桩。create_agent 返回 StubAgent，create_team 返回 StubTeam。"""

    async def create_agent(self, agent_id: UUID, role: str) -> BaseAgent:
        """返回一个 StubAgent，execute() 返回固定内容。"""

    async def create_team(self, agents: list[BaseAgent], task: str) -> BaseTeam:
        """返回一个 StubTeam，dispatch() 返回固定内容。"""
```

**内部实现**:

- `StubAgent` — 满足 `BaseAgent` 协议，`execute()` 返回 `AgentOutput(content=f"Stub response for {role}", employee_id=...)`
- `StubTeam` — 满足 `BaseTeam` 协议，`dispatch()` 返回 `TeamOutput(content="Stub team response", team_id=...)`
- 两者作为 `StubAgentFactory` 的内部类或同文件私有类

### 3. CLI 接入

**文件**: 修改 `src/cabinet/cli/main.py`

**变更**: 更新 `_serve_async()` 使用 `CabinetRuntime`：

```python
async def _serve_async(data_dir: str) -> None:
    from cabinet.runtime import CabinetRuntime

    runtime = CabinetRuntime()
    await runtime.start()

    console.print(Panel(
        f"[bold green]Cabinet is serving[/bold green]\n\n"
        f"Organization: {config.organization.name}\n"
        f"Event Bus: active\n"
        f"Rooms: meeting, strategy, decision, office, summary, secretary\n\n"
        f"Press Ctrl+C to stop",
        title="Cabinet Serve",
    ))

    stop_event = asyncio.Event()
    try:
        await stop_event.wait()
    except asyncio.CancelledError:
        pass
    finally:
        await runtime.stop()
```

## 依赖关系

```
CabinetRuntime
├── AsyncIOEventBus (core/events/asyncio_bus.py)
│   └── EventStore (core/events/store.py) [内部自动创建]
├── RoomEventWiring (core/events/wiring.py)
│   └── EventBus [注入]
├── StubAgentFactory (agents/stub_factory.py)
│   ├── StubAgent [满足 BaseAgent 协议]
│   └── StubTeam [满足 BaseTeam 协议]
├── 6 × RoomEventStore (core/events/event_sourced.py)
├── 6 × Room Service (rooms/*/service.py)
│   ├── RoomEventStore [注入]
│   ├── RoomEventWiring [注入，充当 RoomEventPublisher]
│   └── AgentFactory [注入]
└── 6 × EventHandler (rooms/*/event_handler.py)
    ├── 2 × 无依赖 (meeting, strategy)
    └── 4 × 依赖对应 Service (decision, office, summary, secretary)
```

## 集成测试验证点

| # | 验证项 | 方法 |
|:---|:---|:---|
| 1 | 组装验证 | CabinetRuntime 创建后所有服务属性可访问且类型正确 |
| 2 | 事件链路 | 会议室收敛 → 发布 deliberation.proposal → 决策室 EventHandler 收到 |
| 3 | 因果链追溯 | 通过 bus.get_causation_chain() 追溯完整因果链 |
| 4 | 生命周期 | start/stop 正常工作，stop 后不再处理事件 |
| 5 | StubAgentFactory | 满足 AgentFactory 协议（runtime_checkable 验证） |
| 6 | 全量决策链路 | 会议 → 战略 → 决策 → 办公室 → 总结 → 秘书 事件链路贯通 |
| 7 | CLI serve | cabinet serve 使用 CabinetRuntime 启动 |

## 不在范围内

- LLM 真实集成（真实 AgentFactory 实现）
- 持久化（RoomEventStore 写入 SQLite/文件）
- 崩溃恢复
- Captain 交互 API（process_input 等高层方法）
- 状态快照 API
- Web UI / TUI

## 交付标准

1. 所有现有 350 个测试继续通过
2. 新增测试覆盖 CabinetRuntime、StubAgentFactory、集成验证
3. `ruff check src/ tests/` 零错误
4. `CabinetRuntime()` 可创建并启动完整系统
5. 事件链路端到端贯通
6. CLI `cabinet serve` 使用 CabinetRuntime
