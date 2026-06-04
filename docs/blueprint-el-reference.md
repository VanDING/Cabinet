# Cabinet 蓝图 EL 表达式参考

> EL (Expression Language) 是 LiteFlow 风格的编排语法，编译为 StateGraph 执行。

## 基本概念

EL 表达式描述 Agent 之间的执行顺序。每个 Agent 引用对应 `AgentRoleRegistry` 中已注册的 Agent（内置、自定义或外部）。

```
THEN(agentA, agentB)   → agentA 完成后执行 agentB
WHEN(agentA, agentB)   → agentA 和 agentB 并行执行
IF(cond, a, b)         → 条件选择
SWITCH(x).TO(a, b, c) → 多路选择
```

## 运算符

### THEN — 串行

```
THEN(claudeCode, cursorReview, summary)
```
编译为 3 个 Agent 节点 + 2 条串行边。

### WHEN — 并行

```
WHEN(claudeCode, codexCheck, cursorReview)
```
编译为 parallel 节点 → 3 个分支 → merge 节点。

**超时控制**：
```
WHEN(claudeCode, codexCheck).maxWaitSeconds(120)
```
所有分支在 120 秒内完成，超时的分支被丢弃。

### IF — 条件

```
IF(needsReview, cursorReview, skip)
IF(mathQuestion, mathAgent).ELIF(codeQuestion, codeAgent).ELSE(generalAgent)
```

### SWITCH — 多路选择

```
SWITCH(taskType).TO(codeAgent, reviewAgent, deployAgent)
```

### Agent 引用

```
// 简单引用
claudeCode

// 带参数
claudeCode("根据需求生成登录页面代码")
```

## 编译示例

输入：
```
THEN(
  prepareContext,
  WHEN(claudeCode("生成代码"), codexCheck("安全检查")).maxWaitSeconds(120),
  IF(hasIssues, captainReview, summary)
)
```

输出 StateGraph：
```
start → prepareContext → parallel ─┬→ claudeCode ─┬→ merge → ifElse ─┬→ captainReview → end
                                   └→ codexCheck ─┘                  └→ summary → end
```

## 蓝图集成

在 `.cabinet/blueprint/team.yml` 中使用：

```yaml
agents:
  - id: claude-code-v1
    source: external_cli
    config:
      command: claude
      args: ["--print"]

workflows:
  - name: "Code Pipeline"
    el: |
      THEN(
        claudeCode("Generate code based on requirements"),
        cursorReview("Review the generated code"),
        IF(needsApproval, captainReview, mergeAndReport)
      )
```

## Phase 3 可用（核心子集）

- ✅ `THEN` — 串行
- ✅ `WHEN` — 并行（含 `.maxWaitSeconds()`）
- ✅ `IF` / `.ELIF` / `.ELSE` — 条件链
- ✅ `SWITCH` / `.TO` — 多路选择
- ✅ Agent 引用 `name("arg")`

## Phase 5（后续）

- 🔜 `FOR(n, agent)` — 计数循环
- 🔜 `WHILE(cond, agent)` — 条件循环
- 🔜 嵌套 chain / subflow
- 🔜 语法错误位置提示
