# Layer 3 室服务实现设计

## 概述

本文档定义 Layer 3 六个室的服务实现架构。在协议层（Protocol + Models + EventHandler + 跨室事件布线）已完成的基础上，为每个室添加事件溯源驱动的业务逻辑实现，使系统从"骨架"变为"活体"。

## 架构决策

| 决策项 | 选择 | 理由 |
|:---|:---|:---|
| 实现策略 | 顺序实现（按事件流方向） | 每步可验证事件链路，风险低 |
| LLM 集成 | 通过 Agent/Skill 层 | 解耦室服务与 LLM，利用已有 SkillExecutor |
| 状态管理 | 事件溯源 | 完整审计链，状态可重建 |
| 事件模型 | 双事件模型（域事件 + 跨室事件） | 关注点分离，域事件细粒度，跨室事件零改动 |
| 代码组织 | EventSourcedRoom 抽象基类 | 消除重复，强制三条规则 |
| 跨室事件触发 | _apply_event 返回跨室事件列表 | _apply_event 保持同步，职责清晰 |

## 事件溯源三条规则

### 规则一：状态只能通过 _apply_event 修改

所有室服务的内部状态（字典、列表、属性）不允许在 `_apply_event` 之外被直接赋值。`submit`、`approve`、`reject` 等命令方法只能做两件事：一是验证命令合法性，二是创建域事件对象并调用 `_publish_and_apply`。状态变更是 `_apply_event` 的唯一职责。

### 规则二：事件发布与状态更新必须原子化

一个命令方法要么成功（事件已存储、状态已更新），要么失败（事件未存储、状态未变更）。实现上，先 append 域事件到 RoomEventStore（持久化），再调用 `_apply_event` 更新内存状态。如果 `_apply_event` 失败，事件已存储但可被标记为"处理失败"——这比"静默不一致"更容易发现和修复。

### 规则三：每个室服务都必须有 restore_from_events 方法

这个方法从 RoomEventStore 获取该室的所有历史域事件，按顺序回放 `_apply_event`，重建完整的内存状态。室服务初始化时调用此方法。

## 核心组件

### RoomEventStore

每个室服务持有一个独立的 `RoomEventStore`，负责域事件的存储和检索。

```python
from uuid import UUID
from pydantic import BaseModel
from typing import TypeVar, Type

T = TypeVar("T", bound=BaseModel)

class RoomEventStore:
    def __init__(self, room_name: str):
        self._room_name = room_name
        self._events: list[BaseModel] = []

    @property
    def room_name(self) -> str:
        return self._room_name

    def append(self, event: BaseModel) -> None:
        self._events.append(event)

    def get_all(self) -> list[BaseModel]:
        return list(self._events)

    def get_by_type(self, event_type: Type[T]) -> list[T]:
        return [e for e in self._events if isinstance(e, event_type)]

    def clear(self) -> None:
        self._events.clear()
```

### EventSourcedRoom 抽象基类

```python
from abc import ABC, abstractmethod
from uuid import UUID
from pydantic import BaseModel
from cabinet.core.events.wiring import RoomEventPublisher

class EventSourcedRoom(ABC):
    def __init__(self, store: RoomEventStore, publisher: RoomEventPublisher):
        self._store = store
        self._publisher = publisher

    @abstractmethod
    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]:
        """规则一：状态只能通过此方法修改。
        返回需要发布的跨室事件列表：[(message_type, payload, causation_id), ...]"""

    async def _publish_and_apply(self, event: BaseModel) -> None:
        """规则二：事件存储与状态更新原子化。
        先 append 到 store，再 _apply_event，最后发布跨室事件。"""
        self._store.append(event)
        cross_room_events = self._apply_event(event)
        for message_type, payload, causation_id in cross_room_events:
            await self._publisher.publish(
                room_name=self._store.room_name,
                message_type=message_type,
                payload=payload,
                causation_id=causation_id,
            )

    async def restore_from_events(self) -> None:
        """规则三：从事件存储回放所有域事件，重建内存状态。
        回放时只调用 _apply_event 更新内存状态，不发布跨室事件
        （跨室事件已在首次 _publish_and_apply 时发布过）。"""
        for event in self._store.get_all():
            self._apply_event(event)
```

### AgentFactory 协议

```python
@runtime_checkable
class AgentFactory(Protocol):
    async def create_agent(self, agent_id: UUID, role: str) -> BaseAgent: ...
    async def create_team(self, agents: list[BaseAgent], task: str) -> BaseTeam: ...
```

## 域事件定义

### 会议室 (MeetingRoom)

| 域事件 | 字段 | 触发跨室事件 |
|:---|:---|:---|
| SessionStarted | session_id, project_id, topic, level, participants | — |
| PerspectiveAdded | perspective_id, session_id, agent_id, content, round | — |
| CrossValidationCompleted | session_id, consensus, dissent, unresolved | deliberation.dissent（如有 dissent） |
| ConvergenceAchieved | session_id, proposal_text, confidence, reasoning_summary, convergence, rounds_used, rumination_detected | deliberation.proposal |
| ExpertWoken | session_id, expert_id | — |
| SessionClosed | session_id | — |

### 战略解码 (StrategyDecoder)

| 域事件 | 字段 | 触发跨室事件 |
|:---|:---|:---|
| BlueprintDecoded | blueprint_id, proposal_session_id, action_domains, constraints, success_criteria | strategy.decode_result |
| BlueprintValidated | blueprint_id, is_valid, validation_notes | — |

### 决策室 (DecisionRoom)

| 域事件 | 字段 | 触发跨室事件 |
|:---|:---|:---|
| DecisionSubmitted | decision_id, project_id, decision_type, title, description, options, captain_id, source_event_id | — |
| DecisionApproved | decision_id, chosen_option | decision.response；若 chosen_option 含 employee_id + skill_id 则同时触发 task.order |
| DecisionRejected | decision_id, reason | decision.response |
| DecisionDelegated | decision_id, delegate_to | decision.response |
| AuthorizationRuleSet | rule_id, captain_id, decision_type, auto_approve, conditions | — |
| DecisionCascaded | parent_decision_id, child_decision_ids | decision.response |

### 办公室 (OfficeScheduler)

| 域事件 | 字段 | 触发跨室事件 |
|:---|:---|:---|
| TaskSubmitted | task_id, project_id, employee_id, skill_id, inputs | — |
| TaskCancelled | task_id | task.status_update |
| TaskStatusChanged | task_id, old_status, new_status, progress | task.status_update |
| TaskFailed | task_id, error_message, retry_count | task.failure |
| WorkflowStarted | execution_id, workflow_id, project_id | — |
| WorkflowNodeCompleted | execution_id, node_id, result | — |
| WorkflowCompleted | execution_id, results | task.status_update |

### 总结室 (SummaryRoom)

| 域事件 | 字段 | 触发跨室事件 |
|:---|:---|:---|
| ReviewStarted | session_id, project_id, review_type | — |
| InsightsGenerated | session_id, insights | summary.insight |
| DecisionTreeBuilt | project_id, tree | — |
| ImprovementsSuggested | session_id, suggestions | — |
| AuthorizationAudited | captain_id, audit | — |

### 秘书 (SecretaryAgent)

| 域事件 | 字段 | 触发跨室事件 |
|:---|:---|:---|
| CaptainGreeted | captain_id, greeting_text | — |
| InputProcessed | captain_id, input_text, response_text | — |
| PendingSummarized | captain_id, summary_text | — |
| NotificationSent | captain_id, notification_type, content, severity | secretary.notification |
| DecisionFiltered | decision_id, filter_result | — |

## 室服务实现模式

每个室服务遵循相同的模式：

1. 继承 `EventSourcedRoom`
2. 实现对应的 Protocol 接口
3. 在 `__init__` 中声明内存状态（字典、列表等）
4. 实现 `_apply_event`，根据域事件类型更新状态并返回跨室事件列表
5. 实现命令方法，验证命令合法性后创建域事件并调用 `_publish_and_apply`
6. LLM 调用通过 `AgentFactory` 委托给 Agent/Skill 层

```python
class MeetingRoomService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: AgentFactory,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._sessions: dict[UUID, DeliberationSession] = {}
        self._perspectives: dict[UUID, list[Perspective]] = {}
        self._convergences: dict[UUID, ConvergenceResult] = {}

    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]:
        cross_room: list[tuple[str, BaseModel, UUID | None]] = []
        if isinstance(event, SessionStarted):
            self._sessions[event.session_id] = DeliberationSession(
                id=event.session_id,
                project_id=event.project_id,
                topic=event.topic,
                level=event.level,
                participants=event.participants,
            )
        elif isinstance(event, PerspectiveAdded):
            sid = event.session_id
            if sid not in self._perspectives:
                self._perspectives[sid] = []
            self._perspectives[sid].append(Perspective(
                id=event.perspective_id,
                session_id=sid,
                agent_id=event.agent_id,
                content=event.content,
                round=event.round,
            ))
        elif isinstance(event, ConvergenceAchieved):
            self._convergences[event.session_id] = ConvergenceResult(
                consensus=event.convergence.consensus,
                dissent=event.convergence.dissent,
                unresolved=event.convergence.unresolved,
            )
            cross_room.append((
                "deliberation.proposal",
                DeliberationProposal(
                    proposal_text=event.proposal_text,
                    confidence=event.confidence,
                    reasoning_summary=event.reasoning_summary,
                ),
                None,
            ))
        elif isinstance(event, CrossValidationCompleted):
            self._convergences[event.session_id] = ConvergenceResult(
                consensus=event.consensus,
                dissent=event.dissent,
                unresolved=event.unresolved,
            )
            if event.dissent:
                cross_room.append((
                    "deliberation.dissent",
                    DeliberationDissent(
                        dissent_text=event.dissent[0].content,
                        source_agent_id=event.dissent[0].agent_id,
                    ),
                    None,
                ))
        elif isinstance(event, ExpertWoken):
            if event.session_id in self._sessions:
                session = self._sessions[event.session_id]
                if event.expert_id not in session.experts:
                    session.experts.append(event.expert_id)
        elif isinstance(event, SessionClosed):
            if event.session_id in self._sessions:
                self._sessions[event.session_id].status = "closed"
        return cross_room

    async def start_session(self, topic: str, level: MeetingLevel,
                            participants: list[UUID]) -> DeliberationSession:
        session_id = uuid4()
        project_id = uuid4()
        event = SessionStarted(
            session_id=session_id,
            project_id=project_id,
            topic=topic,
            level=level,
            participants=participants,
        )
        await self._publish_and_apply(event)
        return self._sessions[session_id]

    async def add_perspective(self, session_id: UUID, agent_id: UUID,
                              content: str) -> Perspective:
        perspective_id = uuid4()
        session = self._sessions[session_id]
        event = PerspectiveAdded(
            perspective_id=perspective_id,
            session_id=session_id,
            agent_id=agent_id,
            content=content,
            round=session.round,
        )
        await self._publish_and_apply(event)
        return self._perspectives[session_id][-1]

    # ... 其他命令方法
```

## Agent/Skill 集成

各室通过 `AgentFactory` 获取 Agent 实例，将 LLM 调用委托给 Agent/Skill 层：

| 室 | Agent/Skill 用途 | 调用时机 |
|:---|:---|:---|
| 会议室 | 多 Agent 推理、视角生成、收敛判断 | add_perspective、converge |
| 战略解码 | 方案转化、蓝图验证 | decode、validate_blueprint |
| 决策室 | 决策分析、授权判断 | submit、check_authorization |
| 办公室 | 任务执行、工作流编排 | submit_task→执行、execute_workflow |
| 总结室 | 洞察生成、改进建议 | generate_insights、suggest_improvements |
| 秘书 | 自然语言理解、通知过滤 | process_input、filter_decision |

**关键原则：** Agent/Skill 调用发生在命令方法中（`_publish_and_apply` 之前），用于生成内容或做出判断。`_apply_event` 只做状态更新和跨室事件触发，不调用 LLM。

## 实现顺序

```
Phase 1: 基础设施
  EventSourcedRoom 基类 + RoomEventStore + AgentFactory 协议

Phase 2: 会议室 (纯产出者，无入站事件)
  MeetingRoomService + 域事件 + 测试

Phase 3: 战略解码 (纯产出者，无入站事件)
  StrategyDecoderService + 域事件 + 测试

Phase 4: 决策室 (核心消费者，接收3种入站事件)
  DecisionRoomService + 域事件 + 测试

Phase 5: 办公室 (执行出口)
  OfficeSchedulerService + 域事件 + 测试

Phase 6: 总结室 (学习层)
  SummaryRoomService + 域事件 + 测试

Phase 7: 秘书 (人机交互窗口)
  SecretaryAgentService + 域事件 + 测试

Phase 8: 端到端验证
  全链路集成测试 + 事件溯源恢复测试
```

## 测试策略

每个室服务遵循 TDD 流程：

1. **域事件测试** — 验证域事件模型可正确创建和序列化
2. **_apply_event 测试** — 验证每个域事件正确更新内存状态
3. **命令方法测试** — 验证命令方法创建正确的域事件并调用 _publish_and_apply
4. **跨室事件触发测试** — 验证 _apply_event 返回正确的跨室事件列表
5. **restore_from_events 测试** — 验证从事件存储回放可重建完整状态
6. **Agent/Skill 集成测试** — 验证室服务正确委托 LLM 调用（用 Mock AgentFactory）

## 文件组织

### 新增文件

```
src/cabinet/
├── core/events/
│   └── event_sourced.py              # EventSourcedRoom + RoomEventStore
├── agents/
│   └── protocol.py                   # 新增 AgentFactory 协议
├── rooms/
│   ├── meeting/
│   │   ├── domain_events.py          # 6个域事件
│   │   └── service.py                # MeetingRoomService
│   ├── strategy/
│   │   ├── domain_events.py          # 2个域事件
│   │   └── service.py                # StrategyDecoderService
│   ├── decision/
│   │   ├── domain_events.py          # 6个域事件
│   │   └── service.py                # DecisionRoomService
│   ├── office/
│   │   ├── domain_events.py          # 7个域事件
│   │   └── service.py                # OfficeSchedulerService
│   ├── summary/
│   │   ├── domain_events.py          # 5个域事件
│   │   └── service.py                # SummaryRoomService
│   └── secretary/
│       ├── domain_events.py          # 5个域事件
│       └── service.py                # SecretaryAgentService

tests/
├── unit/
│   ├── core/events/
│   │   └── test_event_sourced.py     # 基类 + RoomEventStore 测试
│   └── rooms/
│       ├── meeting/
│       │   ├── test_domain_events.py
│       │   └── test_service.py
│       ├── strategy/
│       │   ├── test_domain_events.py
│       │   └── test_service.py
│       ├── decision/
│       │   ├── test_domain_events.py
│       │   └── test_service.py
│       ├── office/
│       │   ├── test_domain_events.py
│       │   └── test_service.py
│       ├── summary/
│       │   ├── test_domain_events.py
│       │   └── test_service.py
│       └── secretary/
│           ├── test_domain_events.py
│           └── test_service.py
└── integration/
    └── test_room_services_integration.py
```

### 不修改的现有文件

- 所有 Protocol 文件（meeting/protocol.py 等）
- 所有 Models 文件（meeting/models.py 等）
- 所有 EventHandler 文件（meeting/event_handler.py 等）
- 跨室事件布线（core/events/wiring.py）
- 事件模型（models/events.py）

### 需修改的现有文件

- `agents/protocol.py` — 新增 AgentFactory 协议

## 与现有代码的关系

- 室服务实现其对应的 Protocol 接口（如 MeetingRoomService 实现 MeetingRoom）
- EventHandler 持有室服务实例（而非 Protocol），调用室服务的命令方法
- 跨室事件通过 RoomEventPublisher 发布，由 RoomEventWiring 路由
- 域事件与跨室事件完全解耦，互不影响
