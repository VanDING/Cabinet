# Secretary 悬浮球与 ChatPanel 状态重构设计

> 设计日期：2026-06-03  
> 状态：待实施  
> 关联：apps/desktop ChatPanel、ChatView、ChatContext

---

## 1. 设计目标

将当前常驻的 ChatPanel 改造为**按需出现**的交互形态：

- 日常浏览页面时，ChatPanel 隐藏，右下角显示 Secretary 悬浮球
- 悬浮球作为 Secretary 的常驻代表，可主动以气泡形式汇报
- 点击悬浮球展开浮层 ChatPanel，任意页面可快速进入对话
- 需要深度对话时，进入全屏对话模式（复用现有 `chatMode` 视图）
- 展开/收起动画自然平滑，悬浮球具备桌面宠物感

---

## 2. 状态机

全局只有两种 UI 状态，存储于 `ChatContext` 中：

```typescript
type UIMode = 'collapsed' | 'overlay' | 'chat';

interface ChatContextValue {
  // ... 现有字段 ...
  uiMode: UIMode;
  setUIMode: (mode: UIMode) => void;
}
```

| 状态        | 显示内容                               | 场景                                     |
| ----------- | -------------------------------------- | ---------------------------------------- |
| `collapsed` | 只显示 `SecretaryOrb`（右下角悬浮球）  | 日常浏览 Office/Factory/Settings 等页面  |
| `overlay`   | 悬浮球 + 浮层面板 `OverlayChatPanel`   | 用户点击悬浮球，临时对话                 |
| `chat`      | 主内容区 `ChatView` + 底部 `ChatPanel` | 沉浸式深度对话，复用现有 `chatMode` 逻辑 |

### 状态流转

```
collapsed
  │ 点击悬浮球
  ▼
overlay ──(点击"展开对话")──► chat
  │                             │
  │(点击外部/ESC/收起按钮)        │(点击返回)
  ▼                             ▼
collapsed ◄────────────────── collapsed
```

---

## 3. 组件设计

### 3.1 SecretaryOrb — 悬浮球

**定位**：`fixed bottom-6 right-6 z-50`，脱离文档流，不受页面布局影响。

**尺寸**：56px × 56px，圆形。

**外观（主题适配）**：

```
Light 主题：
  - 背景：cyan-400 → blue-500 渐变
  - 边框：白色 2px
  - 阴影：shadow-lg shadow-blue-500/20

Dark 主题：
  - 背景：cyan-600 → blue-800 渐变
  - 边框：gray-800 2px
  - 阴影：shadow-lg shadow-cyan-500/20（微弱发光）
```

**状态反馈**：

| 状态     | 视觉表现                                        |
| -------- | ----------------------------------------------- |
| 空闲     | `orb-breathe` 呼吸动画（轻微缩放 + 透明度变化） |
| 有新消息 | 红点角标 + `float-gentle` 上下浮动 2 次         |
| 处理中   | 外圈 SVG 旋转进度环（`stroke-dashoffset`）      |
| 被 Hover | `scale(1.1)`，显示 Tooltip "Secretary"          |

**情绪状态（桌面宠物感）**：

| 情绪        | 触发条件     | 视觉表现            |
| ----------- | ------------ | ------------------- |
| `idle`      | 默认         | 正常呼吸            |
| `thinking`  | AI 处理中    | 进度环旋转          |
| `happy`     | 任务完成     | 轻微弹跳 + 颜色偏亮 |
| `surprised` | 收到重要通知 | 快速放大再缩回      |
| `sleepy`    | 深夜时段     | 呼吸变慢，眨眼动画  |

情绪通过 CSS class 切换实现，V1 实现 `idle/thinking/happy` 三种。

**交互**：

| 操作     | 行为                                 |
| -------- | ------------------------------------ |
| 左键单击 | `setUIMode('overlay')`               |
| 右键单击 | 快捷菜单：展开对话 / 清空会话 / 设置 |

---

### 3.2 OverlayChatPanel — 浮层对话面板

**定位**：`fixed bottom-24 right-6 z-40`

**尺寸**：宽度 480px，最大高度 70vh，最小高度 320px。

**背景**：`bg-white/90 dark:bg-gray-900/90 backdrop-blur-md`，圆角 16px，边框 `border border-gray-200 dark:border-gray-700`。

**结构**：

```
┌─────────────────────────────────────┐
│  [≡] Secretary       [□] [×]        │  ← 标题栏（可拖拽移动位置）
├─────────────────────────────────────┤
│                                     │
│  ChatView（消息列表，复用现有）        │  ← 内容区，自动滚动
│                                     │
├─────────────────────────────────────┤
│  ChatPanel（输入框，复用现有）         │  ← 底部输入区
└─────────────────────────────────────┘
```

**与现有组件的关系**：

- `ChatView`：直接复用，传入 `sessionId` 和消息列表即可
- `ChatPanel`：将核心输入逻辑抽离为可复用组件，浮层面板嵌入使用
- 不重复实现任何聊天逻辑，只做"外壳"

**关闭方式**：

- 点击面板外部区域
- 按 ESC 键
- 点击标题栏的 × 按钮
- 收起按钮（□）将状态切回 `collapsed`

---

### 3.3 SecretaryBubble — 主动汇报气泡

**定位**：`fixed`，从 `SecretaryOrb` 左上方弹出，基于球的坐标计算偏移（`bottom-24 right-20` 区域）。

**尺寸**：最大宽度 280px，自适应高度。

**样式**：

```
- 圆角：12px
- 背景：与 Orb 同色系，略浅
- 尾巴：左下指向 Orb 的小三角（CSS border 技巧或 SVG）
- 边框：半透明描边
```

**内容结构**：

```
┌────────────────────────┐◄── 小三角指向 Orb
│ [icon] 标题              │
│ 正文内容（最多 3 行）      │
│ [操作1] [操作2]         │  ← 可选操作按钮
└────────────────────────┘
```

**生命周期**：

- 默认 6 秒后自动消失
- 鼠标 Hover 时暂停倒计时
- 点击气泡本身不消失，点击操作按钮或外部消失
- 最多同时显示 3 个气泡，超出时新气泡替换最早的

**通知类型与样式**：

| 类型          | 边框/图标色 | 场景                   |
| ------------- | ----------- | ---------------------- |
| `info`        | blue        | 普通通知、状态更新     |
| `success`     | green       | 任务完成、操作成功     |
| `warning`     | amber       | 需要注意、即将到期     |
| `interactive` | cyan        | 需要用户决策、确认操作 |

**气泡动作（桌面宠物感）**：

- 弹出：`bubble-pop` 动画（缩放 + 位移）
- 空闲：`float-gentle` 轻微上下浮动
- 尾巴微摆：`tail-wag` 左右轻微旋转
- 消失：`fade-out-up` 缩小上浮消失

---

### 3.4 NotificationManager — 气泡队列管理

独立组件，负责：

- 接收通知事件（来自 `ChatContext` 或外部事件源）
- 管理气泡队列（最多 3 个）
- 控制每个气泡的生命周期和自动消失
- 提供 API：`sendNotification()`、`dismissNotification(id)`

---

## 4. 动画方案

不使用 Framer Motion，全部使用 Tailwind CSS + 自定义 Keyframes。

```css
/* index.css 新增 */

@keyframes orb-breathe {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.9;
  }
  50% {
    transform: scale(1.05);
    opacity: 1;
  }
}

@keyframes float-gentle {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}

@keyframes bubble-pop {
  0% {
    transform: scale(0) translateY(10px);
    opacity: 0;
  }
  70% {
    transform: scale(1.05) translateY(-4px);
    opacity: 1;
  }
  100% {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
}

@keyframes panel-rise {
  0% {
    transform: translateY(20px) scale(0.95);
    opacity: 0;
  }
  100% {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}

@keyframes panel-sink {
  0% {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
  100% {
    transform: translateY(20px) scale(0.95);
    opacity: 0;
  }
}

@keyframes tail-wag {
  0%,
  100% {
    transform: rotate(-3deg);
  }
  50% {
    transform: rotate(3deg);
  }
}

@keyframes fade-out-up {
  0% {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
  100% {
    transform: translateY(-10px) scale(0.9);
    opacity: 0;
  }
}
```

### 展开/收起动画时序

**展开（collapsed → overlay）**：

1. `0ms`：Orb 缩小消失（`scale(0)` + `opacity: 0`，200ms ease-out）
2. `50ms`：浮层面板从 Orb 位置`panel-rise`升起（300ms ease-out，transform-origin: bottom right）
3. `100ms`：面板内消息列表 stagger 进入（每条延迟 30ms，opacity + translateY）

**收起（overlay → collapsed）**：

1. `0ms`：面板 `panel-sink` 下沉消失（200ms ease-in）
2. `100ms`：Orb `scale(0→1)` + `opacity(0→1)` 出现（200ms ease-out）

---

## 5. 主题与外观系统

### 悬浮球主题切换

使用 Tailwind v4 的 `dark:` 变体：

```tsx
<div
  className={`h-14 w-14 rounded-full border-2 border-white bg-gradient-to-br from-cyan-400 to-blue-500 shadow-lg shadow-blue-500/20 transition-all duration-300 dark:border-gray-800 dark:from-cyan-600 dark:to-blue-800 dark:shadow-cyan-500/20 ${mood === 'thinking' ? 'animate-[spin_3s_linear_infinite]' : ''} ${mood === 'happy' ? 'animate-[orb-breathe_1s_ease-in-out_infinite]' : ''} `}
>
  <SecretaryAvatar mood={mood} />
</div>
```

### 情绪配色映射

| 情绪        | Light 渐变             | Dark 渐变              | 备注   |
| ----------- | ---------------------- | ---------------------- | ------ |
| `idle`      | cyan-400 → blue-500    | cyan-600 → blue-800    | 默认   |
| `thinking`  | blue-400 → indigo-500  | blue-600 → indigo-800  | 偏冷色 |
| `happy`     | cyan-300 → sky-400     | cyan-500 → sky-600     | 偏亮色 |
| `surprised` | amber-300 → orange-400 | amber-500 → orange-600 | 偏暖色 |

---

## 6. 交互细节

### 6.1 路由与默认状态

| 路由         | 默认 `uiMode` | 说明                 |
| ------------ | ------------- | -------------------- |
| `/` (Office) | `collapsed`   | 显示悬浮球           |
| `/factory`   | `collapsed`   | 显示悬浮球           |
| `/discovery` | `collapsed`   | 显示悬浮球           |
| `/settings`  | `collapsed`   | 显示悬浮球           |
| `/memory`    | `collapsed`   | 显示悬浮球           |
| `/employees` | `collapsed`   | 显示悬浮球           |
| `/chat`      | `chat`        | 沉浸式对话，无悬浮球 |

从 `chat` 返回时，恢复为 `collapsed`。

### 6.2 快捷操作

| 场景           | 操作               | 行为                                      |
| -------------- | ------------------ | ----------------------------------------- |
| 任意页面       | 点击 Orb           | 进入 `overlay`                            |
| `overlay` 状态 | 按 ESC             | 回到 `collapsed`                          |
| `overlay` 状态 | 点击外部           | 回到 `collapsed`                          |
| `overlay` 状态 | 点击"展开对话"     | 进入 `chat`（全屏）                       |
| `chat` 状态    | 点击返回按钮       | 回到 `collapsed`，恢复之前页面            |
| 全局           | Secretary 主动通知 | 气泡弹出，Orb 变为 `happy` 或 `surprised` |

### 6.3 智能行为

- **未读消息**：Orb 显示红点角标，数字为未读计数
- **深夜模式**（22:00-07:00）：Orb 自动切换为 `sleepy` 状态，呼吸变慢
- **长时间无交互**（>5 分钟）：Orb 偶尔随机眨眼或轻微晃动
- **气泡避让**：气泡弹出前检测鼠标位置，若鼠标在目标区域，延迟 2 秒再显示

---

## 7. 数据结构扩展

### 7.1 ChatContext 新增

```typescript
// apps/desktop/src/contexts/ChatContext.tsx

type UIMode = 'collapsed' | 'overlay' | 'chat';

type OrbMood = 'idle' | 'thinking' | 'happy' | 'surprised' | 'sleepy';

interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'interactive';
  title: string;
  body?: string;
  actions?: Array<{
    label: string;
    onClick: () => void;
  }>;
  timestamp: number;
  autoDismiss?: number; // ms，默认 6000
  mood?: OrbMood; // 触发 Orb 的情绪变化
}

interface ChatContextValue {
  // ... 现有字段 ...

  // UI 模式
  uiMode: UIMode;
  setUIMode: (mode: UIMode) => void;

  // Orb 情绪
  orbMood: OrbMood;
  setOrbMood: (mood: OrbMood) => void;

  // 通知系统
  notifications: Notification[];
  sendNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  dismissNotification: (id: string) => void;
}
```

### 7.2 通知发送示例

```typescript
sendNotification({
  type: 'success',
  title: '任务完成',
  body: '文档 "Q3 报告" 已生成完毕',
  actions: [
    { label: '查看', onClick: () => navigate('/memory') },
    { label: '忽略', onClick: () => {} },
  ],
  mood: 'happy',
});
```

---

## 8. 文件变更清单

| 文件                                                  | 操作         | 说明                                                |
| ----------------------------------------------------- | ------------ | --------------------------------------------------- |
| `apps/desktop/src/components/SecretaryOrb.tsx`        | **新建**     | 悬浮球组件                                          |
| `apps/desktop/src/components/OverlayChatPanel.tsx`    | **新建**     | 浮层对话面板外壳                                    |
| `apps/desktop/src/components/SecretaryBubble.tsx`     | **新建**     | 单个气泡组件                                        |
| `apps/desktop/src/components/NotificationManager.tsx` | **新建**     | 气泡队列管理器                                      |
| `apps/desktop/src/contexts/ChatContext.tsx`           | **修改**     | 添加 `uiMode`、`orbMood`、通知 API                  |
| `apps/desktop/src/App.tsx`                            | **修改**     | 条件渲染 Orb/Overlay/ChatView，移除无条件 ChatPanel |
| `apps/desktop/src/components/ChatPanel.tsx`           | **修改**     | 抽离核心输入区为可复用组件                          |
| `apps/desktop/src/index.css`                          | **修改**     | 新增 orb、bubble、panel 动画 keyframes              |
| `apps/desktop/src/pages/ChatPage.tsx`                 | **可选新建** | 若需要 `/chat` 独立路由时创建                       |

---

## 9. 实施顺序

| 阶段   | 内容                                                                     | 目标                        |
| ------ | ------------------------------------------------------------------------ | --------------------------- |
| **P0** | `uiMode` 状态机、`App.tsx` 条件渲染、`SecretaryOrb` 基础形态             | 悬浮球可见，能切换展开/收起 |
| **P1** | `OverlayChatPanel` 外壳、整合现有 `ChatPanel` + `ChatView`、展开收起动画 | 浮层面板可正常对话          |
| **P2** | `SecretaryBubble` + `NotificationManager`、通知 API、气泡动画            | Secretary 能主动汇报        |
| **P3** | `chat` 模式路由衔接、返回逻辑、状态持久化                                | 沉浸式对话与浮层无缝切换    |
| **P4** | 主题切换、情绪动画、深夜模式、未读红点                                   | 桌面宠物感                  |

---

## 10. 注意事项

1. **不引入新依赖**：动画全部用 CSS，不安装 Framer Motion / GSAP
2. **复用现有逻辑**：`ChatView`、`ChatPanel` 的核心逻辑不改动，只做外壳包装
3. **键盘无障碍**：ESC 关闭浮层、Tab 聚焦 Orb、Enter 展开对话
4. **性能**：Orb 使用 `will-change: transform`，避免重排；气泡使用 `position: fixed` 脱离文档流
5. **向后兼容**：现有 `chatMode` 逻辑保留，逐步迁移到 `uiMode`，避免一次性大改
