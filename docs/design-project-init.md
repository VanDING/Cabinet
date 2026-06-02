# 项目导入与渐进初始化机制设计

## 目标
解决"导入后 .cabinet/ 未创建、系统对项目一无所知"的问题，建立"显式导入 + 渐进初始化"的混合机制。

---

## Phase 1: 修复导入骨架（Bug Fix）

**问题**: `POST /api/projects` 中 `mkdirSync` 无错误处理，`rootPath` 异常时静默跳过创建。

**改动**: `apps/server/src/routes/projects.ts`

1. **前置校验**（数据库写入之前执行）
   - `rootPath` 必须存在且可写（`existsSync + accessSync(W_OK)`）
   - 失败直接返回 `400 Bad Request`，**不写入数据库**
2. **原子目录创建**
   - `.cabinet/rules/`
   - `.cabinet/skills/`
   - `.cabinet/mcp/`
   - `.cabinet/sessions/`
   - 任意目录创建失败返回 `500`，并回滚已创建的数据库记录
3. **生成 CABINET.md stub**
   ```markdown
   # CABINET.md

   This file provides guidance to Cabinet when working with code in this repository.
   <!-- Run /init to fill this file -->
   ```
   - 写入项目根目录（仅当不存在时）

---

## Phase 2: 项目级 Skill 发现

**目标**: 让 Skill 可以存在于项目本地 `.cabinet/skills/`，优先级高于全局 `~/.cabinet/skills/`。

**改动**:

1. **`packages/agent/src/skill-registry.ts`**
   - 新增 `loadFromDirectory(dir: string): number` —— 扫描目录下所有 `<name>/SKILL.md` 并注册
   - 新增 `clearProjectSkills(): void` —— 卸载所有项目级 skill（用于切换项目时）
   - SkillEntry 新增 `scope: 'global' | 'project'` 字段

2. **`apps/server/src/context.ts`**
   - 启动时：全局扫描保留（`~/.cabinet/skills/`）
   - 新增：遍历数据库中所有项目，对每个存在 `.cabinet/skills/` 的项目调用 `loadFromDirectory`
   - 同名 skill：项目级覆盖全局（scope = 'project' 优先）

3. **`apps/server/src/watchers.ts`**
   - `startSkillWatcher` 支持传入 `extraDirs: string[]`
   - 或新增 `startProjectSkillWatcher(projectRoot: string)`，监听项目级 skill 变化

---

## Phase 3: 会话自动注入 CABINET.md

**目标**: 每次 secretary 处理请求时，自动将项目 `CABINET.md` 内容注入上下文。

**参照**: Claude Code 的 `getUserContext`（`context.ts`），每次会话自动发现并注入所有 CABINET.md。

**改动**: `apps/server/src/routes/secretary.ts`

1. **读取逻辑**
   - 根据 `projectId` 获取 `projectRootPath`
   - 检查 `CABINET.md` 是否存在，存在则读取内容
   - 检查 `CABINET.local.md` 是否存在，存在则追加（个人级偏好）

2. **注入位置**
   - 作为 **System Context** 的一部分，附加在现有 system prompt 之后
   - 格式参考 Claude Code:
     ```
     ## Project Context (from CABINET.md)
     <content>
     ```

3. **缓存策略**
   - 按 `projectId` 缓存内容 + mtime
   - 文件修改时间未变时直接复用，避免每轮都读磁盘

---

## Phase 4: 渐进式初始化 Workflow

**目标**: 首次对话时，让 Agent 自动/半自动完成深度初始化。

### 触发方式（待决策，见下方）

### 初始化子 Agent 的职责

1. **探索代码库**
   - 读取 manifest（package.json, Cargo.toml, pyproject.toml, go.mod）
   - 读取 README、Makefile、CI 配置
   - 读取已有 AI 工具配置（.cursorrules, .github/copilot-instructions.md）

2. **访谈补充**
   - 通过 `AskUserQuestion` 问代码无法回答的问题：
     - 团队分支规范、PR 流程
     - 非标准命令（如何跑单测、如何 lint）
     - 环境变量、密钥配置
     - 个人角色与偏好

3. **生成产物**
   - `CABINET.md`（团队共享）
   - `CABINET.local.md`（个人私有，自动加入 .gitignore）
   - `.cabinet/skills/<name>/SKILL.md`（项目级 skill）
   - `.cabinet/rules/*.md`（可选，scoped 规则）

4. **更新数据库**
   - 将生成的 summary、tech_stack、goals 写回 `project_context`

### 进度通知
- 通过 WebSocket broadcast `project_init_progress` 事件
- 前端显示进度条或日志

---

## 关键决策点（需确认）

| # | 问题 | 选项 |
|---|------|------|
| 1 | **Skill 冲突策略** | A. 项目级完全覆盖全局同名 skill<br>B. 项目级优先，但合并 dependencies/tools |
| 2 | **CABINET.md 注入位置** | A. System Prompt 末尾（影响最大）<br>B. User Context 开头（更像 Claude Code） |
| 3 | **初始化触发方式** | A. 完全自动（首次对话自动启动 init agent）<br>B. 自动提议（secretary 提示"建议运行 /init"）<br>C. 纯手动（用户必须输入 /init） |
| 4 | **项目级 skill 是否入库** | A. 仅文件系统，不入库（和 Claude Code 一致）<br>B. 同步写入 skillRepo（和现有全局 skill 统一） |

---

## 实施优先级

1. Phase 1（Bug Fix，最小改动，立即解决用户痛点）
2. Phase 3（CABINET.md 注入，提升 secretary 上下文质量）
3. Phase 2（项目级 Skill，扩展能力边界）
4. Phase 4（渐进初始化，最大价值但工作量最大）
