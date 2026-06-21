# ChatView & Project Workspace — UX Redesign

**Date:** 2026-06-21
**Status:** Draft for discussion

---

## 1. Current State Diagnosis

### 1.1 Four modes, too many

| Mode           | Trigger     | Visible                                     | Problem                                        |
| -------------- | ----------- | ------------------------------------------- | ---------------------------------------------- |
| `idle`         | App start   | Orb + page                                  | Orb 是唯一的"入口"但让人困惑：点了之后去哪里？ |
| `work`         | Orb click   | Page + ChatPanel                            | ChatPanel 悬浮在底部，和页面内容抢注意力       |
| `chat`         | Input focus | ChatView 全屏盖住页面                       | 页面用 CSS `.page-hidden` 隐藏但未卸载         |
| `/project/:id` | Nav click   | Workplace + 独立 Explorer + 独立 FileViewer | 与全局 Explorer/FileViewer 两套并⾏            |

### 1.2 Two of everything

```
App.tsx 渲染:
  ├── Global ProjectExplorer (左栏, w-56)
  ├── Global FileViewer (右栏, 标签页式)
  └── Page content (中间)
       └── ProjectWorkplace (路由 /project/:id)
            ├── 自己的 ProjectExplorer (280px, 独立实例)
            └── 自己的 文件预览 (<pre>/<img>, 独立实例)
```

**两个 Explorer 不互通** — 各自有独立的展开/选中状态。**两个 FileViewer 不互通** — 点击 Workplace 里的文件由内联预览处理；点击全局 Explorer 里的文件由全局 FileViewer 处理。

### 1.3 Chat 模式下页面未卸载

`.page-viewport.page-hidden` 仅做 CSS `opacity: 0; transform: translateY(-20px); pointer-events: none`。所有组件仍在内存中，WebSocket 仍在接收事件。注释说"keep pages mounted so WebSocket listeners stay active"——但实际上 ChatView 自己有独立的 WebSocket 连接。

### 1.4 状态冗余

- `chatMode: boolean` 与 `uiMode: 'idle' | 'work' | 'chat'` 表达同一件事
- `transitionPhase: 'opening' | 'closing'` 与 `uiMode` 双重控制动画
- `handleNavigate` 静默清除 `activeProjectId`，副作用隐晦

---

## 2. Proposed Design: 2 Modes + 1 Context

### 2.1 Simplified Mode Model

```
browse ──click orb──▶ chat ──back──▶ browse
   │                       │
   │                       │
   ▼                       ▼
project context       chat + file explorer
(optional overlay)   (optional sidebar)
```

**Two modes: `browse` and `chat`**, plus an optional **project context** that can be active in either mode.

| Mode         | What user sees                                                                      | When                                      |
| ------------ | ----------------------------------------------------------------------------------- | ----------------------------------------- |
| **`browse`** | Nav sidebar + page content + ChatPanel (collapsible footer) + FileViewer (right)    | Default. 用户浏览页面、管理设置、查看文件 |
| **`chat`**   | Full-screen ChatView (page 内容卸载) + optional session sidebar + optional terminal | 用户点击 orb 或在 ChatPanel 中输入        |

### 2.2 Project Context (not a mode, a state)

Project 不再是独立页面(`/project/:id`)，而是 `activeProjectId` 状态。在任何模式下，如果 `activeProjectId` 不为空，**全局 ProjectExplorer 展开显示该项目的文件树**。

```
browse + project:               chat + project:
┌──┬──────┬──────┬──┐           ┌──────────────────────┐
│N│Proj  │Page  │FV│           │ ChatView             │
│a│Explorer│     │  │           │ (with session        │
│v│(280px)│     │  │           │  sidebar if open)    │
│ │       │     │  │           │                      │
│ │       │     │  │           │ ┌──────────────────┐ │
│ │       │     │  │           │ │FileViewer (right) │ │
└─┴───────┴─────┴──┘           └──────────────────────┘
```

**关键变化：**

- 删除 `ProjectWorkplace.tsx` 独立页面（和它的独立 Explorer/FileViewer）
- `/project/:id` 路由变为：设置 `activeProjectId` + 打开 ProjectExplorer，内容区显示项目摘要（一个简单的仪表板/README）
- 全局 ProjectExplorer 在 `activeProjectId` 不为空时展开，在所有页面中都可用
- 全局 FileViewer 统一处理所有文件预览

### 2.3 Navigation Behavior

| Action                      | Effect                                                    |
| --------------------------- | --------------------------------------------------------- |
| 点击左侧栏 nav              | 切换到对应页面，**不改变** `activeProjectId`              |
| 点击项目列表中的项目        | 设置 `activeProjectId`，切换到项目上下文（Explorer 展开） |
| 点击项目列表中的"+"         | 打开创建项目弹窗                                          |
| 在 ChatPanel 中切换 session | 如果 session 关联了 project，设置 `activeProjectId`       |
| 点击 orb                    | `setUIMode('chat')`，页面卸载，ChatView 挂载              |
| ChatView 中点击 back        | `setUIMode('browse')`，页面重新挂载                       |
| 关闭 ChatPanel (×)          | 回到 `idle`（orb 显示，ChatPanel 隐藏）                   |

### 2.4 Full-Screen Chat (ChatView)

ChatView 不再是一个绝对定位的 overlay，而是**直接替换页面内容**：

```
┌──────────────────────────────────────────┐
│ AgentTopBar                               │
│ [◂ Back] [Secretary] [Claude] [Codex] ... │
├──────────┬───────────────────────────────┤
│Session   │ Messages                      │
│Sidebar   │  (流式消息 + 思考 + 工具调用)   │
│(260px)   │                               │
│可选的    │                               │
│◂ toggle  │                               │
│          ├───────────────────────────────┤
│          │ ChatPanel (input area)        │
│          │ @mentions | [textarea] | Send │
└──────────┴───────────────────────────────┘
```

- Page 在进入 chat 时完全卸载（React Router 的条件渲染，非 CSS 隐藏）
- SessionSidebar 左侧可选（toggle 按钮在 AgentTopBar）
- FileViewer 右侧可选（通过按钮或 `/open` 命令调出）
- Terminal 面板底部可展开（当 activeExternalAgent 时）

### 2.5 ChatPanel (Footer Bar)

ChatPanel 从"悬浮面板"改为页面底部的**固定栏**：

```
┌──────────────────────────────────────────────┐
│ Page content                                 │
│                                              │
│                                              │
├──────────────────────────────────────────────┤
│ ChatPanel (固定高度, 在 browse 模式下始终可见)│
│ [session▾] [project▾] [@agent] [input...] [⚡]│
└──────────────────────────────────────────────┘
```

- 在 `browse` 模式下，ChatPanel 作为页面底部固定栏，始终可见
- 输入框获得焦点时自动进入 `chat` 模式（全屏 ChatView）
- 点击 orb 也进入 `chat` 模式
- 最小化 ChatPanel（×按钮）回到纯浏览模式（orb 显示）

---

## 3. File View Unification

### 3.1 Single Global FileViewer

**删除** ProjectWorkplace 内联文件预览。**所有文件预览统一由全局 FileViewer 处理**。

FileViewer 行为：

- 右侧面板，宽度可调（默认 400px）
- 支持标签页（多文件）
- 文件来源：ProjectExplorer 点击、ChatView 内 `/open` 命令、工作流产物

```typescript
// 统一的事件接口：
window.dispatchEvent(new CustomEvent('cabinet:open-file', {
  detail: { path: string, projectId?: string }
}));
```

### 3.2 Single Global ProjectExplorer

**删除** ProjectWorkplace 内嵌 Explorer。**所有文件树由全局 ProjectExplorer 处理**。

ProjectExplorer 可见性：

- `browse` 模式下：在 `activeProjectId` 不为空时展开在左侧栏与页面之间
- `chat` 模式下：不显示（可通过 FileViewer 访问文件）
- `/project/:id` 路由不再渲染独立页面，仅设置项目上下文 + 显示项目摘要

---

## 4. State Model

### 4.1 New uiMode

```typescript
type UIMode = 'browse' | 'chat' | 'idle';
```

去掉 `work` mode（与 `browse` 合并）。`chatMode` 布尔值去掉。

| Mode     | Description                                                      |
| -------- | ---------------------------------------------------------------- |
| `idle`   | 仅 orb，无 ChatPanel。首次启动或 ChatPanel 最小化后              |
| `browse` | 页面 + ChatPanel 底部栏 + 可选 ProjectExplorer + 可选 FileViewer |
| `chat`   | 全屏 ChatView，页面卸载                                          |

### 4.2 Transition

```
idle ──click orb──▶ browse ──input focus──▶ chat
  ▲                    │                      │
  └──close panel──────┘      ◂──back─────────┘
```

- `idle → browse`: orb click → 450ms 动画 → `setUIMode('browse')`
- `browse → chat`: input focus / orb click（如果在 idle 状态） → `setUIMode('chat')`
- `chat → browse`: ChatView back button → `setUIMode('browse')`
- `browse → idle`: ChatPanel × 按钮 → `setUIMode('idle')`

### 4.3 Project Context Persistence

```typescript
interface ProjectContextState {
  activeProjectId: string | null;
  // set 和 clear 是显式操作，没有隐式副作用
}

// handleNavigate 不再 switchProject(null)
// 切换 session 时如果 session 绑定了 project，设置 activeProjectId
// 切换 project 时不过滤 session（session 列表按 project 显示，但不自动切换）
```

---

## 5. Files Changed

### 5.1 Delete

| File                                          | Reason                                          |
| --------------------------------------------- | ----------------------------------------------- |
| `apps/desktop/src/pages/ProjectWorkplace.tsx` | 替换为轻量级项目仪表板                          |
| (拆分)                                        | ChatView.tsx 中的 SessionSidebar 移出为独立组件 |

### 5.2 Modify

| File                                              | Change                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `apps/desktop/src/App.tsx`                        | 简化 uiMode 为 `'idle'\|'browse'\|'chat'`；移除 `chatMode`；移除双套 Explorer/FileViewer；ChatPanel 改为底部固定栏 |
| `apps/desktop/src/contexts/ChatContext.tsx`       | 移除 `chatMode` 导出，只保留 `uiMode`                                                                              |
| `apps/desktop/src/components/ChatView.tsx`        | 不再作为 overlay，改为占满内容区（React Router 条件渲染）                                                          |
| `apps/desktop/src/components/ChatPanel.tsx`       | 从悬浮面板改为底部固定栏；输入聚焦 → chat mode                                                                     |
| `apps/desktop/src/components/SecretaryOrb.tsx`    | 从 App.tsx 移入 OrbPage 组件，作为 idle 模式的首页                                                                 |
| `apps/desktop/src/components/ProjectExplorer.tsx` | 调整为在所有模式下统一使用（不再在 ProjectWorkplace 中重复实例化）                                                 |
| `apps/desktop/src/components/FileViewer.tsx`      | 调整为在所有模式下使用标签页式右侧面板                                                                             |
| `apps/desktop/src/index.css`                      | 移除 `.page-viewport`/`.chat-viewport`/`.page-hidden` 样式                                                         |

---

## 6. Out of Scope (for this design)

- Framer Motion 或专用动画库 — 保留现有 CSS transition 方案
- 移动端适配 — 仅桌面
- Workspace/Workflow 集成 — 文件预览仅支持文本/图片/PDF
- 拖放文件打开 — 后续可加

---

## 7. Decision Required

| #   | 决策点                           | 选项                                                                                           |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| D1  | **`project` 模式 vs 项目上下文** | 是否保留 `/project/:id` 独立路由，还是改为 `activeProjectId` 状态（在所有页面中展开 Explorer） |
| D2  | **ChatPanel 行为**               | (A) 底部固定栏始终可见 × 最小化后隐藏；(B) 仅 chat 模式下显示，browse 模式不显示               |
| D3  | **FileViewer 位置**              | (A) 右侧面板 (current)；(B) 底部抽屉；(C) 全屏覆盖                                             |
| D4  | **Project Explorer 位置**        | (A) 左侧栏与页面之间 (current)；(B) 作为页面的一部分；(C) 折叠到 nav 中                        |
