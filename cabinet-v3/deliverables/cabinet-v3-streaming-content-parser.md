# Cabinet v3 — 流式内容解析与渲染系统设计

> 版本：v0.1.0
> 定位：LLM 流式输出 → 结构化内容块 → TUI 模块化渲染
> 对标：Claude Code StreamingDisplay + Anthropic ContentBlock 体系
> 日期：2026-06-13

---

## 一、问题

当前设计中，Gateway 产出了结构化的 `StreamChunk`，TUI 有 `TuiStreamingCallback`。但中间缺了一层——**流式内容解析器**。

```
当前（薄）:
  Gateway → StreamChunk → AgentLoop（不处理）→ TUI 回调

应该（完整）:
  Gateway → StreamChunk → StreamingContentParser → AgentLoop → TUI 块渲染
```

缺失这层的后果：

- Thinking → Text → ToolCall 过渡时 TUI 不知道如何更新
- 并行 tool call 的 delta 无法关联到对应的占位块
- 流中断后无法恢复已接收的部分
- Tool result 回来后找不到对应的 tool call 块

---

## 二、核心设计：结构化消息块

### 2.1 消息的内部表示

消息不是纯文本——是**结构化的块序列**：

```
Message {
  role: Assistant,
  blocks: [
    ThinkingBlock  { content, status: Collapsed },
    TextBlock      { content: "好的，我来分析..." },
    ToolUseBlock   { id, name, args, status: Running },
    ToolUseBlock   { id, name, args, status: Running },
    ToolResultBlock { call_id, result, status: Completed },  // ← 关联到 toolu_1
    ToolUseBlock   { status: Completed },                     // ← toolu_1 完成
    TextBlock      { content: "我发现..." },
    ToolUseBlock   { status: Error },                         // ← toolu_2 失败
  ]
}
```

### 2.2 ContentBlock 类型

```
ContentBlock:
  | ThinkingBlock {
      content: String,
      status: ThinkingStatus,        // Streaming | Completed | Collapsed
      signature: Option<String>,
    }
  | TextBlock {
      content: String,
      status: TextStatus,             // Streaming | Completed
    }
  | ToolUseBlock {
      id: String,                     // toolu_xxx
      name: String,
      args: JsonValue,                // StreamingContentParser 累积 delta
      args_status: ArgsStatus,        // Pending | Accumulating | Complete
      status: ToolStatus,             // Pending | Running | Completed | Error
      result: Option<ToolResult>,
      duration_ms: Option<u64>,
    }
  | ToolResultBlock {
      call_id: String,                // 关联到 ToolUseBlock
      content: String,
      is_error: bool,
    }
  | ErrorBlock {
      message: String,
      retryable: bool,
    }
```

### 2.3 块状态机

```
ThinkingBlock:
  Streaming ──(thinking_done)──→ Completed ──(用户操作)──→ Collapsed
                                                ←──(用户展开)──

TextBlock:
  Streaming ──(下一个块开始)──→ Completed

ToolUseBlock:
  Pending ──(收到 ToolCallStart)──→ Running
    ├──(delta 持续到达)── args: Accumulating
    ├──(收到 ToolCallEnd)──→ args: Complete
    ├──(收到 tool result)──→ Completed { result, duration_ms }
    └──(工具返回错误)──────→ Error

ToolResultBlock:
  直接创建为 Completed（结果已完整返回）
```

---

## 三、StreamingContentParser

### 3.1 职责

Gateway 产出 `StreamChunk` → Parser 累积和转换 → 生成/更新 `ContentBlock` → 通知 TUI

```
StreamingContentParser:
  当前消息: MessageBuilder              // 正在构建的 assistant 消息
  活跃 tool calls: HashMap<call_id, ToolUseBlock>  // 并行 tool calls
  thinking_block: Option<ThinkingBlock>  // 当前 thinking 块（如果有）
  text_buffer: String                    // 当前 text 块的内容缓冲
```

### 3.2 处理每种 StreamChunk

```
on_chunk(chunk: StreamChunk):

  match chunk:

    Thinking { content }:
      → 如果 thinking_block 不存在 → 创建 ThinkingBlock { status: Streaming }
      → thinking_block.content += content
      → 通知 TUI: update_thinking(content)

    ThinkingDone:
      → thinking_block.status = Completed
      → 通知 TUI: thinking_done()

    Text { content }:
      → 如果 thinking_block 存在且 status = Completed:
         → thinking_block.status = Collapsed（自动折叠）
      → text_buffer += content
      → 通知 TUI: update_text(content)

    ToolCallStart { id, name }:
      → 如果 text_buffer 非空 → 完成当前 TextBlock → 追加到 blocks
      → 创建 ToolUseBlock { id, name, status: Pending }
      → 加入活跃 tool calls
      → 通知 TUI: add_tool_placeholder(id, name)

    ToolCallDelta { id, args_json }:
      → 找到活跃的 ToolUseBlock { id }
      → 累积 args_json 到 args 字段
      → 通知 TUI: update_tool_args(id, accumulated_json)

    ToolCallEnd { id }:
      → 标记 ToolUseBlock.args_status = Complete
      → 通知 TUI: tool_args_complete(id)

    Done { usage, finish_reason }:
      → 如果 text_buffer 非空 → 完成 TextBlock
      → 通知 TUI: stream_done(usage)

    Error { message, retryable }:
      → 创建 ErrorBlock { message, retryable }
      → 通知 TUI: stream_error(message)
```

### 3.3 工具结果关联

工具结果不是通过 StreamChunk 到达——是通过 `on_tool_result` Observer 回调。Parser 需要处理：

```
on_tool_result(call_id, result, duration_ms):

  → 找到活跃的 ToolUseBlock { call_id }
  → 更新:
     tool.status = if result.is_error { Error } else { Completed }
     tool.result = Some(result)
     tool.duration_ms = Some(duration_ms)
  → 创建 ToolResultBlock { call_id, content, is_error }
     ——插入到对应的 ToolUseBlock 之后
  → 通知 TUI: tool_result(call_id, status, duration_ms)
```

---

## 四、TUI 块渲染

### 4.1 每种块的渲染逻辑

```
ThinkingBlock:
  Streaming:
    ┌─ Thinking:  Thinking... ──────────────────────────────┐
    │ "这个需求需要先理解 auth 模块的调用链..."      │
    │                                                │
    │ (最后一行跟随最新内容，光标闪烁)               │
    └────────────────────────────────────────────────┘

  Completed (自动折叠):
    ┌─ Thinking:  Thought for 3.2s ──────────── [展开] ─────┐
    └────────────────────────────────────────────────┘

  Collapsed (用户展开):
    ┌─ Thinking:  Thought for 3.2s ──────────── [折叠] ─────┐
    │ "这个需求需要先理解 auth 模块的调用链..."      │
    │ (完整内容)                                     │
    └────────────────────────────────────────────────┘

TextBlock:
  Streaming:
    好的，我来分析 auth 模块的结构。|    ← 光标闪烁

  Completed:
    好的，我来分析 auth 模块的结构。

ToolUseBlock:
  Pending:
    ┌─ codegraph_explore ── ... ... ──────────────────┐
    │ (等待参数)                                     │
    └────────────────────────────────────────────────┘

  Running (args 累积中):
    ┌─ codegraph_explore ── ... ... ──────────────────┐
    │ query: "auth module str|"                      │ ← 参数实时更新
    └────────────────────────────────────────────────┘

  Completed:
    ┌─ codegraph_explore ── [OK]  45ms ──── [v] ────────┐
    │ query: "auth module structure"                 │
    │ ─────────────────────────────────────────────  │
    │ [OK]  Found 5 symbols:                             │
    │   AuthService (src/auth/service.rs:12)         │
    │   TokenManager (src/auth/token.rs:8)           │
    │   ...                                          │
    └────────────────────────────────────────────────┘

  Error:
    ┌─ codegraph_explore ── [ERR]  timeout ── [v] ───────┐
    │ Error: Request timed out after 30s             │
    └────────────────────────────────────────────────┘

ToolResultBlock:
  通常不单独渲染——合并到上方的 ToolUseBlock 中。
  但如果 result 很大（>20 行），作为独立可展开块:

    ┌─ Result (1,234 chars) ─────────── [展开] ──────┐
    └────────────────────────────────────────────────┘

ErrorBlock:
  ┌─ *  Streaming Error ──────────────────────────────┐
  │ Connection lost. Retrying...                      │
  │ [Retry] [Cancel]                                  │
  └───────────────────────────────────────────────────┘
```

### 4.2 块过渡动画

```
Thinking → Text:
  1. Thinking 块从 "Streaming" 变为 "Completed"
  2. 0.3s 后自动折叠 (status → Collapsed)
  3. Text 块从下方流式出现

Text → ToolCall:
  1. Text 块的 |光标消失 (status → Completed)
  2. ToolCall 占位块从下方出现 (status → Pending → Running)
  3. 如果并行 tool calls → 多个占位块同时出现

ToolCall → Text:
  1. ToolCall 块更新为 Completed/Error
  2. 如果展开 → 保持展开，结果可见
  3. Text 块从下方继续流式出现
```

### 4.3 并行 Tool Call 渲染

```
同时收到 3 个 ToolCallStart:

  Agent: 我来同时分析三个模块。

  ┌─ codegraph_explore #1 ── ... ... ──── [>] ────────┐
  │ query: "auth module"                              │
  └───────────────────────────────────────────────────┘

  ┌─ codegraph_explore #2 ── ... ... ──── [>] ────────┐
  │ query: "database module"                          │
  └───────────────────────────────────────────────────┘

  ┌─ read_file ── ... ... ──── [>] ────────────────────┐
  │ path: "src/config.rs"                             │
  └───────────────────────────────────────────────────┘

  (第一个完成):
  ┌─ codegraph_explore #1 ── [OK]  45ms ── [v] ──────────┐
  │ [OK]  Found 5 symbols                                 │
  └───────────────────────────────────────────────────┘
  ┌─ codegraph_explore #2 ── ... ... ── [>] ──────────┐  ← 仍在运行
  ┌─ read_file ── ... ... ── [>] ──────────────────────┘  ← 仍在运行

  (全部完成):
  所有三个块更新为 Completed。标记 #1, #2 自动消失——
  只保留 call_id 用于后续引用。
```

---

## 五、流中断与恢复

### 5.1 流中断处理

```
场景: LLM 正在流式返回，网络断开

Parser 收到的最后几个 chunk:
  Text { content: "auth 模块包含以下关键" }
  Error { message: "Connection lost", retryable: true }

Parser 行为:
  1. 保留已接收的所有 blocks（不丢弃）
  2. TextBlock 标记为 "流中断" 状态
  3. 追加 ErrorBlock
  4. 通知 Agent: 流中断，可选择重试

Agent 重试:
  → 发送相同 request + 已接收的 partial content 作为前缀
  → Anthropic: 不支持。需重新发送完整请求
  → 降级: 重新流式调用（丢失已接收但未完成的 text block）
```

### 5.2 流中断恢复策略

```
Anthropic API: 不支持从中间恢复 → 整个 turn 重试
OpenAI API: 不支持 → 同上

实际策略:
  1. 保留已完成的 blocks（ThinkingBlock, ToolUseBlock with result）
  2. 丢弃未完成的 TextBlock（其内容不完整）
  3. 重新发起 LLM 请求（相同 messages）
  4. 如果第二次也中断 → 标记为错误，通知用户
```

---

## 六、AgentLoop 中的位置

### 6.1 更新后的 Phase 3

```
Phase 3: LLM 流式调用

  → gateway.stream(request)
  → 初始化 StreamingContentParser
  → 流式回调:

    on_chunk(chunk):
      ① StreamingContentParser.on_chunk(chunk)
         → 累积/更新 ContentBlock
      ② 通知 TUI:
         on_block_updated(block) → TUI 增量渲染
         （不是整帧重绘——只更新变更的块）

  → 流结束 (Done chunk):
    ① Parser 完成所有待处理块
    ② 如果有 ToolUseBlocks → 进入 Phase 4 (工具分发)
    ③ 如果没有 → turn 完成，返回最终响应

  → 流错误 (Error chunk):
    ① Parser 保存已接收内容
    ② 决定是否重试
```

### 6.2 TUI 回调接口更新

不再是简单的 on_text/on_tool_call——改为基于块的增量更新：

```
TuiStreamingCallback (更新后):

  on_thinking_start()                    → 创建 ThinkingBlock
  on_thinking_delta(content)            → 追加 thinking 文本
  on_thinking_done()                     → 折叠 thinking 块

  on_text_delta(content)                → 追加到当前 TextBlock
  on_text_done()                         → TextBlock 完成

  on_tool_start(id, name)               → 创建 ToolUseBlock 占位
  on_tool_args_delta(id, partial_json)  → 更新参数显示
  on_tool_args_done(id)                  → 参数完整
  on_tool_result(id, status, duration)  → 更新工具状态

  on_error(message, retryable)           → 显示错误块

  on_done(usage)                         → 整个流完成
```

---

## 七、实现

### 7.1 新增文件

```
crates/agent/src/
  streaming/
    parser.rs          ← StreamingContentParser
    blocks.rs          ← ContentBlock 类型定义 + 状态机
    accumulator.rs     ← ToolCallDelta 累积器

crates/tui/src/
  render/
    thinking_block.rs  ← ThinkingBlock 渲染
    text_block.rs      ← TextBlock 渲染
    tool_use_block.rs  ← ToolUseBlock 渲染（pending/running/completed/error）
    error_block.rs     ← ErrorBlock 渲染
    block_transition.rs ← 块过渡动画（折叠/展开/出现/消失）
```

### 7.2 关键数据结构

```rust
// agent/src/streaming/blocks.rs

pub enum ContentBlock {
    Thinking(ThinkingBlock),
    Text(TextBlock),
    ToolUse(ToolUseBlock),
    ToolResult(ToolResultBlock),
    Error(ErrorBlock),
}

pub struct MessageBuilder {
    pub blocks: Vec<ContentBlock>,
    thinking: Option<ThinkingBlock>,
    text_buffer: String,
    active_tools: HashMap<String, ToolUseBlock>,
}

// agent/src/streaming/parser.rs

pub struct StreamingContentParser {
    builder: MessageBuilder,
}

impl StreamingContentParser {
    pub fn new() -> Self;
    pub fn on_chunk(&mut self, chunk: &StreamChunk) -> BlockUpdate;
    pub fn on_tool_result(&mut self, call_id, result, duration) -> BlockUpdate;
    pub fn finalize(self) -> Vec<ContentBlock>;
}

pub enum BlockUpdate {
    ThinkingStarted,
    ThinkingDelta { content: String },
    ThinkingDone,
    TextDelta { content: String },
    TextDone,
    ToolStarted { id: String, name: String },
    ToolArgsDelta { id: String, partial_json: String },
    ToolArgsDone { id: String },
    ToolCompleted { id: String, status: ToolStatus, duration_ms: u64 },
    Error { message: String, retryable: bool },
    Done { usage: TokenUsage },
}
```

---

## 八、对标

| 能力                               | Claude Code | Cabinet v3 (当前)             | Cabinet v3 (设计后) |
| ---------------------------------- | ----------- | ----------------------------- | ------------------- |
| **Thinking 可折叠渲染**            | ✅          | ❌                            | ✅                  |
| **并行 Tool Call 占位 + 状态更新** | ✅          | ❌ (未设计 delta 更新)        | ✅                  |
| **Tool Args 流式累积显示**         | ✅          | ❌                            | ✅                  |
| **Tool Result 精确关联**           | ✅          | \* ️ (有 call_id 但无渲染关联) | ✅                  |
| **结构化块序列**                   | ✅          | ❌ (消息是扁平的文本)         | ✅                  |
| **流中断部分保留**                 | ✅          | ❌                            | ✅                  |
| **块过渡动画**                     | ✅          | ❌                            | ✅                  |

---

## 九、场景化渲染设计

第 1-8 节解决了 LLM 输出怎么渲染。但 Agent 在实际使用中会产生比 LLM 输出更复杂的渲染场景：子代理、产物、Workflow、长输出、错误、Mermaid。

### 9.1 子代理渲染

对标 Claude Code (TeammateSpinnerTree + agentColorManager)、jcode (独立 TUI crate + Sidebar)、OpenCode (Tab 切换 + hex 颜色)。

**颜色分配：** 5 种 Agent 类型各有固定颜色，整个会话不变——Build 白、Plan 青、Explore 蓝、Verify 黄、GeneralPurpose 绿。

**树形层级：** 父 Agent 调用 3 个并行 Explore，每个显示 [类型] [颜色] [名称] [状态] [当前动作]。子代理 spawn 了 Verify 则缩进一级显示。

**状态：** Pending 灰 / Running 蓝 + 实时文本 / Complete 绿 + 耗时统计 / Error 红 + 原因 / Canceled 灰。

**折叠：** 已完成子代理 5 秒后自动折叠为一行摘要。Enter 手动展开/折叠。

**并行限制：** 最多同时展开 5 个子代理。屏幕空间不足时折叠最早启动的。

### 9.2 Task 生命周期渲染

对标 Claude Code TaskRegistry + taskStatusUtils。

**StatusBar 指示器：** [Tasks: 3 running, 2 done]。快捷键展开查看每个 task 状态。

**Workflow Phase 进度条：** 当前 phase 高亮 + 完成子代理数/总数 + 进度条。已完成 phase 折叠为一行。

**循环指示器：** loop-until-dry/count/budget —— 每次迭代一行，标注发现数 + 新增数 + dry 计数。

### 9.3 产物渲染

对标 Claude Code StructuredDiff + colorDiff、Codex CLI diff_render + markdown_render。

**Diff 视图：** edit_file 返回的 hunks 渲染为统一 diff 格式——行号 + 红色删除行 + 绿色新增行 + 白色上下文。

**文件树变更摘要：** 按 Modified/Created/Deleted 分类列出所有变更文件 (+行数 -行数)。Enter 展开单个 diff，Tab 到 Sidebar Diff Tab。

**新建/删除：** Created 文件显示前 10 行 + 剩余行数。Deleted 文件显示前 10 行 + 灰色删除线。

### 9.4 长输出处理

对标 Codex CLI pager_overlay 模块、jcode Handterm 原生滚动。

**截断：** 工具输出 > 20 行默认折叠。Enter 进入 Pager 模式——全屏 + 语法高亮 + j/k 滚动 + / 搜索 + q 退出。

**自动滚动：** 流式输出时自动跟随。用户上滚暂停，显示 [New output below]。End/回到底部恢复。

### 9.5 错误分级渲染

对标 Claude Code 5 种 result types。

三级视觉处理：Transient (StatusBar 黄色 2s 消失)、Recoverable (黄色 ErrorBlock 持续可见)、Fatal (红色 ErrorBlock + StatusBar 闪烁 + Agent 暂停)。

### 9.6 Mermaid 渲染

对标 jcode 1800x 纯 Rust Mermaid 渲染器。

v0.1.0: 不实现 Rust Mermaid 渲染。TUI 显示源码高亮 + ASCII 依赖树 + 可选导出 HTML。
v1.0 (GUI): D3.js/Canvas 交互式图。

---

## 十、TUI 模块拆分

crates/tui/src/render/ 下按职责拆分为 14 个子模块: text_block, thinking_block, tool_use_block, tool_result_block, error_block, diff_view, file_tree, subagent, workflow_progress, task_indicator, pager, mermaid_source, block_transition。

---

## 十一、场景对标总结

| 场景          | Claude Code                      | jcode                    | Codex CLI                     | OpenCode            | v3 此设计                                    |
| ------------- | -------------------------------- | ------------------------ | ----------------------------- | ------------------- | -------------------------------------------- |
| 子代理渲染    | TeammateSpinnerTree + Agent 颜色 | 独立 TUI crate + Sidebar | exec_cell 块                  | Tab 切换 + hex 颜色 | 树形层级 + 5 色 + 状态 + 折叠                |
| Task 生命周期 | TaskRegistry + taskStatusUtils   | 无                       | 无                            | 无                  | Task 指示器 + Workflow Phase 进度 + 循环指示 |
| Diff/文件     | StructuredDiff + colorDiff       | Handterm + Sidebar diff  | diff_render + markdown_render | 无                  | Diff 视图 + 文件树变更摘要                   |
| 长输出        | ScrollBox                        | Handterm 原生滚动        | pager_overlay                 | 游标分页            | Pager 模式 + 自动滚动暂停恢复                |
| 错误分级      | 5 种 result types                | 无                       | execpolicy                    | Effect-TS state     | 3 级 (Transient/Recoverable/Fatal)           |
| Mermaid       | 无                               | 1800x Rust 渲染          | 无                            | 无                  | 源码高亮 + 导出 HTML (v0.1.0)                |

---

> 设计结束。此系统填补了两个空白：LLM 流式输出的结构化解析（第 1-8 节）+ Agent 产物和交互的完整渲染体系（第 9 节）。
