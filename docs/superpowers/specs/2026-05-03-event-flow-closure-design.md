# 跨室事件流闭环 + 技术债清理 设计规格

日期: 2026-05-03

## 目标

1. 补全 StrategyEventHandler，打通 Meeting → Strategy → Decision 事件流管道
2. 清理所有 `pass` 占位符和技术债，消除空实现

## 范围

| 组件 | 变更类型 | 优先级 |
|------|----------|--------|
| StrategyEventHandler | 实现 handle() + 修改 contract | P0 |
| CabinetRuntime | 传入 strategy 依赖 + 实现 stop() | P0 |
| AsyncIOEventBus | 新增 unsubscribe() | P1 |
| RoomEventWiring | 新增 unregister_all() | P1 |
| SecretaryAgentService._apply_event | 填充 3 个空分支 | P1 |
| WorkflowEngine._execute_node (LoopNode) | 实现循环体迭代 | P2 |

**不在范围内：** MeetingEventHandler consumes 扩展（无业务需求驱动）、持久化层、MCP 集成

## 设计详情

### 1. StrategyEventHandler 消费 deliberation.proposal

**当前状态：** `handle()` 为 `pass`，`consumes=[]`

**目标状态：**

```python
class StrategyEventHandler:
    def __init__(self, room: StrategyDecoder):
        self._room = room

    @property
    def contract(self) -> EventContract:
        return EventContract(
            room_name="strategy",
            produces=["strategy.decode_result"],
            consumes=["deliberation.proposal"],
        )

    async def handle(self, envelope: MessageEnvelope) -> None:
        if envelope.message_type != "deliberation.proposal":
            return
        proposal = DeliberationProposal(**envelope.payload)
        deliberation_output = DeliberationOutput(
            session_id=envelope.correlation_id,
            proposal=DeliberationResult(
                session_id=envelope.correlation_id,
                proposal_text=proposal.proposal_text,
                confidence=proposal.confidence,
                reasoning_summary=proposal.reasoning_summary,
                convergence=ConvergenceResult(consensus="auto", dissent=[], unresolved=[]),
                rounds_used=0,
                rumination_detected=False,
            ),
        )
        context = DecodeContext(project_id=uuid4(), existing_constraints=[])
        await self._room.decode(deliberation_output, context)
```

**事件翻译映射：**

| DeliberationProposal 字段 | 目标类型 | 目标字段 |
|---------------------------|----------|----------|
| proposal_text | DeliberationResult | proposal_text |
| confidence | DeliberationResult | confidence |
| reasoning_summary | DeliberationResult | reasoning_summary |
| (envelope.correlation_id) | DeliberationOutput | session_id |

**关键决策：**
- `DecodeContext.project_id` 使用 `uuid4()` 默认值，因为跨房间事件不携带 project_id
- `DecodeContext.existing_constraints` 默认为空列表
- `ConvergenceResult` 使用默认值填充，因为跨房间事件不含收敛详情
- `strategy.decode()` 内部通过 `_publish_and_apply(BlueprintDecoded)` 自动发布 `strategy.decode_result` 跨房间事件

**CabinetRuntime 同步修改：**

```python
self._strategy_handler = StrategyEventHandler(self._strategy)
```

### 2. CabinetRuntime.stop() 资源清理

**当前状态：** `async def stop(self) -> None: pass`

**目标状态：**

```python
async def stop(self) -> None:
    await self._wiring.unregister_all()
```

**依赖变更：**

AsyncIOEventBus 新增 `unsubscribe()`:

```python
async def unsubscribe(self, event_type: str, handler: Callable) -> None:
    if event_type in self._subscriptions:
        self._subscriptions[event_type] = [
            h for h in self._subscriptions[event_type] if h != handler
        ]
```

RoomEventWiring 新增 `unregister_all()`:

```python
async def unregister_all(self) -> None:
    for handler in self._handlers.values():
        for msg_type in handler.contract.consumes:
            await self._bus.unsubscribe(msg_type, handler.handle)
    self._handlers.clear()
```

### 3. Secretary 空事件分支填充

**当前状态：** `InputProcessed`、`PendingSummarized`、`DecisionFiltered` 三个分支为 `pass`

**目标状态：**

新增内部状态：

```python
self._inputs: dict[str, list[str]] = {}
self._pending_summaries: dict[str, str] = {}
self._filtered_decisions: dict[UUID, FilterResult] = {}
```

_apply_event 填充：

```python
elif isinstance(event, InputProcessed):
    self._inputs.setdefault(event.captain_id, []).append(event.response_text)

elif isinstance(event, PendingSummarized):
    self._pending_summaries[event.captain_id] = event.summary_text

elif isinstance(event, DecisionFiltered):
    if event.filter_result is not None:
        self._filtered_decisions[event.decision_id] = event.filter_result
```

**关键决策：**
- 三个分支仅维护内部状态，不产出跨房间事件（与 NotificationSent 分支模式不同）
- `_inputs` 按 captain_id 索引，存储 response_text 列表（处理历史）
- `_pending_summaries` 按 captain_id 索引，存储最新摘要文本
- `_filtered_decisions` 按 decision_id 索引，存储过滤结果

### 4. LoopNode 循环体迭代执行

**当前状态：** 返回骨架数据，不执行循环体

**目标状态：**

```python
if isinstance(node, LoopNode):
    iteration_results = []
    for i, body_id in enumerate(node.body_node_ids):
        body_node = node_map.get(body_id)
        if body_node is None:
            continue
        iter_context = dict(context_data)
        iter_context["__loop_index__"] = i
        iter_context["__loop_total__"] = len(node.body_node_ids)
        result = await self._execute_node(body_node, iter_context, node_map, edge_map)
        iteration_results.append({"index": i, "output": result.output})
        context_data.update(result.output)
    return NodeResult(node.id, {
        "iterations": iteration_results,
        "total": len(node.body_node_ids),
    })
```

**关键决策：**
- 循环体节点按顺序执行（非并行），因为后续迭代可能依赖前序输出
- 每次迭代注入 `__loop_index__` 和 `__loop_total__` 到上下文
- 所有迭代的输出合并到 `context_data`，后续节点可访问
- 如果 body_node 不存在于 node_map 中，跳过（不抛异常）

## 向后兼容性

| 变更 | 兼容性影响 |
|------|-----------|
| StrategyEventHandler 消费 deliberation.proposal | 新增消费，不影响现有 DecisionEventHandler 对同一事件的消费 |
| CabinetRuntime.stop() | 原为空实现，新增逻辑不破坏现有行为 |
| Secretary 空分支填充 | 纯新增状态，不改变现有事件流 |
| LoopNode 执行 | 替换骨架为真实执行，返回结构变更（从 note 字段变为 iterations 字段） |

## 测试策略

每个变更遵循 TDD：

1. **StrategyEventHandler** — 测试消费 deliberation.proposal 并调用 decode()；测试忽略未知事件
2. **CabinetRuntime.stop()** — 测试 stop 后 handler 不再接收事件
3. **Secretary 空分支** — 测试 _apply_event 后状态正确更新
4. **LoopNode** — 测试循环体按序执行，上下文注入正确，输出合并正确
