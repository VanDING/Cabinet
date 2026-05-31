# Frontend Architecture Refactor — App.tsx Split + Office Data Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 `App.tsx` 930 行 God Component 和 OfficePage 去中心化 widget 架构导致的 N+1 请求、事件丢失和数据不一致。

**Architecture:** 不引入新依赖（React Context + Hooks）。建立三层 Provider（ChatProvider / ProjectProvider / LayoutProvider），并创建共享数据 hooks 替换各 widget 独立的 `fetch`/`window.addEventListener` 模式。

**Tech Stack:** React 18, TypeScript, WebSocket, TanStack Query（已确定引入，见审计建议）

---

## 依赖与顺序

```
Phase 1: Extract Providers from App.tsx
  Task 1 (ChatContext) ──→ Task 2 (ProjectContext) ──→ Task 3 (LayoutContext) ──→ Task 4 (App.tsx 简化)

Phase 2: OfficePage Data Layer
  Task 5 (TanStack Query 接入) ──→ Task 6 (共享 hooks) ──→ Task 7 (重构 widget)

Phase 3: Event System
  Task 8 (EventBusContext) ──→ Task 9 (替换 window.dispatchEvent)

Phase 1 与 Phase 2 可并行，Phase 3 依赖 Phase 2（widget 不再直接 listen window）
```

---

## Phase 1: App.tsx 拆分

### Task 1: ChatContext

**Files:**
- Create: `apps/desktop/src/contexts/ChatContext.tsx`
- Read: `apps/desktop/src/App.tsx`（提取聊天相关状态）
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: 读取 App.tsx 聊天相关代码**

Read: `apps/desktop/src/App.tsx`
提取以下状态和回调到 ChatContext：
- `sessions`, `activeSession`
- `processingSessions`
- `chatMode`, `activeAgent`
- `abortRef`
- `handleSend`（约 313 行）
- `handleCreateSession`, `handleStop`
- `history`（会话历史）

---

- [ ] **Step 2: 创建 ChatContext.tsx**

Create: `apps/desktop/src/contexts/ChatContext.tsx`

```typescript
import React, { createContext, useContext, useState, useCallback, useRef, useMemo } from 'react';
import { useSessions } from '../hooks/useSessions';
import type { Session, ChatMessage } from '../types'; // 按实际路径调整

interface ChatContextValue {
  sessions: Session[];
  activeSession: Session | null;
  processingSessions: Set<string>;
  chatMode: string;
  activeAgent: string | null;
  history: ChatMessage[];
  handleSend: (content: string, options?: { skill?: string }) => Promise<void>;
  handleCreateSession: () => void;
  handleStop: () => void;
  // ... 其他 chat 相关字段
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { sessions, activeSession, history, ...sessionActions } = useSessions();
  const [processingSessions, setProcessingSessions] = useState<Set<string>>(new Set());
  const [chatMode, setChatMode] = useState('chat');
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSend = useCallback(async (content: string, options?: { skill?: string }) => {
    // 从 App.tsx 原样迁移 handleSend 逻辑（313 行）
    // 注意：所有依赖的闭包变量（activeSession, sessions 等）在此组件作用域内可用
  }, [activeSession, sessions /* 完整依赖列表 */]);

  const handleCreateSession = useCallback(() => {
    sessionActions.createSession();
  }, [sessionActions]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const value = useMemo(() => ({
    sessions,
    activeSession,
    processingSessions,
    chatMode,
    activeAgent,
    history,
    handleSend,
    handleCreateSession,
    handleStop,
  }), [sessions, activeSession, processingSessions, chatMode, activeAgent, history, handleSend, handleCreateSession, handleStop]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}
```

**关键风险:** `handleSend` 迁移后，其内部引用的 `activeSession` 闭包必须通过 `useMemo`/`useCallback` 保持稳定，否则每次渲染都会创建新函数，导致子组件不必要的重渲染。

---

- [ ] **Step 3: 编译验证 ChatContext**

Run: `pnpm --filter @cabinet/desktop typecheck`
Expected: ChatContext.tsx 无类型错误

---

### Task 2: ProjectContext

**Files:**
- Create: `apps/desktop/src/contexts/ProjectContext.tsx`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: 创建 ProjectContext.tsx**

Create: `apps/desktop/src/contexts/ProjectContext.tsx`

```typescript
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

interface Project {
  id: string;
  name: string;
  // ... 其他字段按实际类型
}

interface ProjectContextValue {
  projects: Project[];
  activeProjectId: string | null;
  refreshProjects: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  switchProject: (id: string | null) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const refreshProjects = useCallback(async () => {
    // 从 App.tsx 原样迁移
  }, []);

  const createProject = useCallback(async (name: string) => {
    // 从 App.tsx 原样迁移
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    // 从 App.tsx 原样迁移
  }, []);

  const renameProject = useCallback(async (id: string, name: string) => {
    // 从 App.tsx 原样迁移
  }, []);

  const switchProject = useCallback((id: string | null) => {
    setActiveProjectId(id);
  }, []);

  const value = useMemo(() => ({
    projects, activeProjectId,
    refreshProjects, createProject, deleteProject, renameProject, switchProject,
  }), [projects, activeProjectId, refreshProjects, createProject, deleteProject, renameProject, switchProject]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used inside ProjectProvider');
  return ctx;
}
```

---

### Task 3: LayoutContext

**Files:**
- Create: `apps/desktop/src/contexts/LayoutContext.tsx`

- [ ] **Step 1: 创建 LayoutContext.tsx**

Create: `apps/desktop/src/contexts/LayoutContext.tsx`

```typescript
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

interface LayoutContextValue {
  activePage: string;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  navigate: (page: string) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [activePage, setActivePage] = useState('chat');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);

  const navigate = useCallback((page: string) => setActivePage(page), []);
  const toggleSidebar = useCallback(() => setSidebarCollapsed(v => !v), []);

  const value = useMemo(() => ({
    activePage, sidebarCollapsed, sidebarWidth,
    navigate, toggleSidebar, setSidebarWidth,
  }), [activePage, sidebarCollapsed, sidebarWidth, navigate, toggleSidebar, setSidebarWidth]);

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used inside LayoutProvider');
  return ctx;
}
```

---

### Task 4: App.tsx 简化与迁移

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/main.tsx`（包裹 Providers）

- [ ] **Step 1: 在 main.tsx 包裹 Providers**

Read: `apps/desktop/src/main.tsx`
Edit: 将根组件包裹在三层 Provider 中：

```tsx
import { ChatProvider } from './contexts/ChatContext';
import { ProjectProvider } from './contexts/ProjectContext';
import { LayoutProvider } from './contexts/LayoutContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <ChatProvider>
          <ProjectProvider>
            <LayoutProvider>
              <App />
            </LayoutProvider>
          </ProjectProvider>
        </ChatProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
```

---

- [ ] **Step 2: 简化 App.tsx**

Edit: `apps/desktop/src/App.tsx`
删除所有 chat / project / layout 状态定义和回调，改为：

```tsx
import { useChat } from './contexts/ChatContext';
import { useProject } from './contexts/ProjectContext';
import { useLayout } from './contexts/LayoutContext';

function App() {
  // 仅保留路由、全局快捷键、ServerLoading 包装
  const { activePage } = useLayout();

  return (
    <ServerLoading>
      <Routes>
        <Route path="/chat" element={<ChatView />} />
        <Route path="/office" element={<OfficePage />} />
        {/* ... */}
      </Routes>
    </ServerLoading>
  );
}
```

子组件（ChatView / ChatPanel / FactoryPage / Navigation / ProjectExplorer / EmployeesPage）全部改为内部调用 `useChat()` / `useProject()` / `useLayout()`，不再接收 props。

---

- [ ] **Step 3: 验证编译**

Run: `pnpm --filter @cabinet/desktop build`
Expected: 0 errors, 0 warnings

---

## Phase 2: OfficePage 数据层（TanStack Query）

### Task 5: 引入 TanStack Query 并配置

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src/main.tsx`
- Create: `apps/desktop/src/hooks/useDashboardStats.ts`
- Create: `apps/desktop/src/hooks/useDecisions.ts`
- Create: `apps/desktop/src/hooks/useDeliverables.ts`

- [ ] **Step 1: 安装依赖**

Run:
```bash
cd apps/desktop
pnpm add @tanstack/react-query
```

---

- [ ] **Step 2: 在 main.tsx 配置 QueryClient**

Edit: `apps/desktop/src/main.tsx`

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 1000,
      refetchOnWindowFocus: true,
    },
  },
});

// 包裹在 Provider 树外层
<QueryClientProvider client={queryClient}>
  <ChatProvider>...</ChatProvider>
</QueryClientProvider>
```

---

- [ ] **Step 3: 创建共享 hooks**

Create: `apps/desktop/src/hooks/useDashboardStats.ts`

```typescript
import { useQuery } from '@tanstack/react-query';

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/summary');
      if (!res.ok) throw new Error('Failed to load dashboard summary');
      return res.json();
    },
  });
}
```

Create: `apps/desktop/src/hooks/useDecisions.ts`

```typescript
import { useQuery } from '@tanstack/react-query';

export function useDecisions(projectId?: string | null) {
  return useQuery({
    queryKey: ['decisions', projectId ?? 'global'],
    queryFn: async () => {
      const url = projectId ? `/api/projects/${projectId}/decisions` : '/api/decisions?status=all';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load decisions');
      return res.json();
    },
    enabled: true,
  });
}
```

Create: `apps/desktop/src/hooks/useDeliverables.ts`

```typescript
import { useQuery } from '@tanstack/react-query';

export function useDeliverables(projectId?: string | null) {
  return useQuery({
    queryKey: ['deliverables', projectId ?? 'global'],
    queryFn: async () => {
      const url = projectId ? `/api/projects/${projectId}/deliverables` : '/api/deliverables';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load deliverables');
      return res.json();
    },
  });
}
```

---

### Task 6: 重构 Widget 使用共享 Hooks

**Files:**
- Modify: `apps/desktop/src/components/office/today-cost.tsx`
- Modify: `apps/desktop/src/components/office/active-workflows.tsx`
- Modify: `apps/desktop/src/components/office/decision-list.tsx`
- Modify: `apps/desktop/src/components/office/deliverables.tsx`
- Modify: `apps/desktop/src/components/office/system-health.tsx`

- [ ] **Step 1: 重构 DecisionList**

Read: `apps/desktop/src/components/office/decision-list.tsx`
删除：内部 `useEffect(() => { fetch...; window.addEventListener... }, [])`
替换为：

```tsx
import { useDecisions } from '../../hooks/useDecisions';
import { useProject } from '../../contexts/ProjectContext';

export function DecisionList() {
  const { activeProjectId } = useProject();
  const { data, isLoading, error } = useDecisions(activeProjectId);

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <ul>
      {data?.map((d) => (
        <li key={d.id}>{d.title}</li>
      ))}
    </ul>
  );
}
```

**注意:** 仍需监听 WebSocket 事件以触发重新验证。后续 Task 8 会用 EventBusContext 替代 `window.addEventListener`。

---

- [ ] **Step 2: 重构 Deliverables**

与 DecisionList 类似，使用 `useDeliverables()`。
同时修复监听事件：`ws:meeting_created` → `ws:deliverable_created`

---

- [ ] **Step 3: 删除孤儿 DashboardSummary**

Run: `rg "DashboardSummary" apps/desktop/src --type ts -n`
确认 `packages/ui/src/dashboard-summary.tsx` 未被任何 OfficePage widget 引用
如确认，删除该文件及其导出

---

### Task 7: 修复 usePolling 缺陷

**Files:**
- Modify: `apps/desktop/src/hooks/usePolling.ts`

- [ ] **Step 1: 读取现有实现**

Read: `apps/desktop/src/hooks/usePolling.ts`

---

- [ ] **Step 2: 增强实现**

修改要点：
1. 增加 `AbortController` 请求取消
2. 暴露错误（不静默 `.catch(() => {})`）
3. 增加 `document.visibilitychange` 暂停机制

```typescript
import { useEffect, useRef, useState, useCallback } from 'react';

export function usePolling<T>(fetcher: () => Promise<T>, interval: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tick = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const result = await fetcher();
      if (ctrl.signal.aborted) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(err as Error);
    }
  }, [fetcher]);

  useEffect(() => {
    let visible = true;

    const run = () => {
      if (!visible) return;
      tick();
      timerRef.current = setTimeout(run, interval);
    };

    run();

    const onVis = () => {
      visible = !document.hidden;
      if (visible) tick();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [tick, interval]);

  return { data, error };
}
```

---

## Phase 3: EventBusContext 替换 window.dispatchEvent

### Task 8: 建立 EventBusContext

**Files:**
- Create: `apps/desktop/src/contexts/EventBusContext.tsx`
- Create: `apps/desktop/src/hooks/useEvent.ts`
- Modify: `apps/desktop/src/utils/eventBuffer.ts`

- [ ] **Step 1: 创建 EventBusContext**

Create: `apps/desktop/src/contexts/EventBusContext.tsx`

```typescript
import React, { createContext, useContext, useRef, useCallback } from 'react';

type EventHandler = (data: unknown) => void;

interface EventBus {
  emit: (type: string, data: unknown) => void;
  on: (type: string, handler: EventHandler) => () => void;
}

const EventBusContext = createContext<EventBus | null>(null);

export function EventBusProvider({ children }: { children: React.ReactNode }) {
  const listeners = useRef<Map<string, Set<EventHandler>>>(new Map());

  const emit = useCallback((type: string, data: unknown) => {
    const set = listeners.current.get(type);
    if (set) set.forEach((h) => h(data));
  }, []);

  const on = useCallback((type: string, handler: EventHandler) => {
    if (!listeners.current.has(type)) listeners.current.set(type, new Set());
    listeners.current.get(type)!.add(handler);
    return () => { listeners.current.get(type)?.delete(handler); };
  }, []);

  return (
    <EventBusContext.Provider value={{ emit, on }}>
      {children}
    </EventBusContext.Provider>
  );
}

export function useEventBus() {
  const ctx = useContext(EventBusContext);
  if (!ctx) throw new Error('useEventBus must be inside EventBusProvider');
  return ctx;
}
```

---

- [ ] **Step 2: 创建 useEvent hook（含防抖）**

Create: `apps/desktop/src/hooks/useEvent.ts`

```typescript
import { useEffect, useRef } from 'react';
import { useEventBus } from '../contexts/EventBusContext';

export function useEvent(type: string, callback: (data: unknown) => void, debounceMs = 500) {
  const { on } = useEventBus();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return on(type, (data) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => callback(data), debounceMs);
    });
  }, [on, type, callback, debounceMs]);
}
```

---

- [ ] **Step 3: 重构 eventBuffer**

Read: `apps/desktop/src/utils/eventBuffer.ts`
修改为按类型隔离的环形缓冲区，消费后清除：

```typescript
const buffers = new Map<string, unknown[]>();
const MAX_SIZE = 50;

export function bufferEvent(type: string, data: unknown) {
  if (!buffers.has(type)) buffers.set(type, []);
  const arr = buffers.get(type)!;
  arr.push(data);
  if (arr.length > MAX_SIZE) arr.shift();
}

export function consumeBufferedEvents<T>(type: string): T[] {
  const arr = buffers.get(type) as T[] | undefined;
  if (!arr) return [];
  buffers.set(type, []); // 消费后清空
  return arr;
}
```

---

### Task 9: 接入 WebSocket 到 EventBus

**Files:**
- Modify: `apps/desktop/src/App.tsx`（或 useWebSocket hook）

- [ ] **Step 1: 替换 window.dispatchEvent**

找到 `window.dispatchEvent(new CustomEvent(\`ws:${type}\`, { detail: data }))`
替换为：

```typescript
import { useEventBus } from './contexts/EventBusContext';

// 在 WebSocket message handler 中
const { emit } = useEventBus();
emit(type, data);
```

同时保留向后兼容（如果某些组件仍用 `window.addEventListener`，同时 emit `window` 事件，标记为 deprecated）。

---

- [ ] **Step 2: 所有 widget 替换 window 监听**

对 `DecisionList`、`Deliverables`、`EventTimeline` 等组件：
删除：
```typescript
useEffect(() => {
  const handler = () => fetchData();
  window.addEventListener('ws:decision_created', handler);
  return () => window.removeEventListener('ws:decision_created', handler);
}, []);
```
替换为：
```typescript
import { useEvent } from '../../hooks/useEvent';

useEvent('decision_created', () => {
  queryClient.invalidateQueries({ queryKey: ['decisions'] });
});
```

---

## 最终验证

- [ ] **Step 1: 全量编译**
Run: `pnpm run build`
Expected: 0 errors

- [ ] **Step 2: 运行前端测试**
Run: `pnpm --filter @cabinet/desktop test`
Expected: 全部通过

- [ ] **Step 3: 运行 E2E（如可用）**
Run: `pnpm exec playwright test`（或项目定义的 E2E 命令）
Expected: OfficePage 相关用例通过

---

## Self-Review

- [ ] App.tsx 拆分后，ChatView / ChatPanel / Navigation / FactoryPage / ProjectExplorer / EmployeesPage 都不再接收相关 props
- [ ] `window.dispatchEvent` 已替换为 EventBusContext，eventBuffer 按类型隔离
- [ ] TanStack Query 已配置，widget 使用共享 hooks
- [ ] 无新 alert() 引入
- [ ] 所有修改文件编译通过
