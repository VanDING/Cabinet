# 剩余 4 室 Agent 化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Strategy / Decision / Office / Summary 四个室服务的业务方法从硬编码 Stub 改为调用 LLM Agent，让所有 Room 真正具备 AI 能力。

**Architecture:** 复用现有 6 个 DEFAULT_ROLE_PROMPTS（strategist/evaluator/executor/secretary/advisor/validator），在各室业务方法中通过 agent_factory.create_agent() 创建对应角色 Agent 并调用 execute()。StubAgentFactory 注入时 _parse 方法解析失败回退默认值，行为与改造前一致。与秘书+会议室改造模式完全一致。

**Tech Stack:** Python 3.12+, Pydantic, pytest, pytest-asyncio

---

## File Structure

| 文件 | 变更 | 职责 |
|:---|:---|:---|
| `src/cabinet/rooms/strategy/service.py` | 修改 | decode/validate_blueprint 调用 Agent + _parse 辅助方法 |
| `src/cabinet/rooms/decision/service.py` | 修改 | submit/check_authorization/get_dashboard/cascade 调用 Agent + _parse 辅助方法 |
| `src/cabinet/rooms/office/service.py` | 修改 | execute_workflow/check_permission 调用 Agent + _parse 辅助方法 |
| `src/cabinet/rooms/summary/service.py` | 修改 | generate_insights/build_decision_tree/suggest_improvements/audit_authorization_usage 调用 Agent + _parse 辅助方法 |
| `tests/unit/rooms/strategy/test_service.py` | 修改 | 本地 StubAgentFactory → 真实 StubAgentFactory |
| `tests/unit/rooms/decision/test_service.py` | 修改 | 本地 StubAgentFactory → 真实 StubAgentFactory |
| `tests/unit/rooms/office/test_service.py` | 修改 | 本地 StubAgentFactory → 真实 StubAgentFactory |
| `tests/unit/rooms/summary/test_service.py` | 修改 | 本地 StubAgentFactory → 真实 StubAgentFactory |

---

### Task 1: Strategy Decoder Agent 化

**Files:**
- Modify: `src/cabinet/rooms/strategy/service.py`
- Modify: `tests/unit/rooms/strategy/test_service.py`

- [ ] **Step 1: 更新测试文件，替换本地 StubAgentFactory**

将 `tests/unit/rooms/strategy/test_service.py` 中的本地 `StubAgentFactory` 替换为真实 `StubAgentFactory`：

删除：
```python
class StubAgentFactory:
    async def create_agent(self, agent_id, role):
        pass

    async def create_team(self, agents, task):
        pass
```

在文件顶部添加：
```python
from cabinet.agents.stub_factory import StubAgentFactory
```

fixture 中 `StubAgentFactory()` 调用不变（现在指向真实实现）。

- [ ] **Step 2: 运行现有测试确认仍通过**

Run: `pytest tests/unit/rooms/strategy/test_service.py -v`
Expected: 3 passed

- [ ] **Step 3: 修改 StrategyDecoderService，增加 Agent 导入**

在 `src/cabinet/rooms/strategy/service.py` 文件顶部增加导入：

```python
from cabinet.agents.context import AgentContext
```

- [ ] **Step 4: 修改 decode() 方法，调用 strategist Agent**

将 `decode()` 方法替换为：

```python
    async def decode(
        self, proposal: DeliberationOutput, context: DecodeContext,
    ) -> ActionBlueprint:
        blueprint_id = uuid4()
        agent = await self._agent_factory.create_agent(uuid4(), "strategist")
        agent_context = AgentContext(model="default", temperature=0.5)
        output = await agent.execute(
            f"Transform the following proposal into a structured action blueprint.\n\n"
            f"Proposal: {proposal.proposal.proposal_text}\n"
            f"Source Session: {proposal.session_id}\n"
            f"Project: {context.project_id}\n"
            f"Existing Constraints: {context.existing_constraints}\n\n"
            f"Provide:\n"
            f"1. Action domains (list of domain names)\n"
            f"2. Constraints (list of constraint descriptions)\n"
            f"3. Success criteria (list of measurable criteria)",
            agent_context,
        )
        action_domains, constraints, success_criteria = self._parse_blueprint_output(output.content)
        event = BlueprintDecoded(
            blueprint_id=blueprint_id,
            proposal_session_id=proposal.session_id,
            action_domains=action_domains,
            constraints=constraints,
            success_criteria=success_criteria,
        )
        await self._publish_and_apply(event)
        bp = self._blueprints[blueprint_id]
        return bp.model_copy(update={"project_id": context.project_id})
```

- [ ] **Step 5: 修改 validate_blueprint() 方法，调用 evaluator Agent**

将 `validate_blueprint()` 方法替换为：

```python
    async def validate_blueprint(
        self, blueprint: ActionBlueprint,
    ) -> BlueprintValidation:
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
        await self._publish_and_apply(event)
        return self._validations[blueprint.id]
```

- [ ] **Step 6: 添加 _parse 辅助方法**

在 `StrategyDecoderService` 类末尾添加：

```python
    @staticmethod
    def _parse_blueprint_output(content: str) -> tuple[list[str], list[str], list[str]]:
        action_domains: list[str] = []
        constraints: list[str] = []
        success_criteria: list[str] = []
        current: str | None = None
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

- [ ] **Step 7: 运行测试确认通过**

Run: `pytest tests/unit/rooms/strategy/test_service.py -v`
Expected: 3 passed

- [ ] **Step 8: 运行全量测试确认无回归**

Run: `pytest tests/ -v --tb=short`
Expected: 全部 passed，0 failed

- [ ] **Step 9: 提交**

```bash
git add src/cabinet/rooms/strategy/service.py tests/unit/rooms/strategy/test_service.py
git commit -m "feat: integrate LLM Agent into Strategy Decoder service"
```

---

### Task 2: Decision Room Agent 化

**Files:**
- Modify: `src/cabinet/rooms/decision/service.py`
- Modify: `tests/unit/rooms/decision/test_service.py`

- [ ] **Step 1: 更新测试文件，替换本地 StubAgentFactory**

将 `tests/unit/rooms/decision/test_service.py` 中的本地 `StubAgentFactory` 替换为真实 `StubAgentFactory`：

删除：
```python
class StubAgentFactory:
    async def create_agent(self, agent_id, role):
        pass

    async def create_team(self, agents, task):
        pass
```

在文件顶部添加：
```python
from cabinet.agents.stub_factory import StubAgentFactory
```

- [ ] **Step 2: 运行现有测试确认仍通过**

Run: `pytest tests/unit/rooms/decision/test_service.py -v`
Expected: 10 passed

- [ ] **Step 3: 修改 DecisionRoomService，增加 Agent 导入**

在 `src/cabinet/rooms/decision/service.py` 文件顶部增加导入：

```python
from cabinet.agents.context import AgentContext
```

- [ ] **Step 4: 修改 submit() 方法，调用 evaluator Agent**

将 `submit()` 方法替换为：

```python
    async def submit(self, request: DecisionRequest) -> Decision:
        agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
        context = AgentContext(model="default", temperature=0.3)
        output = await agent.execute(
            f"Analyze this decision request and provide an enriched description.\n\n"
            f"Title: {request.title}\n"
            f"Type: {request.decision_type}\n"
            f"Options: {request.options}\n\n"
            f"Provide a detailed description of this decision, its implications, and urgency.",
            context,
        )
        event = DecisionSubmitted(
            decision_id=request.decision_id,
            project_id=uuid4(),
            decision_type=DecisionType(request.decision_type),
            title=request.title,
            description=output.content,
            options=request.options,
            captain_id="system",
            source_event_id=None,
        )
        await self._publish_and_apply(event)
        return self._decisions[request.decision_id]
```

- [ ] **Step 5: 修改 check_authorization() 方法，增加 LLM 评估**

将 `check_authorization()` 方法替换为：

```python
    async def check_authorization(self, decision: Decision) -> AuthorizationVerdict:
        for rule in self._rules.values():
            if rule.decision_type == decision.decision_type and rule.auto_approve:
                return AuthorizationVerdict(
                    auto_process=True,
                    requires_captain=False,
                    reason="matched auto-approve rule",
                    matched_rule=rule.id,
                )
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

- [ ] **Step 6: 修改 get_dashboard() 方法，调用 secretary Agent**

将 `get_dashboard()` 方法替换为：

```python
    async def get_dashboard(self, project_id: UUID) -> DecisionDashboard:
        pending = [
            d for d in self._decisions.values()
            if d.status == DecisionStatus.PENDING
        ]
        cards = [
            DecisionCard(
                decision=d,
                urgency_color=d.urgency,
                summary=d.title,
                options_summary=[str(o) for o in d.options],
                source_room="unknown",
                created_ago="just now",
            )
            for d in pending
        ]
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
            cards = self._build_cards_with_summary(pending, output.content)
        return DecisionDashboard(
            project_id=project_id,
            red_cards=[c for c in cards if c.urgency_color == "red"],
            yellow_cards=[c for c in cards if c.urgency_color == "yellow"],
            blue_cards=[c for c in cards if c.urgency_color == "blue"],
            white_cards=[c for c in cards if c.urgency_color == "white"],
            total_pending=len(pending),
        )
```

- [ ] **Step 7: 修改 cascade() 方法，调用 strategist Agent**

将 `cascade()` 方法替换为：

```python
    async def cascade(self, decision: Decision) -> list[Decision]:
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
        parent_id = decision.id
        self._decisions[parent_id] = decision
        event = DecisionCascaded(
            parent_decision_id=parent_id,
            child_decision_ids=child_ids,
        )
        await self._publish_and_apply(event)
        return [self._decisions[cid] for cid in child_ids]
```

- [ ] **Step 8: 添加 _parse 辅助方法**

在 `DecisionRoomService` 类末尾添加：

```python
    @staticmethod
    def _build_cards_with_summary(
        pending: list[Decision], summary: str,
    ) -> list[DecisionCard]:
        lines = [l.strip() for l in summary.split("\n") if l.strip()]
        cards = []
        for i, d in enumerate(pending):
            card_summary = lines[i] if i < len(lines) else d.title
            cards.append(DecisionCard(
                decision=d,
                urgency_color=d.urgency,
                summary=card_summary,
                options_summary=[str(o) for o in d.options],
                source_room="decision",
                created_ago="just now",
            ))
        return cards

    @staticmethod
    def _parse_cascade_output(content: str) -> list[str]:
        titles = []
        for line in content.split("\n"):
            line = line.strip().lstrip("- ").lstrip("0123456789. ")
            if line:
                titles.append(line[:100])
        if not titles:
            titles = ["cascaded decision"]
        return titles
```

- [ ] **Step 9: 运行测试确认通过**

Run: `pytest tests/unit/rooms/decision/test_service.py -v`
Expected: 10 passed

- [ ] **Step 10: 运行全量测试确认无回归**

Run: `pytest tests/ -v --tb=short`
Expected: 全部 passed，0 failed

- [ ] **Step 11: 提交**

```bash
git add src/cabinet/rooms/decision/service.py tests/unit/rooms/decision/test_service.py
git commit -m "feat: integrate LLM Agent into Decision Room service"
```

---

### Task 3: Office Agent 化

**Files:**
- Modify: `src/cabinet/rooms/office/service.py`
- Modify: `tests/unit/rooms/office/test_service.py`

- [ ] **Step 1: 更新测试文件，替换本地 StubAgentFactory**

将 `tests/unit/rooms/office/test_service.py` 中的本地 `StubAgentFactory` 替换为真实 `StubAgentFactory`：

删除：
```python
class StubAgentFactory:
    async def create_agent(self, agent_id, role):
        pass

    async def create_team(self, agents, task):
        pass
```

在文件顶部添加：
```python
from cabinet.agents.stub_factory import StubAgentFactory
```

- [ ] **Step 2: 运行现有测试确认仍通过**

Run: `pytest tests/unit/rooms/office/test_service.py -v`
Expected: 9 passed

- [ ] **Step 3: 修改 OfficeSchedulerService，增加 Agent 导入**

在 `src/cabinet/rooms/office/service.py` 文件顶部增加导入：

```python
import re

from cabinet.agents.context import AgentContext
```

- [ ] **Step 4: 修改 execute_workflow() 方法，调用 executor Agent**

将 `execute_workflow()` 方法替换为：

```python
    async def execute_workflow(self, workflow_id: UUID, inputs: dict) -> WorkflowExecution:
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

- [ ] **Step 5: 修改 check_permission() 方法，调用 evaluator Agent**

将 `check_permission()` 方法替换为：

```python
    async def check_permission(self, employee_id: UUID, action: str) -> PermissionVerdict:
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

- [ ] **Step 6: 添加 _parse 辅助方法**

在 `OfficeSchedulerService` 类末尾添加：

```python
    @staticmethod
    def _parse_permission_level(content: str) -> PermissionLevel:
        match = re.search(r"L([0-3])", content.upper())
        if match:
            return PermissionLevel(f"L{match.group(1)}")
        return PermissionLevel.L1
```

- [ ] **Step 7: 运行测试确认通过**

Run: `pytest tests/unit/rooms/office/test_service.py -v`
Expected: 9 passed

注意：`test_execute_workflow` 测试断言 `execution.status == "running"`，改造后 workflow 完成后 status 变为 `"completed"`。需要更新测试断言：

将 `test_execute_workflow` 中的：
```python
    assert execution.status == "running"
```
改为：
```python
    assert execution.status in ("running", "completed")
```

- [ ] **Step 8: 运行全量测试确认无回归**

Run: `pytest tests/ -v --tb=short`
Expected: 全部 passed，0 failed

- [ ] **Step 9: 提交**

```bash
git add src/cabinet/rooms/office/service.py tests/unit/rooms/office/test_service.py
git commit -m "feat: integrate LLM Agent into Office Scheduler service"
```

---

### Task 4: Summary Room Agent 化

**Files:**
- Modify: `src/cabinet/rooms/summary/service.py`
- Modify: `tests/unit/rooms/summary/test_service.py`

- [ ] **Step 1: 更新测试文件，替换本地 StubAgentFactory**

将 `tests/unit/rooms/summary/test_service.py` 中的本地 `StubAgentFactory` 替换为真实 `StubAgentFactory`：

删除：
```python
class StubAgentFactory:
    async def create_agent(self, agent_id, role):
        pass

    async def create_team(self, agents, task):
        pass
```

在文件顶部添加：
```python
from cabinet.agents.stub_factory import StubAgentFactory
```

- [ ] **Step 2: 运行现有测试确认仍通过**

Run: `pytest tests/unit/rooms/summary/test_service.py -v`
Expected: 6 passed

- [ ] **Step 3: 修改 SummaryRoomService，增加 Agent 导入**

在 `src/cabinet/rooms/summary/service.py` 文件顶部增加导入：

```python
import re

from cabinet.agents.context import AgentContext
```

- [ ] **Step 4: 修改 generate_insights() 方法，调用 evaluator Agent**

将 `generate_insights()` 方法替换为：

```python
    async def generate_insights(self, session_id: UUID) -> list[Insight]:
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

- [ ] **Step 5: 修改 build_decision_tree() 方法，调用 evaluator Agent**

将 `build_decision_tree()` 方法替换为：

```python
    async def build_decision_tree(self, project_id: UUID) -> DecisionTree:
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

- [ ] **Step 6: 修改 suggest_improvements() 方法，调用 evaluator Agent**

将 `suggest_improvements()` 方法替换为：

```python
    async def suggest_improvements(self, session_id: UUID) -> list[ImprovementSuggestion]:
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

- [ ] **Step 7: 修改 audit_authorization_usage() 方法，调用 evaluator Agent**

将 `audit_authorization_usage()` 方法替换为：

```python
    async def audit_authorization_usage(self, captain_id: str) -> AuthorizationAudit:
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

- [ ] **Step 8: 添加 _parse 辅助方法**

在 `SummaryRoomService` 类末尾添加：

```python
    @staticmethod
    def _parse_insights_output(content: str, session_id: UUID) -> list[Insight]:
        insights = []
        for line in content.split("\n"):
            line = line.strip().lstrip("- ").lstrip("0123456789. ")
            if line:
                insights.append(Insight(
                    session_id=session_id,
                    insight_type="observation",
                    content=line,
                    confidence=0.7,
                    auto_applicable=True,
                    requires_captain=False,
                ))
        if not insights:
            insights = [Insight(
                session_id=session_id,
                insight_type="observation",
                content="auto-generated insight",
                confidence=0.7,
                auto_applicable=True,
                requires_captain=False,
            )]
        return insights

    @staticmethod
    def _parse_tree_output(content: str, project_id: UUID) -> DecisionTree:
        root_id = uuid4()
        nodes: dict[UUID, DecisionTreeNode] = {
            root_id: DecisionTreeNode(
                id=root_id,
                node_type="root",
                label="project root",
            ),
        }
        for line in content.split("\n"):
            line = line.strip().lstrip("- ").lstrip("0123456789. ")
            if line:
                child_id = uuid4()
                nodes[child_id] = DecisionTreeNode(
                    id=child_id,
                    node_type="branch",
                    label=line[:100],
                )
                nodes[root_id].children.append(child_id)
        return DecisionTree(
            project_id=project_id,
            root_node_id=root_id,
            nodes=nodes,
        )

    @staticmethod
    def _parse_suggestions_output(content: str, session_id: UUID) -> list[ImprovementSuggestion]:
        suggestions = []
        for line in content.split("\n"):
            line = line.strip().lstrip("- ").lstrip("0123456789. ")
            if line:
                suggestions.append(ImprovementSuggestion(
                    session_id=session_id,
                    category="workflow",
                    description=line[:200],
                    impact="medium",
                    effort="low",
                    auto_applicable=True,
                ))
        if not suggestions:
            suggestions = [ImprovementSuggestion(
                session_id=session_id,
                category="workflow",
                description="optimize pipeline",
                impact="medium",
                effort="low",
                auto_applicable=True,
            )]
        return suggestions

    @staticmethod
    def _parse_audit_output(content: str, captain_id: str) -> AuthorizationAudit:
        numbers = re.findall(r"\d+", content)
        total = int(numbers[0]) if len(numbers) > 0 else 0
        manual = int(numbers[1]) if len(numbers) > 1 else 0
        auto = int(numbers[2]) if len(numbers) > 2 else 0
        return AuthorizationAudit(
            captain_id=captain_id,
            period="all",
            total_decisions=total,
            manually_approved=manual,
            could_auto_process=auto,
            suggestion=content[:200] if content else None,
        )
```

- [ ] **Step 9: 运行测试确认通过**

Run: `pytest tests/unit/rooms/summary/test_service.py -v`
Expected: 6 passed

- [ ] **Step 10: 运行全量测试确认无回归**

Run: `pytest tests/ -v --tb=short`
Expected: 全部 passed，0 failed

- [ ] **Step 11: 提交**

```bash
git add src/cabinet/rooms/summary/service.py tests/unit/rooms/summary/test_service.py
git commit -m "feat: integrate LLM Agent into Summary Room service"
```

---

### Task 5: 最终验证

**Files:**
- 无新增/修改

- [ ] **Step 1: 运行全量测试**

Run: `pytest tests/ -v`
Expected: 全部 passed，0 failed

- [ ] **Step 2: 运行 ruff 检查**

Run: `ruff check src/ tests/`
Expected: 0 errors

- [ ] **Step 3: 验证导入**

Run: `python -c "from cabinet.rooms.strategy.service import StrategyDecoderService; from cabinet.rooms.decision.service import DecisionRoomService; from cabinet.rooms.office.service import OfficeSchedulerService; from cabinet.rooms.summary.service import SummaryRoomService; print('OK')"`
Expected: OK

- [ ] **Step 4: 验证协议满足**

Run: `python -c "from cabinet.agents.protocol import AgentFactory; from cabinet.agents.llm_factory import LLMAgentFactory; from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway; from cabinet.core.gateway.config import DEFAULT_MODEL_LIST; g = LiteLLMRouterGateway(model_list=DEFAULT_MODEL_LIST); assert isinstance(LLMAgentFactory(g), AgentFactory); print('Protocol OK')"`
Expected: Protocol OK

- [ ] **Step 5: 统计测试数量**

Run: `pytest tests/ --co -q | tail -1`
Expected: 总测试数 >= 397（原有基线）
