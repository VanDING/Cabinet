# 前端重构计划：shadcn/ui 全量替换

> 版本：v1.0  
> 日期：2026-06-29  
> 预估工期：12.5 天

---

## 目录

- [零、当前状态诊断](#零当前状态诊断)
- [一、架构决策](#一架构决策)
- [二、Phase 0：基础设施准备（0.5 天）](#二phase-0基础设施准备05-天)
- [三、Phase 1：安装全部 shadcn 组件（0.5 天）](#三phase-1安装全部-shadcn-组件05-天)
- [四、Phase 2：基础组件替换 — packages/ui（2 天）](#四phase-2基础组件替换--packagesui2-天)
- [五、Phase 3：交互组件替换 — apps/desktop（2 天）](#五phase-3交互组件替换--appsdesktop2-天)
- [六、Phase 4：AI 聊天组件替换（3 天）](#六phase-4ai-聊天组件替换3-天)
- [七、Phase 5：业务卡片组件重构（2 天）](#七phase-5业务卡片组件重构2-天)
- [八、Phase 6：边缘组件 + CSS 清理（1 天）](#八phase-6边缘组件--css-清理1-天)
- [九、Phase 7：测试与验证（1 天）](#九phase-7测试与验证1-天)
- [十、汇总](#十汇总)
- [十一、风险与缓解](#十一风险与缓解)

---

## 零、当前状态诊断

### 环境

| 项目 | 当前 |
|------|------|
| 框架 | React 19 + Vite 6 + TypeScript |
| CSS | Tailwind CSS v4 (`@tailwindcss/vite` 插件) |
| UI 库 | **无**（手写 `@cabinet/ui` 包） |
| CSS 变量 | 自定义命名：`--accent`、`--surface-primary`、`--content-primary` 等 |
| 主题系统 | 16 套主题，通过 `generated-themes.css`（TypeScript 生成）注入 |
| AI 依赖 | `lucide-react`、`recharts`、`@xyflow/react`、`@tanstack/react-query` |
| 构建 | Tauri 桌面应用 |

### 缺失

- 无 `components.json`（shadcn 配置文件）
- 无 Radix UI 依赖
- 无 `class-variance-authority`、`clsx`、`tailwind-merge`
- `cn()` 是简易 `string.join(' ')`，不处理 Tailwind 类名冲突

### 手写组件清单（按可替换程度排序）

**完全可替换（100% 功能覆盖）：**

| 手写组件 | 位置 | 行数 | shadcn 等价 |
|---------|------|------|------------|
| Button | `packages/ui/src/button.tsx` | 84 | `Button` |
| Card | `packages/ui/src/card.tsx` | 47 | `Card` + 子组件 |
| Input | `packages/ui/src/input.tsx` | 23 | `Input` |
| Tabs | `packages/ui/src/tabs.tsx` | 34 | `Tabs` |
| Tag | `packages/ui/src/tag.tsx` | 33 | `Badge` |
| cn() | `packages/ui/src/cn.ts` | 3 | `cn` (clsx+tailwind-merge) |
| ModalOverlay | `apps/desktop/src/components/ModalOverlay.tsx` | 61 | `Dialog` |
| Toast | `apps/desktop/src/components/Toast.tsx` | 91 | `Sonner` |
| ContextMenu | `apps/desktop/src/components/ContextMenu.tsx` | 91 | `ContextMenu` / `DropdownMenu` |
| ProjectSwitcher | `apps/desktop/src/components/ProjectSwitcher.tsx` | 72 | `Select` |

**AI 聊天组件（深度替换，保留业务逻辑）：**

| 手写功能 | 位置 | 行数 | shadcn 等价 |
|---------|------|------|------------|
| 消息行布局 | `ChatView.tsx` MessageRow | ~200 | `Message` + `MessageAvatar` + `MessageHeader` + `MessageFooter` |
| 消息气泡 | 无（裸文字） | - | `Bubble` + `BubbleContent` |
| 流式状态指示 | `ChatView.tsx` 内联 | ~20 | `Marker` + `Spinner` + `shimmer` |
| 滚动系统 | `ChatView.tsx` 滚动逻辑 | ~100 | `MessageScroller` |
| 文件附件 | `ChatView.tsx`+`ChatPanel.tsx` | ~45 | `Attachment` + `AttachmentGroup` |
| Thinking 折叠 | `<details>` 元素 | ~15 | `Collapsible` |
| 6个下拉菜单 | `ChatPanel.tsx` 内联 | ~200 | `DropdownMenu` / `Popover` |

**业务卡片组件（外壳替换，保留业务内核）：**

| 手写组件 | 位置 | 行数 | 可用 shadcn 原语 |
|---------|------|------|-----------------|
| DecisionCard | `packages/ui/src/decision-card.tsx` | 95 | Card + RadioGroup + Badge |
| DecisionProposalCard | `packages/ui/src/decision-proposal-card.tsx` | 203 | Card + Table + Badge |
| DeliverableCard | `packages/ui/src/deliverable-card.tsx` | 171 | Card + Collapsible + Badge |
| TaskCard | `packages/ui/src/task-card.tsx` | 104 | Card + Badge |
| StatusReportCard | `packages/ui/src/status-report-card.tsx` | 121 | Card + Badge |
| WorkflowResultCard | `packages/ui/src/workflow-result-card.tsx` | 113 | Card + Badge |
| SubAgentCard | `packages/ui/src/sub-agent-card.tsx` | 160 | Card + Collapsible + Bubble + Badge |
| SubAgentWindow | `apps/desktop/src/components/SubAgentWindow.tsx` | 247 | Card + Bubble + Collapsible + Badge |

**不可替换（无 shadcn 等价物，保留）：**

- `MarkdownContent`（marked + highlight.js 渲染管道）
- `SecretaryOrb`（自定义 CSS 动画角色）
- `WorkflowCanvas`（基于 @xyflow/react 的画布）
- `KanbanBoard`（看板拖拽）
- `Navigation`（复杂侧边栏逻辑）
- `TitleBar`（Tauri 拖拽区域）
- `ErrorBoundary`（React 错误边界）
- `animations/` 目录（ClickSpark、DecryptedText、GlareHover）

---

## 一、架构决策

### 1.1 CSS 变量策略：别名桥接

**不修改**现有主题系统的变量名（`--accent`、`--surface-primary` 等）。

**新增** shadcn 标准变量作为别名：

```css
/* 新建 apps/desktop/src/shadcn-vars.css */
:root,
[data-theme] {
  --background: var(--surface-primary);
  --foreground: var(--content-primary);
  --primary: var(--accent);
  --primary-foreground: var(--accent-foreground);
  --secondary: var(--surface-elevated);
  --secondary-foreground: var(--content-secondary);
  --muted: var(--surface-muted);
  --muted-foreground: var(--content-tertiary);
  --card: var(--surface-primary);
  --card-foreground: var(--content-primary);
  --popover: var(--surface-overlay);
  --popover-foreground: var(--content-primary);
  --border: var(--border-color);
  --input: var(--surface-input);
  --ring: var(--accent);
  --destructive: var(--intent-danger);
  --destructive-foreground: var(--intent-danger-foreground);
  --radius: var(--radius-md);

  /* Sidebar（shadcn Sidebar 需要） */
  --sidebar-background: var(--surface-sidebar);
  --sidebar-foreground: var(--content-primary);
  --sidebar-primary: var(--accent);
  --sidebar-primary-foreground: var(--accent-foreground);
  --sidebar-accent: var(--surface-elevated);
  --sidebar-accent-foreground: var(--content-secondary);
  --sidebar-border: var(--border-color);
  --sidebar-ring: var(--accent);

  /* Chart */
  --chart-1: var(--chart-1);
  --chart-2: var(--chart-2);
  --chart-3: var(--chart-3);
  --chart-4: var(--chart-4);
  --chart-5: var(--chart-5);
}
```

在 `apps/desktop/src/index.css` 第一行引入：

```css
@import './shadcn-vars.css';
```

**收益**：零破坏。所有现有类的 `bg-accent`、`text-content-primary` 继续工作，shadcn 组件的 `bg-primary`、`text-foreground` 也正常工作。

### 1.2 组件放置策略

```
apps/desktop/src/components/ui/    ← shadcn CLI 生成（npx shadcn add）
packages/ui/src/                    ← 删除手写组件，改为 re-export
```

`packages/ui/src/` 的原有组件文件改为从 `apps/desktop/src/components/ui/` re-export，保持 `@cabinet/ui` 导入路径不变。

### 1.3 `cn()` 工具更新

```ts
// packages/ui/src/cn.ts — 旧版（3 行）
export function cn(...inputs: (string | false | null | undefined)[]): string {
  return inputs.filter(Boolean).join(' ');
}

// 新版 — 从 shadcn 生成的 utils.ts re-export
export { cn } from '../../apps/desktop/src/lib/utils.js';
```

shadcn 生成的 `cn` 基于 `clsx` + `tailwind-merge`，自动处理类名冲突。

### 1.4 新增依赖

```jsonc
// apps/desktop/package.json
{
  "dependencies": {
    "class-variance-authority": "^0.7",
    "clsx": "^2.1",
    "tailwind-merge": "^3.0",
    "sonner": "^2.0",
    // 以下由 shadcn CLI 自动安装：
    // @radix-ui/react-dialog
    // @radix-ui/react-dropdown-menu
    // @radix-ui/react-collapsible
    // @radix-ui/react-radio-group
    // @radix-ui/react-select
    // @radix-ui/react-tabs
    // @radix-ui/react-tooltip
    // @radix-ui/react-scroll-area
    // @radix-ui/react-avatar
    // @radix-ui/react-context-menu
    // @radix-ui/react-popover
    // @radix-ui/react-separator
    // @radix-ui/react-toggle
    // @radix-ui/react-toggle-group
    // @radix-ui/react-switch
    // @radix-ui/react-checkbox
    // @radix-ui/react-slider
    // @radix-ui/react-label
    // ... 等
  }
}
```

---

## 二、Phase 0：基础设施准备（0.5 天）

### 步骤

1. **在 `apps/desktop/` 执行 shadcn init**

   ```bash
   cd apps/desktop
   npx shadcn@latest init
   ```

   交互选项：
   - Framework: Vite
   - TypeScript: Yes
   - Tailwind v4: Yes
   - CSS variables: Yes（生成后将由 shadcn-vars.css 覆盖）

2. **创建 `apps/desktop/src/shadcn-vars.css`**

   写入 1.1 中的别名桥接内容。

3. **修改 `apps/desktop/src/index.css`**

   在第一行添加：
   ```css
   @import './shadcn-vars.css';
   ```

4. **更新 `packages/ui/src/cn.ts`**

   替换为从 shadcn `lib/utils.ts` re-export。

5. **验证编译**

   ```bash
   pnpm --filter @cabinet/desktop typecheck
   ```

---

## 三、Phase 1：安装全部 shadcn 组件（0.5 天）

### 步骤

```bash
cd apps/desktop

# 基础组件
npx shadcn@latest add button card input textarea label badge tabs

# 交互组件
npx shadcn@latest add dialog sonner dropdown-menu popover select context-menu \
  command sheet drawer

# 数据组件
npx shadcn@latest add collapsible radio-group table alert separator avatar \
  skeleton spinner tooltip scroll-area toggle toggle-group switch checkbox \
  slider progress breadcrumb

# AI 聊天组件
npx shadcn@latest add message bubble marker attachment message-scroller
```

**验证**：

```bash
pnpm --filter @cabinet/desktop typecheck
pnpm --filter @cabinet/desktop build
```

---

## 四、Phase 2：基础组件替换 — packages/ui（2 天）

### 4.1 Button

| 项目 | 旧 API | 新 API |
|------|--------|--------|
| variants | `primary`, `secondary`, `destructive`, `ghost`, `outline` | `default`, `secondary`, `destructive`, `ghost`, `outline` |
| sizes | `xs`, `sm`, `md` | `default`, `sm`, `lg`, `icon` |
| loading | 内联 SVG spinner | 移除（改为 `Spinner` + `disabled`） |
| ClickSpark | 内置包裹 | 提取为独立 `ButtonWithSpark` HOC |

**迁移**：

```ts
// packages/ui/src/button.tsx — 改为 re-export
export { Button, buttonVariants, type ButtonProps } from
  '../../../apps/desktop/src/components/ui/button.js';

// 扩展 props 以兼容旧的 variant 值
export type { ButtonProps as _ButtonProps } from
  '../../../apps/desktop/src/components/ui/button.js';
```

**variant 映射**（在调用处）：
- `primary` → `default`（CSS 确保两者外观一致）
- `size="xs"` → `size="sm"` + `className="text-xs px-2 py-0.5"`
- `size="md"` → `size="default"`
- `fullWidth` → `className="w-full"`
- `loading` → `<Button disabled><Spinner className="mr-1" />{children}</Button>`

**ClickSpark** 提取为：

```tsx
// packages/ui/src/button-with-spark.tsx（新建）
export function ButtonWithSpark(props: ButtonProps) {
  return (
    <ClickSpark sparkColor="var(--accent)" sparkCount={5} sparkSize={5}
                sparkRadius={10} duration={300}>
      <Button {...props} />
    </ClickSpark>
  );
}
```

**受影响的文件**：全局搜索 `<Button` 的 ~30 个文件。

### 4.2 Card

| 旧 API | 新 API |
|--------|--------|
| `<Card padding="md">content</Card>` | `<Card><CardContent>content</CardContent></Card>` |
| `onClick` prop | `className="cursor-pointer" onClick={...}` |
| `hoverable` prop | `className="transition-shadow hover:shadow-sm"` |
| `as` prop | `asChild` 或手动指定 |
| GlareHover 包裹 | 提取为 `CardWithGlare` HOC |

**迁移**：`packages/ui/src/card.tsx` 改为：

```ts
export {
  Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent,
} from '../../../apps/desktop/src/components/ui/card.js';
```

**调用处批量改写**（~30+ 处）：

```tsx
// 旧
<Card padding="sm" onClick={handleClick} hoverable>
  <h3>Title</h3>
  <p>Desc</p>
</Card>

// 新
<Card className="cursor-pointer transition-shadow hover:shadow-sm" onClick={handleClick}>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Desc</CardDescription>
  </CardHeader>
</Card>
```

### 4.3 Input / Textarea / Label

- `packages/ui/src/input.tsx` → re-export shadcn `Input`
- 新增 re-export：`Textarea`、`Label`
- ChatPanel 中的裸 `<textarea>` → `<Textarea>`

### 4.4 Tabs

API 差异较大：

| 旧 | 新 |
|----|-----|
| `<Tabs tabs={[...]} activeTab={id} onTabChange={fn} />` | `<Tabs defaultValue={id}><TabsList><TabsTrigger>...</TabsTrigger></TabsList><TabsContent>...</TabsContent></Tabs>` |

保留旧 `Tabs` re-export 同时新增 shadcn 版本作为 `TabsGroup`（带内容面板）。逐步迁移调用处。

### 4.5 Tag → Badge

```ts
// packages/ui/src/tag.tsx — 改为 re-export
export { Badge as Tag, badgeVariants as tagVariants, type BadgeProps as TagProps } from
  '../../../apps/desktop/src/components/ui/badge.js';
```

扩展 shadcn Badge variants 添加：`success`、`warning`、`info`、`purple`、`amber`。

**验证**：

```bash
pnpm --filter @cabinet/desktop typecheck
pnpm --filter @cabinet/desktop test
```

---

## 五、Phase 3：交互组件替换 — apps/desktop（2 天）

### 5.1 ModalOverlay → Dialog

**删除**：`apps/desktop/src/components/ModalOverlay.tsx`（61 行）

**替换模式**：

```tsx
// 旧
<ModalOverlay isOpen={open} onClose={close}
  contentClassName="..." backdropClassName="...">
  <div>content</div>
</ModalOverlay>

// 新
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Title</DialogTitle>
      <DialogDescription>Description</DialogDescription>
    </DialogHeader>
    content
    <DialogFooter>
      <Button variant="outline" onClick={close}>Cancel</Button>
      <Button onClick={confirm}>Confirm</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**受影响的文件**：

| 文件 | 替换方式 |
|------|---------|
| `App.tsx`（project action modal） | Dialog + DialogContent |
| `FileSearchPanel.tsx`（文件搜索） | Dialog + Command（搜索组件） |
| `EmployeeEditModal.tsx` | Dialog + DialogFooter |
| `office/CostOverviewModal.tsx` | Dialog |
| `office/EventTimelineModal.tsx` | Dialog |
| `office/InsightsModal.tsx` | Dialog |
| `office/HarnessModal.tsx` | Dialog |
| `office/ActiveWorkflowsModal.tsx` | Dialog |
| `office/DeliverablesModal.tsx` | Dialog |
| `Workbench/InstallDialog.tsx` | Dialog |

**CSS 清理**：删除 `index.css` 中的 `.modal-backdrop`、`.modal-content`、`@keyframes panel-slide-right`（~40 行）。

### 5.2 Toast → Sonner

**删除**：`apps/desktop/src/components/Toast.tsx`（91 行）

**替换**：

```tsx
// main.tsx 中添加
import { Toaster } from 'sonner';

root.render(
  <App />
  <Toaster position="bottom-right" />
);
```

**API 迁移**：

```tsx
// 旧：const { addToast } = useToast();
//     addToast('success', 'Done');
// 新：import { toast } from 'sonner';
//     toast.success('Done');
//     toast.error('Failed');
//     toast.warning('Warning');
```

**受影响的文件**：

- `App.tsx`：WS 连接断开/重连 toast
- `App.tsx`：Fork session toast
- `App.tsx`：SubAgent approve 失败 toast
- `test-utils.tsx`：删除 `ToastProvider` 包裹

**CSS 清理**：删除 `index.css` 中的 `@keyframes slide-in/slide-out` + `.animate-slide-in/slide-out`（~30 行）。

### 5.3 ContextMenu → ContextMenu / DropdownMenu

**删除**：`apps/desktop/src/components/ContextMenu.tsx`（91 行）

**替换**：

```tsx
// 旧（命令式调用）
<ContextMenu x={e.clientX} y={e.clientY} title="Actions"
  entries={[{type:'item', item:{label:'Edit', onClick:edit}}]} onClose={close} />

// 新（声明式）
<ContextMenu>
  <ContextMenuTrigger>右键目标</ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuLabel>Actions</ContextMenuLabel>
    <ContextMenuItem onClick={edit}>Edit</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem onClick={del} className="text-destructive">Delete</ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
```

**受影响的文件**：
- `ProjectExplorer.tsx`
- `factory/CanvasContextMenu.tsx`

### 5.4 ChatPanel 中的 6 个自定义下拉 → DropdownMenu / Popover

**删除**：~200 行内联代码（6 个 boolean state + 6 个 ref + 6 个 `useOutsideClick` + 手动样式）

| 菜单 | 替换组件 |
|------|---------|
| Project selector | `DropdownMenu` |
| Add file menu | `DropdownMenu` |
| Skill menu | `DropdownMenu` |
| Slash skill overlay | `Popover`（从 textarea 上方弹出） |
| Model switcher | `DropdownMenu` |
| Delegation tier menu | `DropdownMenu` |

**示例**（Project selector）：

```tsx
// 旧：~30 行自定义 button + div + useOutsideClick
// 新：
<DropdownMenu open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="sm">
      @{currentProject?.name ?? 'no project'}
      <ChevronDown className="ml-1 h-3 w-3" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="start">
    <DropdownMenuLabel>Switch Project</DropdownMenuLabel>
    <DropdownMenuItem onClick={() => switch(null)}>
      Global (no project)
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    {projects.map(p => (
      <DropdownMenuItem key={p.id} onClick={() => switch(p.id)}>
        {p.name}
      </DropdownMenuItem>
    ))}
    <DropdownMenuSeparator />
    <DropdownMenuItem onClick={onNewProject}>
      + New Project
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

### 5.5 ProjectSwitcher → Select

**删除**：`apps/desktop/src/components/ProjectSwitcher.tsx`（72 行）

```tsx
<Select value={current?.id} onValueChange={onSwitch}>
  <SelectTrigger>
    <SelectValue placeholder="No project" />
  </SelectTrigger>
  <SelectContent>
    {projects.map(p => (
      <SelectItem key={p.id} value={p.id}>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${statusColors[p.status]}`} />
          {p.name}
        </div>
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

---

## 六、Phase 4：AI 聊天组件替换（3 天）

### 6.1 滚动系统 → MessageScroller（ChatView.tsx）

**删除**：~100 行手动滚动逻辑

- `scrollRef` + `isNearBottomRef` ref
- `showScrollButton` state
- scroll 事件监听 useEffect
- auto-scroll useEffect（监听 messages 变化）
- "New messages ↓" 手动 button

**替换**：

```tsx
import {
  MessageScroller, MessageScrollerProvider, MessageScrollerViewport,
  MessageScrollerContent, MessageScrollerItem, MessageScrollerButton,
} from '@/components/ui/message-scroller';

// ChatView 的 return 中：
<MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor"
  scrollPreviousItemPeek={64}>
  <MessageScroller className="flex-1">
    <MessageScrollerViewport>
      <MessageScrollerContent>
        {messages.map(msg => (
          <MessageScrollerItem
            key={msg.id}
            messageId={msg.id}
            scrollAnchor={msg.role === 'user'}
          >
            <MessageRow msg={msg} ... />
          </MessageScrollerItem>
        ))}
      </MessageScrollerContent>
    </MessageScrollerViewport>
    <MessageScrollerButton />
  </MessageScroller>
</MessageScrollerProvider>
```

**收益**：自动获得锚定回合、流式跟随、加载历史不跳、重开会话定位、跳转消息 API。

### 6.2 消息行 → Message + Bubble + Marker（ChatView.tsx）

**当前** `MessageRow`（~200 行）的布局 → **全部替换为组合式结构**：

```tsx
<Message align={msg.role === 'user' ? 'end' : 'start'}>
  <MessageAvatar>
    <Avatar>
      <AvatarFallback>
        {msg.role === 'user' ? 'Y' : (msg.agentName?.[0] ?? 'S')}
      </AvatarFallback>
    </Avatar>
  </MessageAvatar>

  <MessageContent>
    <MessageHeader>
      <span className="text-xs font-medium">
        {msg.role === 'user' ? 'You' : (msg.agentName ?? 'Secretary')}
      </span>
      <span className="ml-2 text-xs text-muted-foreground">
        {msg.timestamp.toLocaleTimeString()}
      </span>
      {msg.routing && (
        <Badge variant="purple" className="ml-2">
          {msg.routing.from} → {msg.routing.to}
        </Badge>
      )}
    </MessageHeader>

    <Bubble
      variant={msg.isError ? 'destructive' :
               msg.role === 'user' ? 'default' : 'ghost'}
      align={msg.role === 'user' ? 'end' : 'start'}
    >
      {/* ═══ 以下保留业务逻辑 ═══ */}

      {/* TaskPanel */}
      {(msg.semanticTasks || msg.tasks) && (
        <TaskPanel semanticTasks={msg.semanticTasks} tasks={msg.tasks} />
      )}

      {/* Step budget 警告 */}
      {msg.stepBudget && msg.stepBudget.remaining <= threshold && (
        <Alert variant={msg.stepBudget.remaining <= 0 ? 'destructive' : 'default'}
               className="mb-2">
          <AlertCircle className="h-3 w-3" />
          <AlertDescription className="text-[10px]">
            {msg.stepBudget.remaining <= 0
              ? `Step budget exhausted (${msg.stepBudget.maxSteps}/${msg.stepBudget.maxSteps})`
              : `Step budget running low (${msg.stepBudget.remaining}/${msg.stepBudget.maxSteps})`}
          </AlertDescription>
        </Alert>
      )}

      {/* SubAgentCard */}
      {msg.subAgentActivities?.map((a, i) => (
        <SubAgentCard key={`${msg.id}_sub_${i}`} activity={a} visibility="detailed" />
      ))}

      {/* Thinking 块 */}
      {msg.thinking && (
        <Collapsible className="mb-2">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-xs text-muted-foreground
                               uppercase tracking-wide hover:text-secondary-foreground">
              <Marker role="status">
                <MarkerIcon><Spinner /></MarkerIcon>
                <MarkerContent className="shimmer">
                  Thinking... ({duration})
                </MarkerContent>
              </Marker>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap
                           rounded border border-border bg-muted p-2 text-xs
                           text-secondary-foreground">
              {msg.thinking.replace(/\n?<!--segment-->\n?/g, '\n')}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Markdown 渲染 */}
      <MarkdownContent content={msg.content} />

      {/* ToolCallSummary */}
      {msg.toolCalls?.length > 0 && (
        <ToolCallSummary toolCalls={msg.toolCalls} isStreaming={msg.isStreaming} />
      )}

      {/* WorkflowRunCard */}
      {renderWorkflowResult(msg)}

      {/* 流式光标 */}
      {msg.isStreaming && (
        <Marker role="status" className="ml-1 inline-block">
          <MarkerIcon>
            <span className="inline-block h-4 w-2 animate-pulse rounded-full bg-primary" />
          </MarkerIcon>
        </Marker>
      )}

      {/* Continue 按钮 */}
      {msg.content.includes('[INCOMPLETE: max_steps_reached]') && onContinue && (
        <Button variant="outline" size="sm" onClick={() => onContinue(msg.id)}
                disabled={isProcessing} className="mt-2">
          Continue →
        </Button>
      )}
    </Bubble>

    {/* 操作按钮 */}
    <MessageFooter>
      {msg.role === 'user' && onEditMessage && (
        <Button variant="ghost" size="icon-xs"
                onClick={() => setEditing(true)}
                aria-label="Edit message">
          <Pencil className="h-3 w-3" />
        </Button>
      )}
      {msg.role === 'assistant' && onRegenerate && (
        <Button variant="ghost" size="icon-xs"
                onClick={() => onRegenerate(msg.id)}
                aria-label="Regenerate">
          <RefreshCw className="h-3 w-3" />
        </Button>
      )}
      {onForkMessage && (
        <Button variant="ghost" size="icon-xs"
                onClick={() => onForkMessage(msg.id)}
                aria-label="Fork session">
          <GitFork className="h-3 w-3" />
        </Button>
      )}
    </MessageFooter>
  </MessageContent>
</Message>
```

**Thinking 块**：`<details>` → `Collapsible`（原生 `<details>` 无动画、无受控状态）。

**流式指示器**：手写 `animate-pulse` span → `Marker` + `Spinner` + `shimmer`。

**错误状态**：手写红色左边框 → `Bubble` variant="destructive"。

**操作按钮**：手写 `hover:group-hover:flex` → `MessageFooter` 自动显示/隐藏。

### 6.3 ChatPanel 中剩余的手写下拉

已覆盖在 Phase 3（详见 5.4）。

### 6.4 文件附件 → Attachment + AttachmentGroup

**ChatView**：

```tsx
// 旧
<div className="flex flex-wrap items-center gap-1.5 border-b px-5 py-1.5">
  <span className="text-xs text-content-tertiary">Attached:</span>
  {attachedFiles.map(f => (
    <span className="bg-accent-muted text-accent rounded-sm px-1.5 py-0.5 text-xs">
      {f.name}
    </span>
  ))}
</div>

// 新
<AttachmentGroup className="border-b border-border px-5 py-2">
  {attachedFiles.map(f => (
    <Attachment key={f.id} size="sm">
      <AttachmentMedia><FileTextIcon className="h-4 w-4" /></AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{f.name}</AttachmentTitle>
        <AttachmentDescription>{f.type}</AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  ))}
</AttachmentGroup>
```

**ChatPanel**（文件附件预览区域 + 移除按钮）：

```tsx
<AttachmentGroup className="px-3 py-1.5">
  {attachedFiles.map(f => (
    <Attachment key={f.id} size="xs">
      <AttachmentMedia><FileTextIcon className="h-3 w-3" /></AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{f.type === 'project' ? f.path : f.name}</AttachmentTitle>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction
          aria-label={`Remove ${f.name}`}
          onClick={() => onRemoveFile(active.id, f.id)}>
          <X className="h-3 w-3" />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  ))}
</AttachmentGroup>
```

### 6.5 ToolCallSummary 重构

| 子功能 | 旧 | 新 |
|--------|-----|-----|
| Running 状态 | `animate-pulse` div | `Marker` role="status" + `Spinner` |
| 工具名预览 | 自定义 span + 自定义 class | `Badge` variant="secondary" |
| 展开/折叠 | `useState` + 条件渲染 | `Collapsible` + `CollapsibleTrigger` |
| 工具列表 | 自定义 div 布局 | 保留（数据驱动） |
| `formatToolPreview()` | 保留 | 保留（业务逻辑） |

---

## 七、Phase 5：业务卡片组件重构（2 天）

### 7.1 批量重写模式

6 个结构化输出卡片 + 2 个 SubAgent 卡片的共同模式：

```tsx
// 统一新模式
<Card className="my-3">
  <CardHeader>
    <CardTitle className="text-sm">{emoji} {title}</CardTitle>
    <CardDescription className="flex items-center justify-between">
      <Badge variant={priorityVariant}>{priority}</Badge>
      <span>{timestamp / generationTime}</span>
    </CardDescription>
  </CardHeader>
  <CardContent className="space-y-2">
    {/* 业务自定义内容 */}
  </CardContent>
  <CardFooter className="flex gap-2">
    <Button variant="default" size="sm" onClick={confirm}>Approve</Button>
    <Button variant="outline" size="sm" onClick={reject}>Reject</Button>
    <Button variant="ghost" size="sm" onClick={more}>Details</Button>
  </CardFooter>
</Card>
```

### 7.2 各卡片变更明细

| 卡片 | 文件 | 当前行数 | 预计行数 | 主要变更 |
|------|------|---------|---------|---------|
| DecisionCard | `decision-card.tsx` | 95 | ~65 | `input[radio]` → `RadioGroup` + `RadioGroupItem`；级别 color → `Badge`；操作按钮 → `Button` |
| DecisionProposalCard | `decision-proposal-card.tsx` | 203 | ~140 | `<table>` → `Table` 系列组件；优先级 → `Badge`；状态栏 → `Alert` |
| DeliverableCard | `deliverable-card.tsx` | 171 | ~120 | 展开/折叠 → `Collapsible`；操作按钮 → `Button`；状态栏 → `Alert` |
| TaskCard | `task-card.tsx` | 104 | ~80 | 任务状态图标 → `Badge`；操作按钮 → `Button` |
| StatusReportCard | `status-report-card.tsx` | 121 | ~90 | 指标块 → `Card` 子卡片；workflow 行 → 内联列表 |
| WorkflowResultCard | `workflow-result-card.tsx` | 113 | ~85 | Node flow → 内联 `Badge` 链；alert 行 → 内联列表 |
| SubAgentCard | `sub-agent-card.tsx` | 160 | ~95 | 整体 → `Card`；展开 → `Collapsible`；think/tool calls 展开 → 嵌套 `Collapsible`；工具名 → `Badge` |
| SubAgentWindow | `SubAgentWindow.tsx` | 247 | ~165 | 同上 + 消息内容 → `Bubble`；操作按钮 → `Button` |

**总计**：~1214 行 → ~840 行（减少 ~30%）

### 7.3 DecisionProposalCard 示例

这是最复杂的卡片，包含评分矩阵表格：

```tsx
// 旧：手写 <table><thead><tr><th>...</th></tr></thead><tbody>...</tbody></table>
// 新：
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Dimension</TableHead>
      {data.options.map(opt => (
        <TableHead key={opt.label} className="text-center">{opt.label}</TableHead>
      ))}
    </TableRow>
  </TableHeader>
  <TableBody>
    {data.dimensions.map(dim => (
      <TableRow key={dim}>
        <TableCell>{dim}</TableCell>
        {data.options.map(opt => {
          const score = opt.scores[dim];
          const isMax = score !== undefined &&
            data.options.every(o => (o.scores[dim] ?? 0) <= score);
          return (
            <TableCell key={opt.label} className={`text-center ${isMax ? 'font-semibold text-green-500' : 'text-muted-foreground'}`}>
              {score !== undefined ? `${score}/10` : '-'}
            </TableCell>
          );
        })}
      </TableRow>
    ))}
  </TableBody>
</Table>
```

---

## 八、Phase 6：边缘组件 + CSS 清理（1 天）

### 8.1 动画组件解耦

| 组件 | 操作 |
|------|------|
| `ClickSpark` | 从 Button 解耦，创建独立 `ButtonWithSpark` |
| `GlareHover` | 从 Card 解耦，创建独立 `CardWithGlare` |
| `DecryptedText` | 无需变动 |

### 8.2 评估保留的组件

| 组件 | 评估 | 决策 |
|------|------|------|
| `Navigation` | 可用 `Sidebar` 重构，但逻辑复杂（折叠/宽度拖拽/session 列表/项目导航），成本高 | 保留，后续单独评估 |
| `SessionSidebar` | 可用 `Sheet` 包裹（移动端） | 保留，添加 `Sheet` 包裹 |
| `MobileNav` | 可用 `NavigationMenu` 简化 | 低优先级，保留 |
| `ErrorBoundary` | React 类组件 | 保留 |
| `SecretaryOrb` | 纯 CSS 动画角色，无等价物 | 保留 |
| `ServerLoading` | 加载 spinner → `Skeleton` | 用 Skeleton 替换 spinner |
| `NotificationBell` + `NotificationManager` | 下拉用 `Popover` | 替换内部下拉 |
| `FileViewer` | 可使用 `Sheet` 或 `Dialog` | 替换弹出层 |
| `ProjectExplorer` | 无 shadcn Tree 组件 | 保留 |
| `WorkflowCanvas` 等 factory 组件 | 基于 @xyflow/react | 保留 |

### 8.3 CSS 清理

**删除项**（`index.css`）：

| 删除 | 行数 | 原因 |
|------|------|------|
| `.modal-backdrop` + `.modal-content` + `@keyframes` | ~40 | Dialog 内置动画 |
| `.animate-slide-in/slide-out` + `@keyframes` | ~30 | Sonner 内置动画 |
| `.dropdown-enter` + `@keyframes dropdown-in` | ~15 | DropdownMenu 内置动画 |
| `.file-search-enter` + `@keyframes` | ~15 | Dialog 内置动画 |
| `.tool-summary*` 系列 | ~50 | Marker + Badge 替代 |
| `.tool-chip*` 系列 | ~30 | Badge 替代 |
| `.tool-group*` 系列 | ~25 | Collapsible 替代 |
| `.thinking-block` + `.thinking-summary` + `.thinking-content` | ~25 | Collapsible 替代 |
| 按钮/卡片冗余 class（如 shadcn 已覆盖的） | ~20 | Button/Card variants 替代 |

**预计 CSS 减少**：~250 行。

---

## 九、Phase 7：测试与验证（1 天）

### 9.1 编译验证

```bash
pnpm --filter @cabinet/desktop typecheck
pnpm --filter @cabinet/desktop build
```

### 9.2 单元测试

```bash
pnpm --filter @cabinet/desktop test
```

重点关注的测试文件：

| 测试文件 | 关注点 |
|---------|--------|
| `ChatView.test.tsx` | Message/Bubble/Marker 渲染、滚动行为 |
| `ChatPanel.test.tsx` | DropdownMenu 交互、Attachment 渲染 |
| `Toast.test.tsx` | Sonner API 兼容性 |
| `components.test.tsx` | UI 组件快照/行为 |
| `DecisionList.test.tsx` | Card/RadioGroup/Badge 渲染 |
| `DecisionReviewPanel.test.tsx` | 同上 |
| `Deliverables.test.tsx` | Card/Collapsible/Badge 渲染 |
| `EventTimeline.test.tsx` | Timeline 布局 |
| `SystemHealth.test.tsx` | Metric 卡片 |
| `ProgressBoard.test.tsx` | 进度卡片 |

### 9.3 视觉回归检查

- 16 套主题 × 关键页面截图对比
- 检查点：Button 变体颜色、Card 圆角/阴影、Dialog 动画、Message 对齐、Bubble 变体、Badge 颜色

---

## 十、汇总

### 代码量变化

| 范围 | 当前 | 预计 | 变化 |
|------|------|------|------|
| `packages/ui/src/` 手写组件 | ~1,000 行 | ~300 行（re-export） | -700 |
| `apps/desktop/src/components/` 手写组件 | ~800 行 | ~500 行（保留业务逻辑） | -300 |
| ChatView + ChatPanel 滚动 + 布局 + 下拉 | ~500 行 | ~150 行 | -350 |
| CSS（`index.css`） | ~1,845 行 | ~1,595 行 | -250 |
| 新增 shadcn 生成代码 | 0 | ~8,000 行（CLI 生成） | +8,000 |
| **净变化** | | | **+6,400 行（shadcn 库代码）** |

### 手写代码减少

| 类型 | 减少行数 |
|------|---------|
| 删除手写组件文件 | ~1,500 行 |
| ChatView/ChatPanel 简化 | ~350 行 |
| CSS 清理 | ~250 行 |
| **手写代码合计减少** | **~2,100 行** |

### 执行顺序依赖

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3
                                └──→ Phase 4 ──→ Phase 5
                                              └──→ Phase 6 ──→ Phase 7
                                          Phase 2 ←── Phase 3
```

Phase 2（基础组件）和 Phase 3-5（上层组件）可部分并行，因为上层组件依赖基础组件的结果。

---

## 十一、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| shadcn 样式与项目 token 不匹配 | 中 | 中 | CSS 别名桥接 + 必要时覆盖组件 variant |
| `MessageScroller` 性能不满足需求 | 低 | 低 | 项目聊天量 < 100 条/会话，`content-visibility: auto` 足够 |
| `Bubble` ghost variant 与 markdown 渲染冲突 | 低 | 中 | ghost 无 max-width，适合 markdown。验证 highlight.js 代码块样式 |
| Dialog API 变更破坏弹窗行为 | 中 | 高 | 逐个文件迁移，每个弹窗单独验证 |
| 测试大规模失败 | 中 | 中 | 每个 Phase 结束后跑一次 typecheck + test |
| Theme generate-css.ts 需更新 | 低 | 低 | 如 shadcn 变量未在 `@theme inline` 声明，需添加 |
| 第三方依赖版本冲突 | 低 | 中 | 使用 `npx shadcn@latest` 自动管理 Radix 版本 |
| Navigation 组件重构复杂度过高 | 高 | 低 | 明确保留，不在本次范围 |
