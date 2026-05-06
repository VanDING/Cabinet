# 跨室事件集成设计

> 基于 Brainstorming 技能产出，2026-05-02

## 关键决策

| 决策 | 选择 | 理由 |
|:---|:---|:---|
| 架构方案 | 方案 C：Event-Driven Room Protocol Extension | 遵循现有 Protocol-First 模式，室之间完全解耦 |
| 事件产出机制 | 室服务内部调用 Publisher | 简单直接，依赖协议接口仍可测试 |
| 集成范围 | 全量事件链路 | 先打通管道，服务实现时直接接入 |
| 室协议修改 | 不修改 | 事件处理逻辑与业务逻辑分离 |

## 事件流转图

```
会议室 ──deliberation.proposal──→ 决策室
                               → 战略解码
会议室 ──deliberation.dissent───→ 决策室

战略解码 ──strategy.decode_result─→ 决策室

各室 ──decision.request─────────→ 决策室
决策室 ──decision.response──────→ 办公室
                              → 总结室
                              → 秘书

决策室 ──task.order─────────────→ 办公室

办公室 ──task.status_update─────→ 决策室
                              → 总结室
办公室 ──task.failure───────────→ 决策室

总结室 ──summary.insight───────→ 决策室
                              → 秘书
Timer  ──summary.review_request─→ 总结室

评估者 ──harness.evaluation_result─→ 总结室

秘书 ──secretary.notification──→ Captain (UI层)
```

## 核心组件

### 1. EventContract

每个室声明自己产出和消费的事件类型，形成静态契约。

```python
class EventContract(BaseModel):
    room_name: str
    produces: list[str]
    consumes: list[str]
```

### 2. RoomEventHandler 协议

不修改现有室协议，为每个室创建独立的事件处理器。

```python
@runtime_checkable
class RoomEventHandler(Protocol):
    @property
    def contract(self) -> EventContract: ...
    async def handle(self, envelope: MessageEnvelope) -> None: ...
```

设计原则：
- 室协议（MeetingRoom, DecisionRoom 等）保持不变
- 事件处理逻辑与业务逻辑分离
- 每个 EventHandler 知道如何将事件翻译为室方法调用

### 3. RoomEventPublisher 协议

室服务通过此协议发布事件，Publisher 负责构建 MessageEnvelope。

```python
@runtime_checkable
class RoomEventPublisher(Protocol):
    async def publish(self, room_name: str, message_type: str,
                      payload: BaseModel, causation_id: UUID | None = None) -> None: ...
```

### 4. RoomEventWiring

胶水模块，连接所有组件：

```python
class RoomEventWiring:
    def __init__(self, bus: EventBus):
        self._bus = bus
        self._handlers: dict[str, RoomEventHandler] = {}

    async def register(self, handler: RoomEventHandler) -> None:
        self._handlers[handler.contract.room_name] = handler
        for msg_type in handler.contract.consumes:
            await self._bus.subscribe(msg_type, handler.handle)

    async def publish(self, room_name: str, message_type: str,
                      payload: BaseModel, causation_id: UUID | None = None) -> None:
        sender = f"room:{room_name}"
        recipients = self._resolve_recipients(message_type)
        envelope = MessageEnvelope(
            sender=sender,
            recipients=recipients,
            message_type=message_type,
            payload=payload.model_dump(),
        )
        if causation_id is not None:
            envelope.causation_id = causation_id
        await self._bus.publish(envelope)

    def _resolve_recipients(self, message_type: str) -> list[str]:
        return [
            f"room:{h.contract.room_name}"
            for h in self._handlers.values()
            if message_type in h.contract.consumes
        ]
```

## 各室 EventHandler 映射

| 室 | 产出事件 | 消费事件 | handle() 行为 |
|:---|:---|:---|:---|
| Meeting | `deliberation.proposal`, `deliberation.dissent` | 无 | 空操作（纯产出者） |
| Strategy | `strategy.decode_result` | 无 | 空操作（纯产出者） |
| Decision | `decision.response`, `task.order` | `deliberation.proposal`, `deliberation.dissent`, `strategy.decode_result`, `decision.request`, `task.failure` | 转译为 `submit()` / `cascade()` 调用 |
| Office | `task.status_update`, `task.failure` | `decision.response`, `task.order` | 转译为 `submit_task()` / `execute_workflow()` 调用 |
| Summary | `summary.insight` | `decision.response`, `task.status_update`, `summary.review_request`, `harness.evaluation_result` | 转译为 `start_review()` / `generate_insights()` 调用 |
| Secretary | `secretary.notification` | `decision.response`, `summary.insight` | 转译为 `notify()` / `filter_decision()` 调用 |

## 文件结构

新增文件（不修改现有文件）：

```
src/cabinet/
├── core/
│   └── events/
│       ├── protocol.py          # 已有 EventBus（不变）
│       ├── asyncio_bus.py       # 已有（不变）
│       ├── store.py             # 已有（不变）
│       └── wiring.py            # 新增：EventContract + RoomEventHandler + RoomEventPublisher + RoomEventWiring
├── models/
│   └── events.py                # 扩展：新增 secretary.notification + SecretaryNotification payload
└── rooms/
    ├── meeting/
    │   └── event_handler.py     # 新增
    ├── strategy/
    │   └── event_handler.py     # 新增
    ├── decision/
    │   └── event_handler.py     # 新增
    ├── office/
    │   └── event_handler.py     # 新增
    ├── summary/
    │   └── event_handler.py     # 新增
    └── secretary/
        └── event_handler.py     # 新增
```

## Payload 模型扩展

在 `models/events.py` 中新增：

```python
class MessageType(str, Enum):
    # ... 已有 11 种 ...
    SECRETARY_NOTIFICATION = "secretary.notification"

class SecretaryNotification(BaseModel):
    captain_id: str
    notification_type: str
    content: str
    severity: Literal["info", "warning", "critical"]
    related_decision_id: UUID | None = None
```

## 错误处理

| 场景 | 策略 |
|:---|:---|
| EventHandler 抛异常 | 捕获并记录，不中断事件链；EventBus 继续投递给下一个 handler |
| 发布事件失败 | 抛出 `EventPublishError`，由室服务决定是否重试 |
| 未知 message_type | 静默忽略（无 handler 订阅） |
| Payload 解析失败 | 记录警告，跳过该事件 |

## 测试策略

| 层级 | 测试内容 |
|:---|:---|
| 单元测试 | 每个 EventHandler 的 `handle()` 方法、EventContract 声明、RoomEventWiring 的 `publish()` 和 `_resolve_recipients()` |
| 契约测试 | 验证每个室的 EventContract 与实际产出/消费一致 |
| 集成测试 | 完整事件链路验证（见下方场景） |
| 回归测试 | 现有 209 个测试全部通过 |

### 集成测试核心场景

1. **完整决策链路**：会议室产出 proposal → 决策室收到并创建 Decision → 决策室产出 response → 办公室收到并创建 Task → 办公室产出 status_update → 总结室收到
2. **异常链路**：办公室产出 task.failure → 决策室收到并触发升级
3. **秘书通知链路**：决策室产出 response → 秘书收到并通知 Captain
4. **因果链追溯**：从最终事件回溯到最初触发事件，验证 causation_id 链完整
