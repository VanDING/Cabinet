# WelcomeHeader — Greeting Redesign

**Date:** 2026-06-21
**Status:** Draft

---

## 1. Current State

```
┌──────────────────────────────────────────────────────────┐
│  Good morning, Captain                                    │
│  Select a project or start a new task to begin working   │
│  with your agents.                                       │
│                                                          │
│  [+ New Project]  [Quick Task]  [Open Recent]            │
└──────────────────────────────────────────────────────────┘
```

问题：

- 问候语只有 3 种（Good morning/afternoon/evening），过于单调
- 副标题是静态文本，不反映实际状态
- 没有上下文数据（项目数、会话数等）
- 按钮缺少区分度（三个按钮看起来一样）

---

## 2. Proposed Design

### 2.1 Rich Greeting (~48px avatar area + varied salutation)

顶部区域展示时间感知的多样化问候 + 状态摘要：

```
┌──────────────────────────────────────────────────────────┐
│ ┌────┐                                                    │
│ │ 🧠 │  Good morning, Captain · ☀️ 08:42 · Tuesday       │
│ │    │  It's a great day to build something.              │
│ └────┘                                                    │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ 📁 4     │  │ 💬 12    │  │ 🤖 3     │  │ ⚡ 2     │ │
│  │ Projects │  │ Sessions │  │ Agents   │  │ Active   │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
│                                                          │
│  [+ New Project]  [Quick Task →]  [Open Recent ▾]        │
└──────────────────────────────────────────────────────────┘
```

### 2.2 Greeting Variants (Time + Day-of-Week)

| Time        | Greeting                    |
| ----------- | --------------------------- |
| 05:00-08:00 | `Early start, Captain`      |
| 08:00-10:00 | `Good morning, Captain`     |
| 10:00-12:00 | `Almost noon, Captain`      |
| 12:00-14:00 | `Good afternoon, Captain`   |
| 14:00-17:00 | `Afternoon hustle, Captain` |
| 17:00-19:00 | `Good evening, Captain`     |
| 19:00-21:00 | `Evening session, Captain`  |
| 21:00-23:00 | `Night owl, Captain`        |
| 23:00-05:00 | `Late night, Captain`       |

**Day-of-week seasoning** (appended after greeting):

- Mon: `· Fresh week ahead`
- Tue: `· Building momentum`
- Wed: `· Midweek push`
- Thu: `· Almost there`
- Fri: `· Finish strong`
- Sat: `· Weekend mode`
- Sun: `· Rest and recharge`

**Random alt greetings** (10% chance to replace the standard with):

- `Back in action, Captain`
- `Ready when you are, Captain`
- `Your Cabinet is standing by`
- `What's the plan, Captain?`
- `Let's make something happen`

### 2.3 Tagline Rotation

Below the greeting, a rotating tagline (changes every page load):

| Condition                        | Tagline                                                |
| -------------------------------- | ------------------------------------------------------ |
| No projects yet                  | `Create your first project to get started.`            |
| Has projects, no active sessions | `Select a session or start a new task.`                |
| Has active sessions              | `${n} active session(s) — pick up where you left off.` |
| Has external agents detected     | `${n} agent(s) ready — Claude Code, Codex, and more.`  |
| Default                          | `Your Cabinet is ready. What would you like to do?`    |

### 2.4 Metric Cards (conditionally shown)

| Card           | Data source                                | Shown when  |
| -------------- | ------------------------------------------ | ----------- |
| `📁 Projects`  | `useProject().projects.length`             | Always      |
| `💬 Sessions`  | `useChat().history.length`                 | Always      |
| `🤖 Agents`    | External CLI agents detected               | `count > 0` |
| `⚡ Active`    | `useChat().processingSessions.size`        | `count > 0` |
| `📊 Workflows` | `projects.reduce(sum activeWorkflowCount)` | `sum > 0`   |

### 2.5 Buttons (updated)

| Button          | Behavior                   | Style                |
| --------------- | -------------------------- | -------------------- |
| `+ New Project` | 创建项目弹窗               | Primary (accent bg)  |
| `Quick Task →`  | 创建聊天会话进入 chat mode | Secondary (outlined) |
| `Open Recent ▾` | 展开最近项目/会话列表      | Text (no border)     |

---

## 3. Visual Tone

- 整个 header 使用 Tailwind，与现有组件风格一致
- 时间显示为 `HH:MM` 格式（24h）
- 星期显示为英文 `Monday` 等
- 天气图标用 emoji（无外部依赖）
- 头像区域用大号 emoji（🧠/🚀/⚡/🎯 按时间/状态变化）

---

## 4. Data Dependencies

| Hook           | Fields used                                                                               |
| -------------- | ----------------------------------------------------------------------------------------- |
| `useChat()`    | `sessions`, `history`, `agents`, `processingSessions`, `handleCreateSession`, `setUIMode` |
| `useProject()` | `projects`, `handleOpenProjectActionModal`                                                |
| `useLayout()`  | `navigateToProject`                                                                       |
| Local          | `new Date()` for time/day/week                                                            |

---

## 5. Implementation Path

1. Update `GREETINGS` array → expanded variant function
2. Add `getDayTag()` function
3. Add `getTagline()` function based on context
4. Add metric cards row
5. Remove `Open Recent` button (its functionality overlaps with sidebar project list)
6. Adjust button styles for visual hierarchy

---

**待确认：**

1. 是否需要头像/emoji 区域，还是保留纯文字？
2. Metric cards 是否过多（4 个会让 header 变高）？是否用 2-3 个更简洁？
3. `Open Recent` 按钮是否保留？它目前和 ExistingProjects 功能重叠。
