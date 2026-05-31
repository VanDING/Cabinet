# Remove i18n Infrastructure and Unify to English

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除未使用的 `react-i18next` / `i18n.ts` / `locales/` 基础设施，将全库硬编码中文字符串改为英文，消除中英混杂的割裂感。

**Architecture:** 纯删减 + 字符串替换。不引入新依赖，减少 bundle 体积和构建复杂度。

**Tech Stack:** React, TypeScript, i18next, Vite/Tauri

---

## 依赖与顺序

```
Task 1 (删除 i18n 依赖和配置) ──→ Task 2 (替换中文字符串)
Task 3 (验证构建和运行) ──→ 依赖 Task 1 + Task 2
```

**注意:** 此计划与 Frontend Architecture Refactor 可并行执行，因为两者都修改 `apps/desktop/src` 下的文件。如果并行，注意 merge 冲突。

---

## Task 1: 删除 i18n 依赖和配置

**Files:**
- Delete: `apps/desktop/src/i18n.ts`（或 `packages/ui/src/i18n.ts`，按实际路径）
- Delete: `apps/desktop/src/locales/`（或 `packages/ui/src/locales/`）
- Modify: `apps/desktop/src/main.tsx`（移除 `i18n` 导入和 `I18nextProvider`）
- Modify: `apps/desktop/package.json`
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/src/index.ts`（如导出了 i18n 配置）

---

- [ ] **Step 1: 定位 i18n 文件**

Run:
```bash
rg "i18n.ts" apps/desktop packages/ui --type ts -l
rg "locales" apps/desktop packages/ui -l
rg "react-i18next" apps/desktop packages/ui --type ts -l
rg "i18next" package.json apps/desktop/package.json packages/ui/package.json -n
```

记录所有命中文件。

---

- [ ] **Step 2: 删除 i18n 配置文件**

Run:
```bash
git rm apps/desktop/src/i18n.ts
# 或实际路径：git rm packages/ui/src/i18n.ts
git rm -r apps/desktop/src/locales
# 或实际路径：git rm -r packages/ui/src/locales
```

---

- [ ] **Step 3: 从 main.tsx 移除 I18nextProvider**

Read: `apps/desktop/src/main.tsx`
找到：
```tsx
import './i18n';
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n';
```
以及：
```tsx
<I18nextProvider i18n={i18n}>
```
全部删除。

---

- [ ] **Step 4: 从 package.json 移除依赖**

Read: `apps/desktop/package.json`
Read: `packages/ui/package.json`
从 `dependencies` 中删除：
- `react-i18next`
- `i18next`
- `i18next-browser-languagedetector`（如存在）

Run: `pnpm install`
Expected: lockfile 更新，无报错

---

- [ ] **Step 5: 搜索残留导入**

Run:
```bash
rg "from 'react-i18next'" apps/desktop packages/ui --type ts -n
rg "from 'i18next'" apps/desktop packages/ui --type ts -n
rg "useTranslation" apps/desktop packages/ui --type ts -n
rg "t\(" apps/desktop packages/ui --type ts -n | head -20
```
Expected: 无命中（除了可能的历史注释）

---

- [ ] **Step 6: Commit**

```bash
git commit -m "chore: remove unused i18n infrastructure

react-i18next, i18next, and locales/ were configured but never
actually used by any component. Removing reduces bundle size
and build complexity."
```

---

## Task 2: 替换硬编码中文字符串为英文

**背景:** 审计报告发现 `packages/ui/src/sub-agent-card.tsx`、App.tsx、ApiKeysTab.tsx 等处有硬编码中文，与 95% 英文界面混杂。

**Files:**
- Modify: `packages/ui/src/sub-agent-card.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/pages/settings/ApiKeysTab.tsx`
- Scan: 全库其他硬编码中文字符串

---

- [ ] **Step 1: 扫描全库硬编码中文**

Run:
```bash
rg "[一-鿿]+" apps/desktop/src packages/ui/src --type ts -n | grep -v "node_modules" > /tmp/chinese-strings.txt
cat /tmp/chinese-strings.txt
```

按文件分组，列出所有需要替换的字符串。

---

- [ ] **Step 2: 替换 sub-agent-card.tsx**

Read: `packages/ui/src/sub-agent-card.tsx`
将以下字符串替换：

| 中文 | 英文 |
|------|------|
| 运行中 | Running |
| 已完成 | Completed |
| 出错 | Error |
| 收起 | Collapse |
| 展开 | Expand |

编辑文件，确保替换后语法正确（如 `status === 'Running'` 等）。

---

- [ ] **Step 3: 替换 App.tsx**

Read: `apps/desktop/src/App.tsx`
找到：
```tsx
"请继续完成上述任务"
```
替换为：
```tsx
"Please continue to complete the tasks above"
```

---

- [ ] **Step 4: 替换 ApiKeysTab.tsx**

Read: `apps/desktop/src/pages/settings/ApiKeysTab.tsx`
找到中文标签如：
- 通义千问 → Tongyi Qianwen
- 月之暗面 → Moonshot AI
- 智谱GLM → Zhipu GLM
- 百川 → Baichuan

**注意:** 这些是品牌/产品名称，替换策略：
- 如果是 UI 标签（用户可见的选项文字），改为英文 + 保留中文括号，如 `Tongyi Qianwen (通义千问)`
- 如果是内部代码值（如 provider key），保持原样

按审计报告建议，统一为英文。如果用户配置中存储的是中文 provider 名，需要同步修改存储值，但本次计划只改 UI 展示层，不改存储 schema。

---

- [ ] **Step 5: 处理其他命中文件**

对 `/tmp/chinese-strings.txt` 中列出的每个文件：
1. 判断该中文字符串是否在注释中 → 如 `// 这是一个注释`，可保留或改为英文注释
2. 判断是否在用户可见 UI 中 → 必须替换
3. 判断是否是测试数据 / fixture → 可保留

**优先处理用户可见字符串。**

---

- [ ] **Step 6: 再次扫描确认**

Run:
```bash
rg "[一-鿿]+" apps/desktop/src packages/ui/src --type ts -n | grep -v "node_modules" | grep -v "//" | wc -l
```
Expected: 用户可见中文数量为 0（或仅剩注释/测试数据，需人工确认）

---

- [ ] **Step 7: Commit**

```bash
git commit -m "fix(ui): unify all hardcoded Chinese strings to English

Eliminates the mixed EN/CN interface that made the product
look unfinished. All user-facing labels are now in English."
```

---

## Task 3: 验证构建和运行时

---

- [ ] **Step 1: 编译前端**

Run: `pnpm --filter @cabinet/desktop build`
Expected: 0 errors, 0 warnings

---

- [ ] **Step 2: 编译 UI 包**

Run: `pnpm --filter @cabinet/ui build`
Expected: 0 errors

---

- [ ] **Step 3: 启动桌面应用**

Run: `pnpm --filter @cabinet/desktop dev`
打开应用，检查：
- Settings → ApiKeysTab： provider 名称为英文
- Factory / Office 页面： sub-agent 状态标签为英文
- Chat 页面：无 "请继续完成上述任务" 等中文提示
- 无 console 报错关于 `i18n` / `useTranslation`

---

- [ ] **Step 4: 运行测试**

Run: `pnpm test`
Expected: 全部通过

---

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: verify i18n removal and English unification

Build passes, runtime checked, tests green."
```

---

## Self-Review

- [ ] `react-i18next` 和 `i18next` 已从所有 package.json 删除
- [ ] `i18n.ts` 和 `locales/` 目录已删除
- [ ] 全库无 `useTranslation` / `I18nextProvider` 残留导入
- [ ] `sub-agent-card.tsx` 状态标签为英文
- [ ] `ApiKeysTab.tsx` provider 名称为英文
- [ ] 构建通过，运行无报错
