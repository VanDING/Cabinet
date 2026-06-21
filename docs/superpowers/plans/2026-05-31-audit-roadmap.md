# Cabinet V2.0 审计修复总览路线图

**审计日期**: 2026-05-31
**计划日期**: 2026-05-31
**目标**: 将审计报告中的 15+ 项问题转化为可执行的开发计划

---

## 计划清单

| #   | 计划文件                                  | 范围                                                            | 预估工时 | 优先级 |
| --- | ----------------------------------------- | --------------------------------------------------------------- | -------- | ------ |
| 1   | `2026-05-31-p1-hotfixes.md`               | 空 catch 日志、删 stub、alert→Toast、cost_usd/rmb、arch-lint CI | 4-6h     | P1     |
| 2   | `2026-05-31-frontend-architecture.md`     | App.tsx 拆分、TanStack Query、EventBusContext、widget 重构      | 16-24h   | P2     |
| 3   | `2026-05-31-backend-performance.md`       | IntentParser 短路、延迟初始化、增量 Token、异步 I/O、硬编码模型 | 12-16h   | P2     |
| 4   | `2026-05-31-remove-i18n-unify-english.md` | 删除 react-i18next、locales/、全库中文字符串改为英文            | 2-4h     | P3     |

---

## 依赖关系图

```
P1 Hotfixes ─────────────────────────────────────────┐
  ├─ Task 1 (空 catch 日志)                            │
  ├─ Task 2 (删 stub)                                  │
  ├─ Task 3 (alert→Toast)                              │
  ├─ Task 4 (cost_usd/rmb)                             │
  └─ Task 5 (arch-lint CI)                             │
                                                        │
Frontend Architecture ────────────────────────────────┤
  ├─ Phase 1: ChatContext / ProjectContext / LayoutContext
  ├─ Phase 2: TanStack Query + 共享 hooks              │
  └─ Phase 3: EventBusContext                          │
                                                        │
Backend Performance ──────────────────────────────────┤
  ├─ Task 1: IntentParser 短路                         │
  ├─ Task 2: 延迟初始化                                │
  ├─ Task 3: ContextBuilder 增量                       │
  ├─ Task 4: SessionManager 异步 I/O                   │
  └─ Task 5: 修复硬编码模型                            │
                                                        │
Remove i18n ──────────────────────────────────────────┘
  ├─ Task 1: 删除 i18n 依赖和配置
  └─ Task 2: 替换中文字符串
```

**可并行执行的组:**

- P1 Hotfixes 可以与 Remove i18n 并行（改动文件交集极小）
- Frontend Architecture 与 Backend Performance 可以并行（前后端分离）

**必须先完成的组:**

- P1 Hotfixes 应在 Frontend Architecture 之前完成（因为 Frontend Refactor 会大量移动代码，先补日志可避免在旧代码上漏改）

---

## 执行顺序推荐（兼顾收益/成本比）

### 第 1 周：P1 + i18n（低成本高收益）

1. **空 catch 加日志** — 成本最低，立即提升调试效率
2. **删除 workflow-canvas stub** — 零风险清理
3. **alert() → Toast** — 用户体验改善
4. **统一 cost_usd** — 修复功能失效（成本追踪归零）
5. **arch-lint 接入 CI** — 防止未来架构劣化
6. **移除 i18n + 统一英文** — 减少 bundle 体积，消除割裂感

**本周产出**: 代码卫生显著改善，开发体验提升，成本追踪恢复工作。

### 第 2-3 周：后端性能优化

1. **IntentParser 默认路径短路** — 最大收益：首 token 延迟从 3-5s 降至 <500ms
2. **SessionManager 异步 I/O** — 消除事件循环阻塞
3. **ContextBuilder 增量更新** — 长对话响应更流畅
4. **修复硬编码模型** — 尊重用户配置
5. **延迟初始化** — 服务器启动时预热

**本周产出**: 聊天响应速度质变，用户感知最明显。

### 第 4-5 周：前端架构重构

1. **App.tsx 拆分 Provider** — 消除 930 行 God Component
2. **TanStack Query 接入** — 消除 N+1 请求
3. **EventBusContext 替换 window.dispatchEvent** — 解决事件丢失
4. **widget 重构为共享 hooks** — 数据一致性修复
5. **usePolling 增强** — 去重、错误暴露、可见性感知

**本周产出**: OfficePage 数据稳定，widget 不再丢事件，网络请求减少 60%+。

---

## 遗留计划（未在本次写入详细计划文件，但已识别）

以下审计项需要单独的计划或在上述计划完成后扩展：

| 审计项                                   | 所属领域 | 建议时机                           |
| ---------------------------------------- | -------- | ---------------------------------- |
| 会话持久化到 SQLite（替代 localStorage） | 数据层   | P3 后端性能完成后                  |
| 修复嵌入模型硬编码 OpenAI                | Gateway  | 与 Backend Performance Task 5 并行 |
| 修复迁移号跳跃（11→15）                  | 数据库   | P3，低优先级                       |
| 为 Tauri 加入 CI 构建                    | CI/构建  | 与 P1 arch-lint 同时               |
| Dockerfile 补全 `@cabinet/organize`      | CI/构建  | P2                                 |
| WorkflowNodeDef 改为辨别联合             | 类型安全 | P2， secretary.ts 拆分后           |
| `secretary.ts` 3257 行拆分               | 代码质量 | P2                                 |
| `context.ts` 2158 行拆分为领域 factory   | 代码质量 | P2                                 |
| 通用 Agent 执行事件总线                  | 架构     | P3                                 |
| 浏览器 E2E 定期运行                      | 测试     | P3                                 |

---

## 风险矩阵

| 风险                                                   | 影响 | 缓解措施                                              |
| ------------------------------------------------------ | ---- | ----------------------------------------------------- |
| App.tsx 拆分引入回归                                   | 高   | 纯剪切粘贴，不改逻辑；迁移后全量 E2E                  |
| IntentParser 短路误杀                                  | 中   | 保留完整路径回退；监控 `source: 'short-circuit'` 比例 |
| 中文字符串替换漏网                                     | 低   | 两次全库扫描；运行时人工抽检                          |
| cost_usd 字段改后其他读取路径遗漏                      | 中   | `rg "cost_rmb"` 全库扫描；回归测试                    |
| EventBusContext 与旧 `window.dispatchEvent` 共存期冲突 | 中   | 保留旧事件发射作为 deprecated，渐进迁移               |

---

## 度量标准（如何确认修复成功）

| 指标                      | 修复前 | 修复后目标           | 验证方式                         |
| ------------------------- | ------ | -------------------- | -------------------------------- |
| 首 token 延迟（普通消息） | 3-5s   | <500ms               | 浏览器 DevTools Timing           |
| OfficePage HTTP 请求数    | 10+    | 3-5（经 Query 缓存） | Network Tab                      |
| 空 catch 数量             | 120+   | 0                    | `rg "catch\s*\(\s*\)\s*\{\s*\}"` |
| `as any` 数量             | 110+   | <50                  | `rg "as any" --count`            |
| 中文字符串（用户可见）    | 多处   | 0                    | `rg "[一-鿿]+"` + 人工过滤       |
| 成本追踪重启后归零        | 是     | 否                   | 重启应用，检查今日消费           |
| arch-lint CI 失败阻断 PR  | 否     | 是                   | 提交一个层违规 PR 测试           |

---

_本路线图基于审计报告第 6 节优先修复建议扩展而成，未列入的项（如本地应用语境下可接受的低优先级问题）已按审计建议搁置。_
