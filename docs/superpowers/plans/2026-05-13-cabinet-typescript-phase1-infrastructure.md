# Cabinet TypeScript 重写 — Phase 1 基础设施 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立系统的类型基础、事件总线和 SQLite 持久化层。产出 3 个可独立验证的包（@cabinet/types, @cabinet/events, @cabinet/storage）。

**Architecture:** 自底向上：先完成无依赖的常量/类型定义，再构建事件总线接口和实现，最后建立 SQLite 存储层。每个模块严格遵循 TDD：接口→测试→实现→验收。

**Tech Stack:** TypeScript 5.x, Vitest, better-sqlite3, pnpm monorepo

**关联文档:**

- 产品文档：`document.md` v2.0
- 设计文档：`docs/superpowers/specs/2026-05-13-cabinet-typescript-rewrite-design.md`

---

## 项目初始化

### Task 0: Monorepo 脚手架

**Files:**

- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `packages/types/package.json`
- Create: `packages/events/package.json`
- Create: `packages/storage/package.json`

- [ ] **Step 1: 创建根 package.json**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0
```

```json
// package.json
{
  "name": "cabinet",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  }
}
```

- [ ] **Step 2: 创建 pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

- [ ] **Step 3: 创建 tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitAny": true,
    "exactOptionalPropertyTypes": false,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 4: 创建三个包的 package.json**

```json
// packages/types/package.json
{
  "name": "@cabinet/types",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

```json
// packages/events/package.json
{
  "name": "@cabinet/events",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@cabinet/types": "workspace:*",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

```json
// packages/storage/package.json
{
  "name": "@cabinet/storage",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@cabinet/types": "workspace:*",
    "@types/better-sqlite3": "^7.6.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 5: 创建各包 tsconfig.json**

```json
// packages/types/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

```json
// packages/events/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "references": [{ "path": "../types" }]
}
```

```json
// packages/storage/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "references": [{ "path": "../types" }]
}
```

- [ ] **Step 6: 创建各包 vitest.config.ts**

```typescript
// packages/types/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

```typescript
// packages/events/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

```typescript
// packages/storage/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 7: 安装依赖并验证编译**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0
pnpm install
pnpm typecheck
```

Expected: 三个包编译通过（可能因 src 为空而无输出，但不应报错）。

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json packages/
git commit -m "feat: initialize monorepo with packages scaffold"
```

---

## Phase 1: 基础设施

### Task 1: @cabinet/types — 硬限制常量 boundaries.ts

**Files:**

- Create: `packages/types/src/boundaries.ts`
- Create: `packages/types/src/__tests__/boundaries.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// packages/types/src/__tests__/boundaries.test.ts
import { describe, it, expect } from 'vitest';
import {
  MAX_DEBATE_ROUNDS,
  MAX_TOKENS_PER_SPEECH,
  MAX_RETRY_TRANSIENT,
  MAX_RETRY_RECOVERABLE,
  LLM_TIMEOUT_MS,
  DAILY_BUDGET_USD,
  WEEKLY_BUDGET_USD,
  MONTHLY_BUDGET_USD,
  BUDGET_WARNING_THRESHOLD,
  MEETING_COST_CONFIRM_THRESHOLD_USD,
  RUMINATION_SIMILARITY_THRESHOLD,
  DECISION_EXPIRY_HOURS,
  MAX_MEETING_ADVISORS,
  MAX_QUALITY_RETRIES,
  BACKUP_INTERVAL_MINUTES,
  BACKUP_KEEP_COUNT,
  PIN_LOCKOUT_ATTEMPTS,
  PIN_LOCKOUT_MINUTES,
} from '../boundaries';

describe('boundaries', () => {
  it('all numeric constants are positive', () => {
    const constants = [
      MAX_DEBATE_ROUNDS,
      MAX_TOKENS_PER_SPEECH,
      MAX_RETRY_TRANSIENT,
      MAX_RETRY_RECOVERABLE,
      LLM_TIMEOUT_MS,
      DAILY_BUDGET_USD,
      WEEKLY_BUDGET_USD,
      MONTHLY_BUDGET_USD,
      MEETING_COST_CONFIRM_THRESHOLD_USD,
      DECISION_EXPIRY_HOURS,
      MAX_MEETING_ADVISORS,
      MAX_QUALITY_RETRIES,
      BACKUP_INTERVAL_MINUTES,
      BACKUP_KEEP_COUNT,
      PIN_LOCKOUT_ATTEMPTS,
      PIN_LOCKOUT_MINUTES,
    ];
    for (const c of constants) {
      expect(c).toBeGreaterThan(0);
    }
  });

  it('budget warning threshold is between 0 and 1', () => {
    expect(BUDGET_WARNING_THRESHOLD).toBeGreaterThan(0);
    expect(BUDGET_WARNING_THRESHOLD).toBeLessThan(1);
  });

  it('rumination threshold is between 0 and 1', () => {
    expect(RUMINATION_SIMILARITY_THRESHOLD).toBeGreaterThan(0);
    expect(RUMINATION_SIMILARITY_THRESHOLD).toBeLessThan(1);
  });

  it('budgets have correct hierarchy', () => {
    expect(DAILY_BUDGET_USD).toBeLessThan(WEEKLY_BUDGET_USD);
    expect(WEEKLY_BUDGET_USD).toBeLessThan(MONTHLY_BUDGET_USD);
  });

  it('retry constants have correct hierarchy', () => {
    expect(MAX_RETRY_RECOVERABLE).toBeLessThan(MAX_RETRY_TRANSIENT);
  });

  it('PIN lockout attempts is reasonable', () => {
    expect(PIN_LOCKOUT_ATTEMPTS).toBeGreaterThanOrEqual(3);
    expect(PIN_LOCKOUT_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/types
pnpm test -- src/__tests__/boundaries.test.ts
```

Expected: FAIL — imports not found.

- [ ] **Step 3: 实现 boundaries.ts**

```typescript
// packages/types/src/boundaries.ts

/** 最大辩论轮次 */
export const MAX_DEBATE_ROUNDS = 3;

/** 单次发言最大 Token 数 */
export const MAX_TOKENS_PER_SPEECH = 4_096;

/** 瞬时错误最大重试次数（网络超时、429限流） */
export const MAX_RETRY_TRANSIENT = 3;

/** 可恢复错误最大重试次数（工具执行失败） */
export const MAX_RETRY_RECOVERABLE = 2;

/** LLM 调用超时时间（毫秒） */
export const LLM_TIMEOUT_MS = 30_000;

/** 日预算上限（美元） */
export const DAILY_BUDGET_USD = 5.0;

/** 周预算上限（美元） */
export const WEEKLY_BUDGET_USD = 25.0;

/** 月预算上限（美元） */
export const MONTHLY_BUDGET_USD = 100.0;

/** 预算告警阈值（达此比例触发提醒） */
export const BUDGET_WARNING_THRESHOLD = 0.8;

/** 会议成本确认阈值（美元），超此值需 Captain 确认 */
export const MEETING_COST_CONFIRM_THRESHOLD_USD = 0.5;

/** 反刍检测语义相似度阈值，超过视为重复论点 */
export const RUMINATION_SIMILARITY_THRESHOLD = 0.85;

/** 决策过期时间（小时） */
export const DECISION_EXPIRY_HOURS = 72;

/** 单个会议最大顾问数 */
export const MAX_MEETING_ADVISORS = 5;

/** 质量闸门最大重试次数 */
export const MAX_QUALITY_RETRIES = 3;

/** 自动备份间隔（分钟） */
export const BACKUP_INTERVAL_MINUTES = 360; // 6 小时

/** 备份保留份数 */
export const BACKUP_KEEP_COUNT = 7;

/** PIN 锁定尝试次数 */
export const PIN_LOCKOUT_ATTEMPTS = 5;

/** PIN 锁定时长（分钟） */
export const PIN_LOCKOUT_MINUTES = 15;
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/types
pnpm test -- src/__tests__/boundaries.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/boundaries.ts packages/types/src/__tests__/boundaries.test.ts
git commit -m "feat(types): add boundaries constants"
```

---

### Task 2: @cabinet/types — 核心原语 primitives.ts

**Files:**

- Create: `packages/types/src/primitives.ts`
- Create: `packages/types/src/__tests__/primitives.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// packages/types/src/__tests__/primitives.test.ts
import { describe, it, expect } from 'vitest';
import type {
  Organization,
  Project,
  ProjectStatus,
  Employee,
  EmployeeKind,
  PermissionLevel,
  SkillDefinition,
  SkillStatus,
  SkillKind,
  WorkflowDefinition,
  MemoryLayer,
} from '../primitives';

describe('Organization type', () => {
  it('accepts valid organization object at compile time', () => {
    const org: Organization = {
      id: 'org-1',
      name: 'Acme Corp',
      captainId: 'captain-1',
      createdAt: new Date(),
    };
    expect(org.name).toBe('Acme Corp');
  });

  it('requires id to be a string', () => {
    const org: Organization = {
      id: 'org-1',
      name: 'Acme Corp',
      captainId: 'captain-1',
      createdAt: new Date(),
    };
    expect(typeof org.id).toBe('string');
  });
});

describe('Project type', () => {
  it('accepts valid project object', () => {
    const project: Project = {
      id: 'proj-1',
      organizationId: 'org-1',
      name: 'Product Launch',
      description: 'Launching the new product line',
      status: ProjectStatus.Active,
      createdAt: new Date(),
    };
    expect(project.status).toBe(ProjectStatus.Active);
  });

  it('ProjectStatus has all expected values', () => {
    expect(ProjectStatus.Active).toBe('active');
    expect(ProjectStatus.Archived).toBe('archived');
    expect(ProjectStatus.Draft).toBe('draft');
  });
});

describe('Employee type', () => {
  it('accepts AI pipeline employee', () => {
    const emp: Employee = {
      id: 'emp-1',
      projectId: 'proj-1',
      name: 'Financial Advisor',
      role: 'advisor',
      kind: EmployeeKind.AI,
      pipelineConfig: { model: 'claude-opus-4-7', systemPrompt: 'You are a financial advisor.' },
      persona: { name: 'Warren', tone: 'analytical', expertise: ['finance', 'investment'] },
      permissionLevel: PermissionLevel.Read,
    };
    expect(emp.kind).toBe('ai');
  });

  it('accepts human node employee', () => {
    const emp: Employee = {
      id: 'emp-2',
      projectId: 'proj-1',
      name: 'Captain',
      role: 'decision_maker',
      kind: EmployeeKind.Human,
      permissionLevel: PermissionLevel.Admin,
    };
    expect(emp.kind).toBe('human');
    expect(emp.pipelineConfig).toBeUndefined();
  });

  it('EmployeeKind has AI and Human values', () => {
    expect(EmployeeKind.AI).toBe('ai');
    expect(EmployeeKind.Human).toBe('human');
  });

  it('PermissionLevel has correct hierarchy', () => {
    const levels = [PermissionLevel.Read, PermissionLevel.Write, PermissionLevel.Admin];
    expect(levels).toHaveLength(3);
  });
});

describe('SkillDefinition type', () => {
  it('accepts valid skill definition', () => {
    const skill: SkillDefinition = {
      id: 'skill-1',
      name: 'Market Analysis',
      description: 'Analyzes market conditions for a given sector',
      kind: SkillKind.Tool,
      inputSchema: { type: 'object', properties: { sector: { type: 'string' } } },
      outputSchema: { type: 'object', properties: { report: { type: 'string' } } },
      promptTemplate: 'Analyze the market for {{sector}}.',
      version: 1,
      status: SkillStatus.Active,
    };
    expect(skill.version).toBe(1);
  });

  it('SkillStatus has draft and active values', () => {
    expect(SkillStatus.Draft).toBe('draft');
    expect(SkillStatus.Active).toBe('active');
    expect(SkillStatus.Deprecated).toBe('deprecated');
  });
});

describe('WorkflowDefinition type', () => {
  it('accepts valid workflow definition', () => {
    const wf: WorkflowDefinition = {
      id: 'wf-1',
      projectId: 'proj-1',
      name: 'Market Entry Analysis',
      nodes: [
        { id: 'n1', type: 'skill', skillId: 'skill-1', position: { x: 0, y: 0 } },
        {
          id: 'n2',
          type: 'condition',
          condition: '{{result.score}} > 0.7',
          position: { x: 100, y: 0 },
        },
        { id: 'n3', type: 'human', title: 'Approve market entry', position: { x: 200, y: 0 } },
      ],
      edges: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3', condition: 'true' },
      ],
      entryNodeId: 'n1',
      status: 'draft',
      createdAt: new Date(),
    };
    expect(wf.nodes).toHaveLength(3);
    expect(wf.edges).toHaveLength(2);
    expect(wf.entryNodeId).toBe('n1');
  });
});

describe('MemoryLayer type', () => {
  it('has all four layers', () => {
    expect(MemoryLayer.ShortTerm).toBe('short_term');
    expect(MemoryLayer.LongTerm).toBe('long_term');
    expect(MemoryLayer.Entity).toBe('entity');
    expect(MemoryLayer.Project).toBe('project');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/types
pnpm test -- src/__tests__/primitives.test.ts
```

Expected: FAIL — types not yet defined.

- [ ] **Step 3: 实现 primitives.ts**

```typescript
// packages/types/src/primitives.ts

// ── Organization ──

export interface Organization {
  readonly id: string;
  name: string;
  captainId: string;
  createdAt: Date;
}

// ── Project ──

export const ProjectStatus = {
  Draft: 'draft',
  Active: 'active',
  Archived: 'archived',
} as const;

export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export interface Project {
  readonly id: string;
  organizationId: string;
  name: string;
  description: string;
  status: ProjectStatus;
  createdAt: Date;
}

// ── Employee ──

export const EmployeeKind = {
  AI: 'ai',
  Human: 'human',
} as const;

export type EmployeeKind = (typeof EmployeeKind)[keyof typeof EmployeeKind];

export const PermissionLevel = {
  Read: 'read',
  Write: 'write',
  Admin: 'admin',
} as const;

export type PermissionLevel = (typeof PermissionLevel)[keyof typeof PermissionLevel];

export interface AIPipelineConfig {
  model: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface PersonaConfig {
  name: string;
  tone: string;
  expertise: string[];
}

export interface Employee {
  readonly id: string;
  projectId: string;
  name: string;
  role: string;
  kind: EmployeeKind;
  pipelineConfig?: AIPipelineConfig;
  persona?: PersonaConfig;
  permissionLevel: PermissionLevel;
}

// ── Skill ──

export const SkillKind = {
  Tool: 'tool',
  Prompt: 'prompt',
  Composite: 'composite',
} as const;

export type SkillKind = (typeof SkillKind)[keyof typeof SkillKind];

export const SkillStatus = {
  Draft: 'draft',
  Active: 'active',
  Deprecated: 'deprecated',
} as const;

export type SkillStatus = (typeof SkillStatus)[keyof typeof SkillStatus];

export interface SkillDefinition {
  readonly id: string;
  name: string;
  description: string;
  kind: SkillKind;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  promptTemplate: string;
  version: number;
  status: SkillStatus;
}

// ── Workflow ──

export interface WorkflowNode {
  id: string;
  type: 'skill' | 'condition' | 'parallel' | 'human';
  skillId?: string;
  condition?: string;
  title?: string;
  children?: string[];
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;
}

export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'completed' | 'failed';

export interface WorkflowDefinition {
  readonly id: string;
  projectId: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entryNodeId: string;
  status: WorkflowStatus;
  createdAt: Date;
}

// ── Memory ──

export const MemoryLayer = {
  ShortTerm: 'short_term',
  LongTerm: 'long_term',
  Entity: 'entity',
  Project: 'project',
} as const;

export type MemoryLayer = (typeof MemoryLayer)[keyof typeof MemoryLayer];
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/types
pnpm test -- src/__tests__/primitives.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/primitives.ts packages/types/src/__tests__/primitives.test.ts
git commit -m "feat(types): add core primitives (Organization, Project, Employee, Skill, Workflow, Memory)"
```

---

### Task 3: @cabinet/types — 决策类型 decisions.ts

**Files:**

- Create: `packages/types/src/decisions.ts`
- Create: `packages/types/src/__tests__/decisions.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// packages/types/src/__tests__/decisions.test.ts
import { describe, it, expect } from 'vitest';
import {
  DecisionType,
  DecisionLevel,
  DecisionStatus,
  isValidTransition,
  ALLOWED_TRANSITIONS,
  TERMINAL_STATUSES,
  type Decision,
  type DecisionOption,
} from '../decisions';

describe('DecisionType', () => {
  it('has all 5 types', () => {
    expect(DecisionType.Strategic).toBe('strategic');
    expect(DecisionType.Action).toBe('action');
    expect(DecisionType.Execution).toBe('execution');
    expect(DecisionType.Anomaly).toBe('anomaly');
    expect(DecisionType.Evolution).toBe('evolution');
  });
});

describe('DecisionLevel', () => {
  it('has 4 levels in increasing severity', () => {
    expect(DecisionLevel.L0).toBe('L0');
    expect(DecisionLevel.L1).toBe('L1');
    expect(DecisionLevel.L2).toBe('L2');
    expect(DecisionLevel.L3).toBe('L3');
  });
});

describe('DecisionStatus', () => {
  it('has all statuses', () => {
    expect(DecisionStatus.Pending).toBe('pending');
    expect(DecisionStatus.Approved).toBe('approved');
    expect(DecisionStatus.Rejected).toBe('rejected');
    expect(DecisionStatus.Expired).toBe('expired');
    expect(DecisionStatus.Archived).toBe('archived');
  });
});

describe('isValidTransition', () => {
  it('allows pending → approved', () => {
    expect(isValidTransition(DecisionStatus.Pending, DecisionStatus.Approved)).toBe(true);
  });

  it('allows pending → rejected', () => {
    expect(isValidTransition(DecisionStatus.Pending, DecisionStatus.Rejected)).toBe(true);
  });

  it('allows pending → expired', () => {
    expect(isValidTransition(DecisionStatus.Pending, DecisionStatus.Expired)).toBe(true);
  });

  it('allows approved → archived', () => {
    expect(isValidTransition(DecisionStatus.Approved, DecisionStatus.Archived)).toBe(true);
  });

  it('allows rejected → archived', () => {
    expect(isValidTransition(DecisionStatus.Rejected, DecisionStatus.Archived)).toBe(true);
  });

  it('allows expired → archived', () => {
    expect(isValidTransition(DecisionStatus.Expired, DecisionStatus.Archived)).toBe(true);
  });

  it('disallows archived → anything', () => {
    const statuses = Object.values(DecisionStatus);
    for (const status of statuses) {
      expect(isValidTransition(DecisionStatus.Archived, status)).toBe(false);
    }
  });

  it('disallows approved → rejected (no reversal)', () => {
    expect(isValidTransition(DecisionStatus.Approved, DecisionStatus.Rejected)).toBe(false);
  });

  it('disallows pending → archived (skip intermediate)', () => {
    expect(isValidTransition(DecisionStatus.Pending, DecisionStatus.Archived)).toBe(false);
  });

  it('disallows same status transition for non-pending', () => {
    expect(isValidTransition(DecisionStatus.Approved, DecisionStatus.Approved)).toBe(false);
  });
});

describe('TERMINAL_STATUSES', () => {
  it('includes archived only', () => {
    expect(TERMINAL_STATUSES).toEqual([DecisionStatus.Archived]);
  });
});

describe('Decision type', () => {
  it('accepts a valid L2 strategic decision', () => {
    const options: DecisionOption[] = [
      { id: 'opt-1', label: 'Enter market', impact: 'High initial cost, high long-term gain' },
      { id: 'opt-2', label: 'Wait', impact: 'No cost, may miss window' },
    ];
    const decision: Decision = {
      id: 'dec-1',
      projectId: 'proj-1',
      type: DecisionType.Strategic,
      level: DecisionLevel.L2,
      status: DecisionStatus.Pending,
      title: 'Should we enter the baby-products market?',
      description: 'Analysis of market opportunity in maternal-infant sector.',
      options,
      createdAt: new Date(),
    };
    expect(decision.level).toBe('L2');
    expect(decision.options).toHaveLength(2);
    expect(decision.chosenOptionId).toBeUndefined();
    expect(decision.resolvedAt).toBeUndefined();
  });

  it('resolved decision has chosen option and resolved time', () => {
    const decision: Decision = {
      id: 'dec-2',
      projectId: 'proj-1',
      type: DecisionType.Action,
      level: DecisionLevel.L2,
      status: DecisionStatus.Approved,
      title: 'Approve budget',
      description: 'Approve Q2 budget',
      options: [{ id: 'opt-1', label: 'Approve', impact: 'Budget allocated' }],
      chosenOptionId: 'opt-1',
      captainId: 'captain-1',
      createdAt: new Date('2026-05-01'),
      resolvedAt: new Date('2026-05-02'),
    };
    expect(decision.chosenOptionId).toBe('opt-1');
    expect(decision.resolvedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/types
pnpm test -- src/__tests__/decisions.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: 实现 decisions.ts**

```typescript
// packages/types/src/decisions.ts

// ── DecisionType ──

export const DecisionType = {
  Strategic: 'strategic',
  Action: 'action',
  Execution: 'execution',
  Anomaly: 'anomaly',
  Evolution: 'evolution',
} as const;

export type DecisionType = (typeof DecisionType)[keyof typeof DecisionType];

// ── DecisionLevel ──

export const DecisionLevel = {
  L0: 'L0',
  L1: 'L1',
  L2: 'L2',
  L3: 'L3',
} as const;

export type DecisionLevel = (typeof DecisionLevel)[keyof typeof DecisionLevel];

// ── DecisionStatus ──

export const DecisionStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
  Expired: 'expired',
  Archived: 'archived',
} as const;

export type DecisionStatus = (typeof DecisionStatus)[keyof typeof DecisionStatus];

// ── State Machine ──

/** 允许的状态转换映射 */
export const ALLOWED_TRANSITIONS: Record<DecisionStatus, DecisionStatus[]> = {
  [DecisionStatus.Pending]: [
    DecisionStatus.Approved,
    DecisionStatus.Rejected,
    DecisionStatus.Expired,
  ],
  [DecisionStatus.Approved]: [DecisionStatus.Archived],
  [DecisionStatus.Rejected]: [DecisionStatus.Archived],
  [DecisionStatus.Expired]: [DecisionStatus.Archived],
  [DecisionStatus.Archived]: [],
};

/** 终态集合 */
export const TERMINAL_STATUSES: DecisionStatus[] = [DecisionStatus.Archived];

/**
 * 检查状态转换是否合法
 */
export function isValidTransition(from: DecisionStatus, to: DecisionStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

// ── Decision ──

export interface DecisionOption {
  id: string;
  label: string;
  impact: string;
}

export interface Decision {
  readonly id: string;
  projectId: string;
  type: DecisionType;
  level: DecisionLevel;
  status: DecisionStatus;
  title: string;
  description: string;
  options: DecisionOption[];
  chosenOptionId?: string;
  captainId?: string;
  createdAt: Date;
  resolvedAt?: Date;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/types
pnpm test -- src/__tests__/decisions.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/decisions.ts packages/types/src/__tests__/decisions.test.ts
git commit -m "feat(types): add Decision types with state machine and L0-L3 levels"
```

---

### Task 4: @cabinet/types — 事件类型 events.ts

**Files:**

- Create: `packages/types/src/events.ts`
- Create: `packages/types/src/__tests__/events.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// packages/types/src/__tests__/events.test.ts
import { describe, it, expect } from 'vitest';
import { MessageType, type MessageEnvelope, type DecisionRequest } from '../events';

describe('MessageType', () => {
  it('has all 16 message types', () => {
    const types = Object.values(MessageType);
    expect(types).toHaveLength(16);
  });

  it('includes core message types', () => {
    expect(MessageType.DecisionRequest).toBe('decision_request');
    expect(MessageType.DecisionResolved).toBe('decision_resolved');
    expect(MessageType.TaskOrder).toBe('task_order');
    expect(MessageType.DeliberationProposal).toBe('deliberation_proposal');
    expect(MessageType.WorkflowStatusChanged).toBe('workflow_status_changed');
    expect(MessageType.SecretaryMessage).toBe('secretary_message');
    expect(MessageType.GreetingGenerated).toBe('greeting_generated');
    expect(MessageType.BudgetAlert).toBe('budget_alert');
  });
});

describe('MessageEnvelope', () => {
  it('accepts valid message envelope', () => {
    const envelope: MessageEnvelope = {
      messageId: 'msg-1',
      correlationId: 'corr-1',
      causationId: 'cause-1',
      timestamp: new Date(),
      messageType: MessageType.DecisionRequest,
      payload: {
        decisionId: 'dec-1',
        title: 'Test decision',
        level: 'L2',
      } satisfies DecisionRequest,
    };
    expect(envelope.correlationId).toBe('corr-1');
    expect(envelope.messageType).toBe(MessageType.DecisionRequest);
  });

  it('causationId can be null for root events', () => {
    const envelope: MessageEnvelope = {
      messageId: 'msg-root',
      correlationId: 'corr-root',
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.SecretaryMessage,
      payload: { text: 'Hello' },
    };
    expect(envelope.causationId).toBeNull();
  });

  it('messageId is required', () => {
    const envelope: MessageEnvelope = {
      messageId: 'msg-2',
      correlationId: 'corr-2',
      causationId: 'msg-1',
      timestamp: new Date(),
      messageType: MessageType.TaskOrder,
      payload: { orderId: 'order-1', action: 'execute' },
    };
    expect(typeof envelope.messageId).toBe('string');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/types
pnpm test -- src/__tests__/events.test.ts
```

Expected: FAIL.

- [ ] **Step 3: 实现 events.ts**

```typescript
// packages/types/src/events.ts

// ── MessageType ──

export const MessageType = {
  // 决策
  DecisionRequest: 'decision_request',
  DecisionResolved: 'decision_resolved',
  // 任务
  TaskOrder: 'task_order',
  TaskCompleted: 'task_completed',
  TaskFailed: 'task_failed',
  // 会议
  MeetingStarted: 'meeting_started',
  MeetingCompleted: 'meeting_completed',
  DeliberationProposal: 'deliberation_proposal',
  // 工作流
  WorkflowStarted: 'workflow_started',
  WorkflowStatusChanged: 'workflow_status_changed',
  WorkflowCompleted: 'workflow_completed',
  // 秘书
  SecretaryMessage: 'secretary_message',
  GreetingGenerated: 'greeting_generated',
  // 系统
  BudgetAlert: 'budget_alert',
  SystemNotification: 'system_notification',
  AuditEvent: 'audit_event',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

// ── MessageEnvelope ──

export interface MessageEnvelope {
  readonly messageId: string;
  readonly correlationId: string;
  readonly causationId: string | null; // null = 根事件
  readonly timestamp: Date;
  readonly messageType: MessageType;
  readonly payload: Record<string, unknown>;
}

// ── Payload Types ──

export interface DecisionRequest {
  decisionId: string;
  title: string;
  level: string;
}

export interface DecisionResolved {
  decisionId: string;
  status: string;
  chosenOptionId: string;
}

export interface TaskOrder {
  orderId: string;
  action: string;
}

export interface TaskCompleted {
  orderId: string;
  result: Record<string, unknown>;
}

export interface TaskFailed {
  orderId: string;
  error: string;
}

export interface DeliberationProposal {
  meetingId: string;
  consensus: string;
  minorityReport?: string;
}

export interface WorkflowStatusChanged {
  workflowId: string;
  runId: string;
  nodeId: string;
  status: string;
}

export interface BudgetAlert {
  level: 'warning' | 'critical';
  currentSpend: number;
  limit: number;
  period: 'daily' | 'weekly' | 'monthly';
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/types
pnpm test -- src/__tests__/events.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/events.ts packages/types/src/__tests__/events.test.ts
git commit -m "feat(types): add event types with MessageEnvelope and 16 message types"
```

---

### Task 5: @cabinet/types — barrel export index.ts

**Files:**

- Create: `packages/types/src/index.ts`

- [ ] **Step 1: 写 index.ts**

```typescript
// packages/types/src/index.ts

export * from './boundaries.js';
export * from './primitives.js';
export * from './decisions.js';
export * from './events.js';
```

- [ ] **Step 2: 验证全部编译**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/types
pnpm typecheck
```

Expected: 零错误。

- [ ] **Step 3: 运行全部测试**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/types
pnpm test
```

Expected: All tests PASS (boundaries 6 + primitives 9 + decisions 14 + events 4 = 33 tests).

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): add barrel export"
```

---

### Task 6: @cabinet/events — EventBus 接口定义

**Files:**

- Create: `packages/events/src/bus.ts`
- Create: `packages/events/src/__tests__/bus.contract.test.ts`

- [ ] **Step 1: 写契约测试**

```typescript
// packages/events/src/__tests__/bus.contract.test.ts
import { describe, it, expect } from 'vitest';
import type { EventBus } from '../bus';
import { MessageType } from '@cabinet/types';
import type { MessageEnvelope } from '@cabinet/types';

/**
 * 契约测试：验证所有 EventBus 实现必须满足的行为。
 * 每个实现（MemoryEventBus, SqliteEventStore）都必须通过这套测试。
 */
export function runEventBusContractTests(
  createBus: () => EventBus,
  cleanup: () => void = () => {},
) {
  describe('EventBus contract', () => {
    let bus: EventBus;

    beforeEach(() => {
      bus = createBus();
    });

    afterEach(() => {
      cleanup();
    });

    it('publishes and receives an event', async () => {
      const received: MessageEnvelope[] = [];
      bus.subscribe(MessageType.SecretaryMessage, (msg) => {
        received.push(msg);
      });

      const envelope: MessageEnvelope = {
        messageId: 'msg-1',
        correlationId: 'corr-1',
        causationId: null,
        timestamp: new Date(),
        messageType: MessageType.SecretaryMessage,
        payload: { text: 'Hello' },
      };

      await bus.publish(envelope);
      expect(received).toHaveLength(1);
      expect(received[0]!.messageId).toBe('msg-1');
    });

    it('multiple subscribers all receive the event', async () => {
      const received1: MessageEnvelope[] = [];
      const received2: MessageEnvelope[] = [];

      bus.subscribe(MessageType.TaskOrder, (msg) => received1.push(msg));
      bus.subscribe(MessageType.TaskOrder, (msg) => received2.push(msg));

      await bus.publish({
        messageId: 'msg-multi',
        correlationId: 'corr-multi',
        causationId: null,
        timestamp: new Date(),
        messageType: MessageType.TaskOrder,
        payload: { orderId: 'order-1', action: 'execute' },
      });

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });

    it('subscriber does not receive other message types', async () => {
      const received: MessageEnvelope[] = [];
      bus.subscribe(MessageType.TaskOrder, (msg) => received.push(msg));

      await bus.publish({
        messageId: 'msg-other',
        correlationId: 'corr-other',
        causationId: null,
        timestamp: new Date(),
        messageType: MessageType.SecretaryMessage,
        payload: { text: 'Hi' },
      });

      expect(received).toHaveLength(0);
    });

    it('unsubscribe removes the handler', async () => {
      const received: MessageEnvelope[] = [];
      const handler = (msg: MessageEnvelope) => received.push(msg);

      bus.subscribe(MessageType.TaskOrder, handler);
      bus.unsubscribe(MessageType.TaskOrder, handler);

      await bus.publish({
        messageId: 'msg-unsub',
        correlationId: 'corr-unsub',
        causationId: null,
        timestamp: new Date(),
        messageType: MessageType.TaskOrder,
        payload: { orderId: 'o', action: 'a' },
      });

      expect(received).toHaveLength(0);
    });

    it('publish returns immediately (async but non-blocking for subscribers)', async () => {
      let called = false;
      bus.subscribe(MessageType.TaskOrder, () => {
        called = true;
      });

      const promise = bus.publish({
        messageId: 'msg-fast',
        correlationId: 'corr-fast',
        causationId: null,
        timestamp: new Date(),
        messageType: MessageType.TaskOrder,
        payload: { orderId: 'o', action: 'a' },
      });

      expect(promise).toBeInstanceOf(Promise);
      await promise;
      expect(called).toBe(true);
    });
  });
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/events
pnpm test -- src/__tests__/bus.contract.test.ts
```

Expected: FAIL — bus module not found.

- [ ] **Step 3: 实现 bus.ts**

```typescript
// packages/events/src/bus.ts

import type { MessageEnvelope, MessageType } from '@cabinet/types';

export type MessageHandler = (message: MessageEnvelope) => void | Promise<void>;

export interface EventBus {
  /** 发布事件。事件不可变，仅追加写入。 */
  publish(envelope: MessageEnvelope): Promise<void>;

  /** 订阅特定消息类型 */
  subscribe(messageType: MessageType, handler: MessageHandler): void;

  /** 取消订阅 */
  unsubscribe(messageType: MessageType, handler: MessageHandler): void;

  /** 按 correlationId 查询因果链，返回从根到叶的事件列表 */
  getCausationChain(correlationId: string): Promise<MessageEnvelope[]>;
}
```

- [ ] **Step 4: 验证编译**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/events
pnpm typecheck
```

Expected: 零错误。

- [ ] **Step 5: Commit**

```bash
git add packages/events/src/bus.ts packages/events/src/__tests__/bus.contract.test.ts
git commit -m "feat(events): add EventBus interface and contract tests"
```

---

### Task 7: @cabinet/events — 因果链追踪 causation.ts

**Files:**

- Create: `packages/events/src/causation.ts`
- Create: `packages/events/src/__tests__/causation.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// packages/events/src/__tests__/causation.test.ts
import { describe, it, expect } from 'vitest';
import { buildCausationChain, validateCausation, isRootEvent } from '../causation';
import { MessageType } from '@cabinet/types';
import type { MessageEnvelope } from '@cabinet/types';

function makeEnvelope(overrides: Partial<MessageEnvelope> = {}): MessageEnvelope {
  return {
    messageId: 'msg-1',
    correlationId: 'corr-1',
    causationId: null,
    timestamp: new Date(),
    messageType: MessageType.SecretaryMessage,
    payload: { text: 'test' },
    ...overrides,
  };
}

describe('buildCausationChain', () => {
  it('returns events sorted by timestamp (oldest first)', () => {
    const t1 = new Date('2026-01-01T10:00:00Z');
    const t2 = new Date('2026-01-01T10:00:01Z');
    const t3 = new Date('2026-01-01T10:00:02Z');

    const events: MessageEnvelope[] = [
      makeEnvelope({ messageId: 'msg-3', causationId: 'msg-2', timestamp: t3 }),
      makeEnvelope({ messageId: 'msg-1', causationId: null, timestamp: t1 }),
      makeEnvelope({ messageId: 'msg-2', causationId: 'msg-1', timestamp: t2 }),
    ];

    const chain = buildCausationChain('msg-3', events);
    expect(chain).toHaveLength(3);
    expect(chain[0]!.messageId).toBe('msg-1');
    expect(chain[1]!.messageId).toBe('msg-2');
    expect(chain[2]!.messageId).toBe('msg-3');
  });

  it('returns only the target event if it has no causation chain', () => {
    const event = makeEnvelope({ messageId: 'msg-root', causationId: null });
    const chain = buildCausationChain('msg-root', [event]);
    expect(chain).toHaveLength(1);
    expect(chain[0]!.messageId).toBe('msg-root');
  });

  it('returns empty array if target event not found', () => {
    const chain = buildCausationChain('nonexistent', []);
    expect(chain).toHaveLength(0);
  });

  it('breaks cycles gracefully', () => {
    const events: MessageEnvelope[] = [
      makeEnvelope({ messageId: 'msg-a', causationId: 'msg-b' }),
      makeEnvelope({ messageId: 'msg-b', causationId: 'msg-a' }),
    ];
    const chain = buildCausationChain('msg-a', events);
    // Should not loop forever; returns the events it could resolve
    expect(chain.length).toBeGreaterThan(0);
    expect(chain.length).toBeLessThanOrEqual(2);
  });
});

describe('isRootEvent', () => {
  it('returns true for null causationId', () => {
    expect(isRootEvent(makeEnvelope({ causationId: null }))).toBe(true);
  });

  it('returns false for non-null causationId', () => {
    expect(isRootEvent(makeEnvelope({ causationId: 'msg-prev' }))).toBe(false);
  });
});

describe('validateCausation', () => {
  it('returns valid for a correct chain', () => {
    const events: MessageEnvelope[] = [
      makeEnvelope({ messageId: 'parent', causationId: null }),
      makeEnvelope({ messageId: 'child', causationId: 'parent' }),
    ];
    const result = validateCausation(events);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns invalid if causationId references nonexistent message', () => {
    const events: MessageEnvelope[] = [makeEnvelope({ messageId: 'child', causationId: 'ghost' })];
    const result = validateCausation(events);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns invalid for duplicate messageIds', () => {
    const events: MessageEnvelope[] = [
      makeEnvelope({ messageId: 'dup' }),
      makeEnvelope({ messageId: 'dup' }),
    ];
    const result = validateCausation(events);
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/events
pnpm test -- src/__tests__/causation.test.ts
```

Expected: FAIL.

- [ ] **Step 3: 实现 causation.ts**

```typescript
// packages/events/src/causation.ts

import type { MessageEnvelope } from '@cabinet/types';

/**
 * 从事件集中构建给定消息的因果链。
 * 返回从根事件到目标消息的事件列表（按 timestamp 排序）。
 * 防止循环引用导致的无限遍历。
 */
export function buildCausationChain(
  messageId: string,
  allEvents: MessageEnvelope[],
): MessageEnvelope[] {
  const eventMap = new Map<string, MessageEnvelope>();
  for (const event of allEvents) {
    eventMap.set(event.messageId, event);
  }

  const chain: MessageEnvelope[] = [];
  const visited = new Set<string>();
  let currentId: string | null = messageId;

  while (currentId !== null && !visited.has(currentId)) {
    visited.add(currentId);
    const event = eventMap.get(currentId);
    if (!event) break;
    chain.push(event);
    currentId = event.causationId;
  }

  // 从根到叶排序（oldest first）
  chain.reverse();
  return chain;
}

/**
 * 检查事件是否为根事件（无上游因果事件）。
 */
export function isRootEvent(envelope: MessageEnvelope): boolean {
  return envelope.causationId === null;
}

/**
 * 验证事件集合的因果一致性。
 */
export function validateCausation(events: MessageEnvelope[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const idSet = new Set<string>();

  for (const event of events) {
    // 检查重复 messageId
    if (idSet.has(event.messageId)) {
      errors.push(`Duplicate messageId: ${event.messageId}`);
    }
    idSet.add(event.messageId);

    // 检查 causationId 引用的消息是否存在
    if (event.causationId !== null && !idSet.has(event.causationId)) {
      // 可能在被引用之前未出现，做第二次遍历确认
      const referenced = events.find((e) => e.messageId === event.causationId);
      if (!referenced) {
        errors.push(
          `messageId=${event.messageId} references nonexistent causationId=${event.causationId}`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/events
pnpm test -- src/__tests__/causation.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/events/src/causation.ts packages/events/src/__tests__/causation.test.ts
git commit -m "feat(events): add causation chain tracking with cycle detection"
```

---

### Task 8: @cabinet/events — MemoryEventBus 实现

**Files:**

- Create: `packages/events/src/memory-bus.ts`
- Create: `packages/events/src/__tests__/memory-bus.test.ts`

- [ ] **Step 1: 写测试（组合契约测试 + 内存特定测试）**

```typescript
// packages/events/src/__tests__/memory-bus.test.ts
import { describe, it, expect } from 'vitest';
import { MemoryEventBus } from '../memory-bus';
import { runEventBusContractTests } from './bus.contract.test';
import { MessageType } from '@cabinet/types';
import type { MessageEnvelope } from '@cabinet/types';

// 运行契约测试
runEventBusContractTests(
  () => new MemoryEventBus(),
  () => {},
);

// 内存总线特定测试
describe('MemoryEventBus specific', () => {
  let bus: MemoryEventBus;

  beforeEach(() => {
    bus = new MemoryEventBus();
  });

  it('getCausationChain returns events with the same correlationId', async () => {
    const e1: MessageEnvelope = {
      messageId: 'msg-1',
      correlationId: 'corr-x',
      causationId: null,
      timestamp: new Date('2026-01-01T10:00:00Z'),
      messageType: MessageType.TaskOrder,
      payload: { orderId: 'o1', action: 'start' },
    };
    const e2: MessageEnvelope = {
      messageId: 'msg-2',
      correlationId: 'corr-x',
      causationId: 'msg-1',
      timestamp: new Date('2026-01-01T10:00:01Z'),
      messageType: MessageType.TaskCompleted,
      payload: { orderId: 'o1', result: {} },
    };

    await bus.publish(e1);
    await bus.publish(e2);

    const chain = await bus.getCausationChain('corr-x');
    expect(chain).toHaveLength(2);
    expect(chain[0]!.messageId).toBe('msg-1');
    expect(chain[1]!.messageId).toBe('msg-2');
  });

  it('getAllEvents returns all published events sorted by timestamp', async () => {
    const events: MessageEnvelope[] = [
      {
        messageId: 'later',
        correlationId: 'corr-1',
        causationId: null,
        timestamp: new Date('2026-01-01T10:00:02Z'),
        messageType: MessageType.TaskOrder,
        payload: {},
      },
      {
        messageId: 'earlier',
        correlationId: 'corr-1',
        causationId: null,
        timestamp: new Date('2026-01-01T10:00:01Z'),
        messageType: MessageType.TaskOrder,
        payload: {},
      },
    ];

    await bus.publish(events[0]!);
    await bus.publish(events[1]!);

    const all = bus.getAllEvents();
    expect(all).toHaveLength(2);
    expect(all[0]!.timestamp.getTime()).toBeLessThanOrEqual(all[1]!.timestamp.getTime());
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/events
pnpm test -- src/__tests__/memory-bus.test.ts
```

Expected: FAIL — MemoryEventBus not implemented.

- [ ] **Step 3: 实现 memory-bus.ts**

```typescript
// packages/events/src/memory-bus.ts

import type { MessageEnvelope, MessageType } from '@cabinet/types';
import type { EventBus, MessageHandler } from './bus';

export class MemoryEventBus implements EventBus {
  private readonly subscribers = new Map<MessageType, Set<MessageHandler>>();
  private readonly events: MessageEnvelope[] = [];

  async publish(envelope: MessageEnvelope): Promise<void> {
    // 不可变追加
    this.events.push(Object.freeze({ ...envelope }));

    const handlers = this.subscribers.get(envelope.messageType);
    if (handlers) {
      for (const handler of handlers) {
        await handler(envelope);
      }
    }
  }

  subscribe(messageType: MessageType, handler: MessageHandler): void {
    let handlers = this.subscribers.get(messageType);
    if (!handlers) {
      handlers = new Set();
      this.subscribers.set(messageType, handlers);
    }
    handlers.add(handler);
  }

  unsubscribe(messageType: MessageType, handler: MessageHandler): void {
    this.subscribers.get(messageType)?.delete(handler);
  }

  async getCausationChain(correlationId: string): Promise<MessageEnvelope[]> {
    return this.events
      .filter((e) => e.correlationId === correlationId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /** 获取所有已发布事件（仅用于测试和调试） */
  getAllEvents(): readonly MessageEnvelope[] {
    return this.events;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/events
pnpm test -- src/__tests__/memory-bus.test.ts
```

Expected: All tests PASS (contract tests + specific tests).

- [ ] **Step 5: Commit**

```bash
git add packages/events/src/memory-bus.ts packages/events/src/__tests__/memory-bus.test.ts
git commit -m "feat(events): add MemoryEventBus implementation"
```

---

### Task 9: @cabinet/events — barrel export index.ts

**Files:**

- Create: `packages/events/src/index.ts`

- [ ] **Step 1: 写 index.ts**

```typescript
// packages/events/src/index.ts

export type { EventBus, MessageHandler } from './bus.js';
export { MemoryEventBus } from './memory-bus.js';
export { buildCausationChain, isRootEvent, validateCausation } from './causation.js';
```

- [ ] **Step 2: 验证编译和全部测试**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/events
pnpm typecheck
pnpm test
```

Expected: 零错误 + 全部测试通过。

- [ ] **Step 3: Commit**

```bash
git add packages/events/src/index.ts
git commit -m "feat(events): add barrel export"
```

---

### Task 10: @cabinet/storage — SQLite 连接池

**Files:**

- Create: `packages/storage/src/connection.ts`
- Create: `packages/storage/src/__tests__/connection.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// packages/storage/src/__tests__/connection.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConnection, closeConnection, getConnection } from '../connection';
import Database from 'better-sqlite3';

const TEST_DB_PATH = ':memory:';

describe('connection', () => {
  beforeAll(() => {
    createConnection(TEST_DB_PATH);
  });

  afterAll(() => {
    closeConnection();
  });

  it('returns a Database instance', () => {
    const db = getConnection();
    expect(db).toBeInstanceOf(Database);
  });

  it('is in WAL mode', () => {
    const db = getConnection();
    const result = db.pragma('journal_mode');
    expect(result[0]!.journal_mode).toBe('wal');
  });

  it('has foreign keys enabled', () => {
    const db = getConnection();
    const result = db.pragma('foreign_keys');
    expect(result[0]!.foreign_keys).toBe(1);
  });

  it('can create a table and insert data', () => {
    const db = getConnection();
    db.exec('CREATE TABLE IF NOT EXISTS _test (id TEXT PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO _test (id, value) VALUES (?, ?)').run('1', 'hello');
    const row = db.prepare('SELECT value FROM _test WHERE id = ?').get('1') as { value: string };
    expect(row.value).toBe('hello');
    db.exec('DROP TABLE _test');
  });

  it('returns the same connection on repeated calls', () => {
    const db1 = getConnection();
    const db2 = getConnection();
    expect(db1).toBe(db2);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/storage
pnpm test -- src/__tests__/connection.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: 实现 connection.ts**

```typescript
// packages/storage/src/connection.ts

import Database from 'better-sqlite3';

let db: Database.Database | null = null;

/**
 * 创建或获取 SQLite 连接。
 * 仅在首次调用时创建连接，后续调用返回同一实例（单例模式）。
 * 自动启用 WAL 模式和 foreign_keys。
 */
export function createConnection(path: string): Database.Database {
  if (db) return db;

  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * 获取当前连接。如果未初始化则抛出错误。
 */
export function getConnection(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call createConnection() first.');
  }
  return db;
}

/**
 * 关闭数据库连接。
 */
export function closeConnection(): void {
  if (db) {
    db.close();
    db = null;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/storage
pnpm test -- src/__tests__/connection.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/storage/src/connection.ts packages/storage/src/__tests__/connection.test.ts
git commit -m "feat(storage): add SQLite connection pool with WAL mode"
```

---

### Task 11: @cabinet/storage — 数据库迁移

**Files:**

- Create: `packages/storage/src/migrations/001_initial.ts`
- Create: `packages/storage/src/__tests__/migrations.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// packages/storage/src/__tests__/migrations.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConnection, closeConnection, getConnection } from '../connection';
import { runMigration001 } from '../migrations/001_initial';

const EXPECTED_TABLES = [
  'organizations',
  'projects',
  'employees',
  'decisions',
  'event_log',
  'skills',
  'workflows',
  'api_keys',
  'audit_log',
  'metrics',
];

describe('migration 001', () => {
  beforeAll(() => {
    createConnection(':memory:');
  });

  afterAll(() => {
    closeConnection();
  });

  it('creates all expected tables', () => {
    runMigration001(getConnection());

    const tables = getConnection()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_test%'",
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name).sort();
    expect(tableNames).toEqual([...EXPECTED_TABLES].sort());
  });

  it('is idempotent — running twice does not error', () => {
    const db = getConnection();
    expect(() => {
      runMigration001(db);
      runMigration001(db);
    }).not.toThrow();
  });

  it('event_log has required columns', () => {
    const db = getConnection();
    const columns = db.pragma('table_info(event_log)') as {
      cid: number;
      name: string;
      type: string;
      notnull: number;
    }[];
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('message_id');
    expect(colNames).toContain('correlation_id');
    expect(colNames).toContain('causation_id');
    expect(colNames).toContain('type');
    expect(colNames).toContain('payload');
    expect(colNames).toContain('timestamp');
  });

  it('decisions has level column', () => {
    const db = getConnection();
    const columns = db.pragma('table_info(decisions)') as {
      cid: number;
      name: string;
    }[];
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('level');
    expect(colNames).toContain('status');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/storage
pnpm test -- src/__tests__/migrations.test.ts
```

Expected: FAIL.

- [ ] **Step 3: 实现 001_initial.ts**

```typescript
// packages/storage/src/migrations/001_initial.ts

import type Database from 'better-sqlite3';

export function runMigration001(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      captain_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('ai', 'human')),
      pipeline_config TEXT,
      persona TEXT,
      permission_level TEXT NOT NULL DEFAULT 'read'
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      type TEXT NOT NULL CHECK(type IN ('strategic', 'action', 'execution', 'anomaly', 'evolution')),
      level TEXT NOT NULL CHECK(level IN ('L0', 'L1', 'L2', 'L3')),
      status TEXT NOT NULL DEFAULT 'pending',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      options TEXT NOT NULL DEFAULT '[]',
      chosen_option_id TEXT,
      captain_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL UNIQUE,
      correlation_id TEXT NOT NULL,
      causation_id TEXT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_event_log_correlation ON event_log(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_event_log_type ON event_log(type);
    CREATE INDEX IF NOT EXISTS idx_event_log_timestamp ON event_log(timestamp);

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL CHECK(kind IN ('tool', 'prompt', 'composite')),
      input_schema TEXT NOT NULL DEFAULT '{}',
      output_schema TEXT NOT NULL DEFAULT '{}',
      prompt_template TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft'
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      definition TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      key_type TEXT NOT NULL DEFAULT 'api_key',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      changes TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      value REAL NOT NULL,
      tags TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(name);
    CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
  `);
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/storage
pnpm test -- src/__tests__/migrations.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/storage/src/migrations/001_initial.ts packages/storage/src/__tests__/migrations.test.ts
git commit -m "feat(storage): add initial migration with 10 tables"
```

---

### Task 12: @cabinet/storage — Repository 实现

**Files:**

- Create: `packages/storage/src/repositories/organization.ts`
- Create: `packages/storage/src/repositories/project.ts`
- Create: `packages/storage/src/repositories/event-log.ts`
- Create: `packages/storage/src/__tests__/repositories.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// packages/storage/src/__tests__/repositories.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createConnection, closeConnection, getConnection } from '../connection';
import { runMigration001 } from '../migrations/001_initial';
import { OrganizationRepository } from '../repositories/organization';
import { ProjectRepository } from '../repositories/project';
import { EventLogRepository } from '../repositories/event-log';
import { MessageType } from '@cabinet/types';
import type { MessageEnvelope } from '@cabinet/types';
import type { Organization, Project } from '@cabinet/types';
import { ProjectStatus } from '@cabinet/types';

function setupDb() {
  createConnection(':memory:');
  runMigration001(getConnection());
}

describe('OrganizationRepository', () => {
  let repo: OrganizationRepository;

  beforeAll(() => setupDb());
  afterAll(() => closeConnection());

  beforeEach(() => {
    repo = new OrganizationRepository(getConnection());
  });

  it('creates and reads an organization', () => {
    const org: Organization = {
      id: 'org-1',
      name: 'Acme Corp',
      captainId: 'captain-1',
      createdAt: new Date(),
    };
    repo.create(org);
    const found = repo.findById('org-1');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Acme Corp');
  });

  it('returns null for nonexistent organization', () => {
    expect(repo.findById('nonexistent')).toBeNull();
  });

  it('lists all organizations', () => {
    repo.create({ id: 'org-2', name: 'Beta Inc', captainId: 'c2', createdAt: new Date() });
    const all = repo.listAll();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });
});

describe('ProjectRepository', () => {
  let orgRepo: OrganizationRepository;
  let projRepo: ProjectRepository;

  beforeAll(() => setupDb());
  afterAll(() => closeConnection());

  beforeEach(() => {
    orgRepo = new OrganizationRepository(getConnection());
    projRepo = new ProjectRepository(getConnection());
    orgRepo.create({ id: 'org-p', name: 'Test Org', captainId: 'c1', createdAt: new Date() });
  });

  it('creates and reads a project', () => {
    const project: Project = {
      id: 'proj-1',
      organizationId: 'org-p',
      name: 'Launch',
      description: 'Product launch',
      status: ProjectStatus.Active,
      createdAt: new Date(),
    };
    projRepo.create(project);
    const found = projRepo.findById('proj-1');
    expect(found).not.toBeNull();
    expect(found!.status).toBe('active');
  });

  it('lists projects by organization', () => {
    projRepo.create({
      id: 'proj-a',
      organizationId: 'org-p',
      name: 'A',
      description: '',
      status: ProjectStatus.Draft,
      createdAt: new Date(),
    });
    projRepo.create({
      id: 'proj-b',
      organizationId: 'org-p',
      name: 'B',
      description: '',
      status: ProjectStatus.Active,
      createdAt: new Date(),
    });
    const list = projRepo.listByOrganization('org-p');
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('updates project status', () => {
    projRepo.create({
      id: 'proj-u',
      organizationId: 'org-p',
      name: 'Updatable',
      description: '',
      status: ProjectStatus.Draft,
      createdAt: new Date(),
    });
    projRepo.update('proj-u', { status: ProjectStatus.Archived });
    const updated = projRepo.findById('proj-u');
    expect(updated!.status).toBe('archived');
  });
});

describe('EventLogRepository', () => {
  let repo: EventLogRepository;

  beforeAll(() => setupDb());
  afterAll(() => closeConnection());

  beforeEach(() => {
    repo = new EventLogRepository(getConnection());
  });

  it('appends an event and reads it back', () => {
    const envelope: MessageEnvelope = {
      messageId: 'msg-1',
      correlationId: 'corr-1',
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.TaskOrder,
      payload: { orderId: 'o1', action: 'start' },
    };
    repo.append(envelope);

    const events = repo.findByCorrelationId('corr-1');
    expect(events).toHaveLength(1);
    expect(events[0]!.messageId).toBe('msg-1');
  });

  it('returns events sorted by timestamp', () => {
    repo.append({
      messageId: 'msg-later',
      correlationId: 'corr-seq',
      causationId: null,
      timestamp: new Date('2026-01-01T10:00:02Z'),
      messageType: MessageType.TaskOrder,
      payload: {},
    });
    repo.append({
      messageId: 'msg-earlier',
      correlationId: 'corr-seq',
      causationId: null,
      timestamp: new Date('2026-01-01T10:00:01Z'),
      messageType: MessageType.TaskCompleted,
      payload: {},
    });

    const events = repo.findByCorrelationId('corr-seq');
    expect(events[0]!.timestamp.getTime()).toBeLessThanOrEqual(events[1]!.timestamp.getTime());
  });

  it('findAll returns all events sorted', () => {
    const all = repo.findAll();
    expect(all.length).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1]!.timestamp.getTime()).toBeLessThanOrEqual(all[i]!.timestamp.getTime());
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/storage
pnpm test -- src/__tests__/repositories.test.ts
```

Expected: FAIL — repositories not implemented.

- [ ] **Step 3: 实现三个 Repository**

```typescript
// packages/storage/src/repositories/organization.ts

import type Database from 'better-sqlite3';
import type { Organization } from '@cabinet/types';

export class OrganizationRepository {
  constructor(private readonly db: Database.Database) {}

  create(org: Organization): void {
    this.db
      .prepare('INSERT INTO organizations (id, name, captain_id, created_at) VALUES (?, ?, ?, ?)')
      .run(org.id, org.name, org.captainId, org.createdAt.toISOString());
  }

  findById(id: string): Organization | null {
    const row = this.db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.rowToOrg(row);
  }

  listAll(): Organization[] {
    const rows = this.db
      .prepare('SELECT * FROM organizations ORDER BY created_at DESC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToOrg(r));
  }

  private rowToOrg(row: Record<string, unknown>): Organization {
    return {
      id: row.id as string,
      name: row.name as string,
      captainId: row.captain_id as string,
      createdAt: new Date(row.created_at as string),
    };
  }
}
```

```typescript
// packages/storage/src/repositories/project.ts

import type Database from 'better-sqlite3';
import type { Project, ProjectStatus } from '@cabinet/types';

export class ProjectRepository {
  constructor(private readonly db: Database.Database) {}

  create(project: Project): void {
    this.db
      .prepare(
        'INSERT INTO projects (id, organization_id, name, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        project.id,
        project.organizationId,
        project.name,
        project.description,
        project.status,
        project.createdAt.toISOString(),
      );
  }

  findById(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.rowToProject(row);
  }

  listByOrganization(organizationId: string): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects WHERE organization_id = ? ORDER BY created_at DESC')
      .all(organizationId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToProject(r));
  }

  update(id: string, changes: Partial<Pick<Project, 'name' | 'description' | 'status'>>): void {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (changes.name !== undefined) {
      sets.push('name = ?');
      values.push(changes.name);
    }
    if (changes.description !== undefined) {
      sets.push('description = ?');
      values.push(changes.description);
    }
    if (changes.status !== undefined) {
      sets.push('status = ?');
      values.push(changes.status);
    }

    if (sets.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  private rowToProject(row: Record<string, unknown>): Project {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      name: row.name as string,
      description: row.description as string,
      status: row.status as ProjectStatus,
      createdAt: new Date(row.created_at as string),
    };
  }
}
```

```typescript
// packages/storage/src/repositories/event-log.ts

import type Database from 'better-sqlite3';
import type { MessageEnvelope } from '@cabinet/types';

export class EventLogRepository {
  constructor(private readonly db: Database.Database) {}

  append(envelope: MessageEnvelope): void {
    this.db
      .prepare(
        `INSERT INTO event_log (message_id, correlation_id, causation_id, type, payload, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        envelope.messageId,
        envelope.correlationId,
        envelope.causationId,
        envelope.messageType,
        JSON.stringify(envelope.payload),
        envelope.timestamp.toISOString(),
      );
  }

  findByCorrelationId(correlationId: string): MessageEnvelope[] {
    const rows = this.db
      .prepare('SELECT * FROM event_log WHERE correlation_id = ? ORDER BY timestamp ASC')
      .all(correlationId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEnvelope(r));
  }

  findByMessageId(messageId: string): MessageEnvelope | null {
    const row = this.db.prepare('SELECT * FROM event_log WHERE message_id = ?').get(messageId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.rowToEnvelope(row);
  }

  findAll(): MessageEnvelope[] {
    const rows = this.db.prepare('SELECT * FROM event_log ORDER BY timestamp ASC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToEnvelope(r));
  }

  private rowToEnvelope(row: Record<string, unknown>): MessageEnvelope {
    return {
      messageId: row.message_id as string,
      correlationId: row.correlation_id as string,
      causationId: row.causation_id as string | null,
      timestamp: new Date(row.timestamp as string),
      messageType: row.type as MessageEnvelope['messageType'],
      payload: JSON.parse(row.payload as string) as Record<string, unknown>,
    };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/storage
pnpm test -- src/__tests__/repositories.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/storage/src/repositories/ packages/storage/src/__tests__/repositories.test.ts
git commit -m "feat(storage): add Organization, Project, and EventLog repositories"
```

---

### Task 13: @cabinet/events — SqliteEventStore 实现

**Files:**

- Create: `packages/events/src/sqlite-store.ts`
- Create: `packages/events/src/__tests__/sqlite-store.test.ts`

(注意：此 Task 依赖 Task 12 的 EventLogRepository，需要在 monorepo 中正确配置 `@cabinet/events` 依赖 `@cabinet/storage`。)

- [ ] **Step 1: 更新 events 包的依赖**

编辑 `packages/events/package.json`，添加：

```json
{
  "dependencies": {
    "@cabinet/storage": "workspace:*"
  }
}
```

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0
pnpm install
```

- [ ] **Step 2: 写测试**

```typescript
// packages/events/src/__tests__/sqlite-store.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { SqliteEventStore } from '../sqlite-store';
import { runEventBusContractTests } from './bus.contract.test';
import { createConnection, closeConnection, getConnection } from '@cabinet/storage/connection';
import { runMigration001 } from '@cabinet/storage/migrations/001_initial';
import { MessageType } from '@cabinet/types';
import type { MessageEnvelope } from '@cabinet/types';

function setupDb() {
  createConnection(':memory:');
  runMigration001(getConnection());
}

// 运行契约测试
runEventBusContractTests(
  () => new SqliteEventStore(getConnection()),
  () => {},
);

describe('SqliteEventStore specific', () => {
  let store: SqliteEventStore;

  beforeAll(() => setupDb());
  afterAll(() => closeConnection());

  beforeEach(() => {
    store = new SqliteEventStore(getConnection());
  });

  it('getCausationChain traces complete causal chain via correlationId', async () => {
    const e1: MessageEnvelope = {
      messageId: 'root-msg',
      correlationId: 'chain-corr',
      causationId: null,
      timestamp: new Date('2026-01-01T10:00:00Z'),
      messageType: MessageType.SecretaryMessage,
      payload: { text: 'start' },
    };
    const e2: MessageEnvelope = {
      messageId: 'child-msg',
      correlationId: 'chain-corr',
      causationId: 'root-msg',
      timestamp: new Date('2026-01-01T10:00:01Z'),
      messageType: MessageType.TaskOrder,
      payload: { orderId: 'o1', action: 'process' },
    };
    const e3: MessageEnvelope = {
      messageId: 'grandchild-msg',
      correlationId: 'chain-corr',
      causationId: 'child-msg',
      timestamp: new Date('2026-01-01T10:00:02Z'),
      messageType: MessageType.TaskCompleted,
      payload: { orderId: 'o1', result: {} },
    };

    await store.publish(e1);
    await store.publish(e2);
    await store.publish(e3);

    const chain = await store.getCausationChain('chain-corr');
    expect(chain).toHaveLength(3);
    expect(chain[0]!.messageId).toBe('root-msg');
    expect(chain[2]!.messageId).toBe('grandchild-msg');
  });

  it('events are persisted across store instances', async () => {
    const store1 = new SqliteEventStore(getConnection());
    await store1.publish({
      messageId: 'persist-msg',
      correlationId: 'persist-corr',
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.SecretaryMessage,
      payload: { text: 'persistent' },
    });

    const store2 = new SqliteEventStore(getConnection());
    const chain = await store2.getCausationChain('persist-corr');
    expect(chain).toHaveLength(1);
    expect(chain[0]!.messageId).toBe('persist-msg');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/events
pnpm test -- src/__tests__/sqlite-store.test.ts
```

Expected: FAIL — SqliteEventStore not implemented.

- [ ] **Step 4: 实现 sqlite-store.ts**

```typescript
// packages/events/src/sqlite-store.ts

import type { MessageEnvelope, MessageType } from '@cabinet/types';
import type { EventBus, MessageHandler } from './bus';
import { EventLogRepository } from '@cabinet/storage/repositories/event-log';
import type Database from 'better-sqlite3';

export class SqliteEventStore implements EventBus {
  private readonly eventLog: EventLogRepository;
  private readonly subscribers = new Map<MessageType, Set<MessageHandler>>();

  constructor(db: Database.Database) {
    this.eventLog = new EventLogRepository(db);
  }

  async publish(envelope: MessageEnvelope): Promise<void> {
    this.eventLog.append(envelope);

    const handlers = this.subscribers.get(envelope.messageType);
    if (handlers) {
      for (const handler of handlers) {
        await handler(envelope);
      }
    }
  }

  subscribe(messageType: MessageType, handler: MessageHandler): void {
    let handlers = this.subscribers.get(messageType);
    if (!handlers) {
      handlers = new Set();
      this.subscribers.set(messageType, handlers);
    }
    handlers.add(handler);
  }

  unsubscribe(messageType: MessageType, handler: MessageHandler): void {
    this.subscribers.get(messageType)?.delete(handler);
  }

  async getCausationChain(correlationId: string): Promise<MessageEnvelope[]> {
    return this.eventLog.findByCorrelationId(correlationId);
  }

  /** 查询所有事件（用于回放和调试） */
  async findAll(): Promise<MessageEnvelope[]> {
    return this.eventLog.findAll();
  }
}
```

- [ ] **Step 5: 更新 events 的 barrel export**

编辑 `packages/events/src/index.ts`：

```typescript
export type { EventBus, MessageHandler } from './bus.js';
export { MemoryEventBus } from './memory-bus.js';
export { SqliteEventStore } from './sqlite-store.js';
export { buildCausationChain, isRootEvent, validateCausation } from './causation.js';
```

- [ ] **Step 6: 运行测试确认通过**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/events
pnpm test -- src/__tests__/sqlite-store.test.ts
```

Expected: All tests PASS (contract + specific).

- [ ] **Step 7: Commit**

```bash
git add packages/events/src/sqlite-store.ts packages/events/src/__tests__/sqlite-store.test.ts packages/events/src/index.ts
git commit -m "feat(events): add SqliteEventStore with persistence via EventLogRepository"
```

---

### Task 14: @cabinet/storage — barrel export

**Files:**

- Create: `packages/storage/src/index.ts`

- [ ] **Step 1: 写 index.ts**

```typescript
// packages/storage/src/index.ts

export { createConnection, getConnection, closeConnection } from './connection.js';
export { runMigration001 } from './migrations/001_initial.js';
export { OrganizationRepository } from './repositories/organization.js';
export { ProjectRepository } from './repositories/project.js';
export { EventLogRepository } from './repositories/event-log.js';
```

- [ ] **Step 2: 验证全部编译和测试**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0/packages/storage
pnpm typecheck
pnpm test
```

Expected: 零错误 + 全部测试通过。

- [ ] **Step 3: Commit**

```bash
git add packages/storage/src/index.ts
git commit -m "feat(storage): add barrel export"
```

---

### Task 15: Phase 1 集成验证

- [ ] **Step 1: 运行全量测试**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0
pnpm test
```

Expected: 所有 3 个包的全部测试通过。

- [ ] **Step 2: 运行全量类型检查**

```bash
cd c:/Users/dotty/Desktop/AItrans/CabinetV2.0
pnpm typecheck
```

Expected: 零错误。

- [ ] **Step 3: 集成检查点验证**

手动验证 SqliteEventStore → EventLogRepository → causation chain 的完整链路：

```typescript
// 这可以作为额外的手动验证或写入集成测试文件
// packages/events/src/__tests__/phase1-integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConnection, closeConnection, getConnection } from '@cabinet/storage';
import { runMigration001 } from '@cabinet/storage/migrations/001_initial';
import { SqliteEventStore } from '../sqlite-store';
import { MessageType } from '@cabinet/types';
import type { MessageEnvelope } from '@cabinet/types';

describe('Phase 1 integration: SqliteEventStore + EventLog', () => {
  beforeAll(() => {
    createConnection(':memory:');
    runMigration001(getConnection());
  });

  afterAll(() => closeConnection());

  it('publish → persist → causation chain trace', async () => {
    const store = new SqliteEventStore(getConnection());

    // 发布根事件
    await store.publish({
      messageId: 'root',
      correlationId: 'integ-test',
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.TaskOrder,
      payload: { step: 1 },
    });

    // 发布子事件
    await store.publish({
      messageId: 'child',
      correlationId: 'integ-test',
      causationId: 'root',
      timestamp: new Date(),
      messageType: MessageType.TaskCompleted,
      payload: { step: 2 },
    });

    // 验证持久化 + 因果链
    const chain = await store.getCausationChain('integ-test');
    expect(chain).toHaveLength(2);
    expect(chain[0]!.messageId).toBe('root');
    expect(chain[1]!.causationId).toBe('root');
  });
});
```

- [ ] **Step 4: 最终 Commit**

```bash
git add packages/events/src/__tests__/phase1-integration.test.ts
git commit -m "test: add Phase 1 integration checkpoint"
```

---

## Phase 1 总结

| 包               | 文件数 | 测试数（约） |
| :--------------- | :----- | :----------- |
| @cabinet/types   | 5      | 33           |
| @cabinet/events  | 5      | 20+          |
| @cabinet/storage | 6      | 18+          |
| **合计**         | **16** | **70+**      |

**门禁**: pnpm typecheck 零错误 + pnpm test 全部通过 + 集成检查点验证通过。

---

## 后续阶段（待展开）

Phase 2-5 的详细实施计划将在 Phase 1 验收通过后按相同模板展开。概要如下：

| 阶段    | 包                                              | 文件数 | 预估任务数 |
| :------ | :---------------------------------------------- | :----- | :--------- |
| Phase 2 | gateway, agent, memory                          | 18     | ~15 tasks  |
| Phase 3 | decision, secretary, meeting, workflow, harness | 26     | ~20 tasks  |
| Phase 4 | apps/server                                     | 16     | ~12 tasks  |
| Phase 5 | 集成测试 + 性能 + 安全                          | —      | ~8 tasks   |
