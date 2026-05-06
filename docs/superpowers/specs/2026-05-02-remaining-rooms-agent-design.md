# 剩余 4 室 Agent 化设计

> 基于 Brainstorming 技能产出，2026-05-02

## 关键决策

| 决策 | 选择 | 理由 |
|:---|:---|:---|
| 改造范围 | 4 室一次性完成（Strategy + Decision + Office + Summary） | 与秘书+会议室改造方式保持一致，减少重复设计 |
| 改造策略 | 渐进式——仅改业务方法，_apply_event 不动 | 事件溯源三规则不变，降低风险 |
| 角色分配 | 复用现有 6 个 DEFAULT_ROLE_PROMPTS，不新增角色 | strategist/evaluator/executor/secretary 已覆盖 4 室需求 |
| 向后兼容 | StubAgentFactory 注入时行为与改造前一致 | 397 现有测试不受影响 |
| 可选 LLM | 关键方法增加可选参数，显式传入时跳过 LLM 调用 | 与会议室 add_perspective(content=None) 模式一致 |

## 架构

```
Captain
  │
  ▼
SecretaryAgentService (已 Agent 化)
  │
  ├──→ MeetingRoomService (已 Agent 化)
  │        │
  │        └── deliberation.proposal 事件
  │
  ├──→ StrategyDecoderService ← 本次改造
  │        │
  │        ├── decode() → strategist Agent → ActionBlueprint
  │        ├── validate_blueprint() → evaluator Agent → BlueprintValidation
  │        │
  │        └── strategy.decode_result 事件
  │
  ├──→ DecisionRoomService ← 本次改造
  │        │
  │        ├── submit() → evaluator Agent → 丰富描述 + 评估紧急度
  │        ├── check_authorization() → evaluator Agent → 复杂条件评估
  │        ├── get_dashboard() → secretary Agent → 决策卡摘要
  │        ├── cascade() → strategist Agent → 拆解决策
  │        │
  │        └── decision.response / task.order 事件
  │
  ├──→ OfficeSchedulerService ← 本次改造
  │        │
  │        ├── execute_workflow() → executor Agent → 执行工作流节点
  │        ├── check_permission() → evaluator Agent → 权限等级评估
  │        │
  │        └── task.status_update / task.failure 事件
  │
  └──→ SummaryRoomService ← 本次改造
           │
           ├── generate_insights() → evaluator Agent → 洞察生成
           ├── build_decision_tree() → evaluator Agent → 决策树构建
           ├── suggest_improvements() → evaluator Agent → 改进建议
           ├── audit_authorization_usage() → evaluator Agent → 授权审计
           │
           └── summary.insight 事件
```

## Strategy Decoder Agent 化

### decode() 改造

当前 Stub：
```python
async def decode(self, proposal, context):
    event = BlueprintDecoded(
        blueprint_id=blueprint_id,
        proposal_session_id=proposal.session_id,
        action_domains=["primary"],        # 硬编码
        constraints=["budget"],             # 硬编码
        success_criteria=["revenue increase"], # 硬编码
    )
```

改造后：
```python
async def decode(self, proposal, context):
    agent = await self._agent_factory.create_agent(uuid4(), "strategist")
    agent_context = AgentContext(model="default", temperature=0.5)
    output = await agent.execute(
        f"Transform the following proposal into a structured action blueprint.\n\n"
        f"Proposal: {proposal.proposal_text}\n"
        f"Source Session: {proposal.session_id}\n"
        f"Project: {context.project_id}\n"
        f"Existing Constraints: {context.existing_constraints}\n\n"
        f"Provide:\n"
        f"1. Action domains (list of domain names)\n"
        f"2. Constraints (list of constraint descriptions)\n"
        f"3. Success criteria (list of measurable criteria)",
        agent_context,
    )
    # 解析 LLM 输出为结构化数据
    action_domains, constraints, success_criteria = self._parse_blueprint_output(output.content)
    event = BlueprintDecoded(
        blueprint_id=blueprint_id,
        proposal_session_id=proposal.session_id,
        action_domains=action_domains,
        constraints=constraints,
        success_criteria=success_criteria,
    )
```

### validate_blueprint() 改造

当前 Stub：
```python
async def validate_blueprint(self, blueprint):
    event = BlueprintValidated(
        blueprint_id=blueprint.id,
        is_valid=True,              # 永远 True
        validation_notes=["validated"], # 固定
    )
```

改造后：
```python
async def validate_blueprint(self, blueprint):
    agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
    context = AgentContext(model="default", temperature=0.3)
    domains_text = "\n".join(f"- {d.name}: {d.goal}" for d in blueprint.domains)
    output = await agent.execute(
        f"Validate this action blueprint:\n\n"
        f"Domains:\n{domains_text}\n"
        f"Constraints: {blueprint.global_constraints}\n"
        f"Execution Order: {blueprint.execution_order}\n\n"
        f"Check: 1) Domain completeness 2) Dependency resolution 3) Criteria measurability\n"
        f"Respond with: VALID or INVALID, followed by specific issues.",
        context,
    )
    is_valid, notes = self._parse_validation_output(output.content)
    event = BlueprintValidated(
        blueprint_id=blueprint.id,
        is_valid=is_valid,
        validation_notes=notes,
    )
```

### 辅助解析方法

```python
@staticmethod
def _parse_blueprint_output(content: str) -> tuple[list[str], list[str], list[str]]:
    # 简单策略：按行分割，识别关键词
    action_domains, constraints, success_criteria = [], [], []
    current = None
    for line in content.split("\n"):
        line = line.strip().lstrip("- ").lstrip("0123456789. ")
        if not line:
            continue
        lower = line.lower()
        if "domain" in lower and "action" in lower:
            current = "domains"
        elif "constraint" in lower:
            current = "constraints"
        elif "criterion" in lower or "criteria" in lower or "success" in lower:
            current = "criteria"
        elif current == "domains":
            action_domains.append(line)
        elif current == "constraints":
            constraints.append(line)
        elif current == "criteria":
            success_criteria.append(line)
    # 兜底：如果解析失败，使用默认值
    if not action_domains:
        action_domains = ["primary"]
    if not constraints:
        constraints = ["budget"]
    if not success_criteria:
        success_criteria = ["revenue increase"]
    return action_domains, constraints, success_criteria

@staticmethod
def _parse_validation_output(content: str) -> tuple[bool, list[str]]:
    is_valid = "INVALID" not in content.upper()[:50]
    notes = [line.strip().lstrip("- ") for line in content.split("\n") if line.strip()]
    if not notes:
        notes = ["validated"]
    return is_valid, notes
```

## Decision Room Agent 化

### submit() 改造

当前 Stub：
```python
async def submit(self, request):
    event = DecisionSubmitted(
        captain_id="system",          # 硬编码
        description=request.title,     # 直接用 title
    )
```

改造后：
```python
async def submit(self, request):
    agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
    context = AgentContext(model="default", temperature=0.3)
    output = await agent.execute(
        f"Analyze this decision request and provide:\n"
        f"1. An enriched description\n"
        f"2. Urgency assessment (red/yellow/blue/white)\n\n"
        f"Title: {request.title}\n"
        f"Type: {request.decision_type}\n"
        f"Options: {request.options}",
        context,
    )
    description = output.content
    event = DecisionSubmitted(
        decision_id=request.decision_id,
        project_id=uuid4(),
        decision_type=DecisionType(request.decision_type),
        title=request.title,
        description=description,
        options=request.options,
        captain_id=request.captain_id if hasattr(request, "captain_id") and request.captain_id else "system",
        source_event_id=None,
    )
```

### check_authorization() 改造

当前实现仅匹配 `auto_approve` 标志。改造后保留规则快速路径，增加 LLM 评估：

```python
async def check_authorization(self, decision):
    # 快速路径：规则匹配
    for rule in self._rules.values():
        if rule.decision_type == decision.decision_type and rule.auto_approve:
            return AuthorizationVerdict(
                auto_process=True,
                requires_captain=False,
                reason="matched auto-approve rule",
                matched_rule=rule.id,
            )
    # LLM 评估：复杂条件
    agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
    context = AgentContext(model="default", temperature=0.2)
    rules_text = "\n".join(
        f"- {rule.decision_type.value}: auto_approve={rule.auto_approve}, conditions={rule.conditions}"
        for rule in self._rules.values()
    )
    output = await agent.execute(
        f"Evaluate authorization for this decision:\n\n"
        f"Decision Type: {decision.decision_type.value}\n"
        f"Title: {decision.title}\n"
        f"Description: {decision.description}\n\n"
        f"Existing Rules:\n{rules_text if rules_text else 'No rules defined'}\n\n"
        f"Should this be auto-processed or require Captain's attention?",
        context,
    )
    auto_process = "auto" in output.content.lower() and "captain" not in output.content.lower()[:100]
    return AuthorizationVerdict(
        auto_process=auto_process,
        requires_captain=not auto_process,
        reason=output.content[:200],
    )
```

### get_dashboard() 改造

当前 Stub：`source_room="unknown"`, `created_ago="just now"`。

改造后：使用 secretary Agent 为每张决策卡生成摘要。

```python
async def get_dashboard(self, project_id):
    pending = [d for d in self._decisions.values() if d.status == DecisionStatus.PENDING]
    if pending:
        agent = await self._agent_factory.create_agent(uuid4(), "secretary")
        context = AgentContext(model="default", temperature=0.5)
        decisions_text = "\n".join(
            f"- [{d.urgency}] {d.title}: {d.description[:100]}"
            for d in pending
        )
        output = await agent.execute(
            f"Summarize these pending decisions for Captain's dashboard:\n\n{decisions_text}\n\n"
            f"For each decision, provide a one-line summary and identify the source room.",
            context,
        )
        # 使用 LLM 输出增强卡片信息
        cards = self._build_cards_with_summary(pending, output.content)
    else:
        cards = []
    return DecisionDashboard(
        project_id=project_id,
        red_cards=[c for c in cards if c.urgency_color == "red"],
        yellow_cards=[c for c in cards if c.urgency_color == "yellow"],
        blue_cards=[c for c in cards if c.urgency_color == "blue"],
        white_cards=[c for c in cards if c.urgency_color == "white"],
        total_pending=len(pending),
    )
```

### cascade() 改造

当前 Stub：创建单个硬编码子决策。

改造后：使用 strategist Agent 分析如何拆解决策。

```python
async def cascade(self, decision):
    agent = await self._agent_factory.create_agent(uuid4(), "strategist")
    context = AgentContext(model="default", temperature=0.5)
    output = await agent.execute(
        f"This decision needs to be broken down into sub-decisions:\n\n"
        f"Title: {decision.title}\n"
        f"Type: {decision.decision_type.value}\n"
        f"Description: {decision.description}\n"
        f"Options: {decision.options}\n\n"
        f"Propose 2-4 sub-decisions, each with a title and type.",
        context,
    )
    child_titles = self._parse_cascade_output(output.content)
    child_ids = [uuid4() for _ in child_titles]
    # ... 创建子决策事件
```

## Office Agent 化

### execute_workflow() 改造

当前 Stub：仅创建 `WorkflowStarted` 事件就返回。

改造后：使用 executor Agent 执行工作流节点。

```python
async def execute_workflow(self, workflow_id, inputs):
    execution_id = uuid4()
    project_id = inputs.get("project_id", uuid4()) if isinstance(inputs.get("project_id"), UUID) else uuid4()
    event = WorkflowStarted(
        execution_id=execution_id,
        workflow_id=workflow_id,
        project_id=project_id,
    )
    await self._publish_and_apply(event)

    agent = await self._agent_factory.create_agent(uuid4(), "executor")
    context = AgentContext(model="default", temperature=0.3)
    output = await agent.execute(
        f"Execute workflow {workflow_id} with inputs: {inputs}\n\n"
        f"Describe the execution plan and first step results.",
        context,
    )

    node_id = uuid4()
    node_event = WorkflowNodeCompleted(
        execution_id=execution_id,
        node_id=node_id,
        result={"output": output.content},
    )
    await self._publish_and_apply(node_event)

    complete_event = WorkflowCompleted(
        execution_id=execution_id,
        results={"default": {"output": output.content}},
    )
    await self._publish_and_apply(complete_event)
    return self._executions[execution_id]
```

### check_permission() 改造

当前 Stub：永远 `allowed=True, level=L1, reason="default allow"`。

改造后：使用 evaluator Agent 评估权限等级。

```python
async def check_permission(self, employee_id, action):
    agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
    context = AgentContext(model="default", temperature=0.2)
    output = await agent.execute(
        f"Evaluate permission for:\n\n"
        f"Employee: {employee_id}\n"
        f"Action: {action}\n\n"
        f"Determine: 1) Is this allowed? 2) What permission level (L0-L3)? 3) Reasoning",
        context,
    )
    allowed = "not allowed" not in output.content.lower()[:50]
    level = self._parse_permission_level(output.content)
    return PermissionVerdict(
        allowed=allowed,
        level=level,
        reason=output.content[:200],
    )
```

## Summary Room Agent 化

### generate_insights() 改造

当前 Stub：固定 `content="auto-generated insight"`, `confidence=0.7`。

改造后：使用 evaluator Agent 从审查数据中生成洞察。

```python
async def generate_insights(self, session_id):
    if session_id not in self._sessions:
        raise KeyError(f"session {session_id} not found")
    session = self._sessions[session_id]

    agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
    context = AgentContext(model="default", temperature=0.7)
    output = await agent.execute(
        f"Generate insights for a {session.review_type.value} review session.\n\n"
        f"Session ID: {session_id}\n"
        f"Project: {session.project_id}\n\n"
        f"Provide 2-4 insights, each with: type, content, confidence (0-1), "
        f"whether auto-applicable, and whether it requires Captain's attention.",
        context,
    )
    insights = self._parse_insights_output(output.content, session_id)
    event = InsightsGenerated(session_id=session_id, insights=insights)
    await self._publish_and_apply(event)
    return self._insights[session_id]
```

### build_decision_tree() 改造

当前 Stub：单节点空树。

改造后：使用 evaluator Agent 从决策历史构建决策树。

```python
async def build_decision_tree(self, project_id):
    agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
    context = AgentContext(model="default", temperature=0.5)
    output = await agent.execute(
        f"Build a decision tree for project {project_id}.\n\n"
        f"Describe the tree structure with nodes and their relationships. "
        f"Each node should have: type (root/branch/decision/execution/anomaly/external), "
        f"label, and children.",
        context,
    )
    tree = self._parse_tree_output(output.content, project_id)
    event = DecisionTreeBuilt(project_id=project_id, tree=tree)
    await self._publish_and_apply(event)
    return self._trees.get(project_id, tree)
```

### suggest_improvements() 改造

当前 Stub：固定 `description="optimize pipeline"`。

改造后：使用 evaluator Agent 分析并建议改进。

```python
async def suggest_improvements(self, session_id):
    if session_id not in self._sessions:
        raise KeyError(f"session {session_id} not found")

    agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
    context = AgentContext(model="default", temperature=0.7)
    output = await agent.execute(
        f"Based on review session {session_id}, suggest improvements.\n\n"
        f"Provide 2-4 suggestions, each with: category (skill/workflow/authorization/knowledge), "
        f"description, impact (low/medium/high), effort (low/medium/high), "
        f"and whether auto-applicable.",
        context,
    )
    suggestions = self._parse_suggestions_output(output.content, session_id)
    event = ImprovementsSuggested(session_id=session_id, suggestions=suggestions)
    await self._publish_and_apply(event)
    return self._suggestions[session_id]
```

### audit_authorization_usage() 改造

当前 Stub：全零审计结果。

改造后：使用 evaluator Agent 分析授权使用模式。

```python
async def audit_authorization_usage(self, captain_id):
    agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
    context = AgentContext(model="default", temperature=0.3)
    output = await agent.execute(
        f"Audit authorization usage for Captain {captain_id}.\n\n"
        f"Analyze: 1) Total decisions made 2) How many manually approved "
        f"3) How many could have been auto-processed 4) Suggestions for improvement.",
        context,
    )
    audit = self._parse_audit_output(output.content, captain_id)
    event = AuthorizationAudited(captain_id=captain_id, audit=audit)
    await self._publish_and_apply(event)
    return self._audits.get(captain_id, audit)
```

## 解析策略

LLM 输出解析采用**简单兜底策略**：

1. 每个室服务增加私有 `_parse_*` 方法
2. 解析失败时回退到当前 Stub 默认值（保证向后兼容）
3. 后续可通过结构化输出（JSON mode）改进解析精度

这与会议室 `cross_validate` 的解析策略一致：当前阶段使用简单策略，后续迭代改进。

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|:---|:---|:---|
| `src/cabinet/rooms/strategy/service.py` | 修改 | decode/validate_blueprint 调用 Agent + _parse 辅助方法 |
| `src/cabinet/rooms/decision/service.py` | 修改 | submit/check_authorization/get_dashboard/cascade 调用 Agent + _parse 辅助方法 |
| `src/cabinet/rooms/office/service.py` | 修改 | execute_workflow/check_permission 调用 Agent + _parse 辅助方法 |
| `src/cabinet/rooms/summary/service.py` | 修改 | generate_insights/build_decision_tree/suggest_improvements/audit_authorization_usage 调用 Agent + _parse 辅助方法 |
| `tests/unit/rooms/strategy/test_service.py` | 修改 | 更新为真实 StubAgentFactory |
| `tests/unit/rooms/decision/test_service.py` | 修改 | 更新为真实 StubAgentFactory |
| `tests/unit/rooms/office/test_service.py` | 修改 | 更新为真实 StubAgentFactory |
| `tests/unit/rooms/summary/test_service.py` | 修改 | 更新为真实 StubAgentFactory |

## 测试策略

| 测试类型 | 方式 | 说明 |
|:---|:---|:---|
| 现有单元测试 | StubAgentFactory | 397 现有测试不受影响 |
| 测试文件升级 | 真实 StubAgentFactory | 4 室测试文件中的本地 Stub 替换为真实 StubAgentFactory |
| Agent 集成测试 | MockGateway | 可选：验证 Agent 调用正确性 |

## 向后兼容保证

1. **StubAgentFactory 注入时**：StubAgent 返回 `"Stub response for {role}: {task}"` 格式字符串，_parse 方法解析失败时回退到默认值，行为与改造前一致
2. **LLMAgentFactory 注入时**：Agent 调用真实 LLM，_parse 方法解析 LLM 输出
3. **CabinetRuntime 默认**：仍使用 StubAgentFactory，所有测试不受影响
4. **CLI chat 命令**：已使用 LLMAgentFactory，4 室改造后自动获得 LLM 能力
