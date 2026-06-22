import type { LLMGateway, CostTracker } from '@cabinet/gateway';
import type { AgentLoop } from '@cabinet/agent';
import type { AgentRoleRegistry } from '@cabinet/agent';
import type {
  ShortTermMemory,
  LongTermMemory,
  EntityMemory,
  ProjectMemory,
  MemoryFacade,
} from '@cabinet/memory';
import type { DecisionService } from '@cabinet/decision';
import type { EventBus } from '@cabinet/events';
import type { Database, DecisionRepository } from '@cabinet/storage';
import type { SessionManager } from '@cabinet/secretary';
import type { SubconsciousLoop } from '@cabinet/harness';
import type { DelegationTier } from '@cabinet/types';

export interface CuratorDeps {
  db: Database;
  /** Mutable — checked at call time; may be null if no API key configured */
  gateway: LLMGateway | null;
  agentRegistry: AgentRoleRegistry;
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
  sessionManager: SessionManager;
  shortTerm: ShortTermMemory;
  longTerm: LongTermMemory;
  entity: EntityMemory;
  project: ProjectMemory;
  memoryFacade: MemoryFacade;
  decisionRepo: DecisionRepository;
  decisionService: DecisionService;
  eventBus: EventBus;
  currentTier: DelegationTier;
  costTracker: CostTracker;
  subconsciousLoop: SubconsciousLoop;
  /** Full ServerContext (for capCtx fallback) — use sparingly */
  ctx: Record<string, unknown>;
}

export interface CuratorSubsystem {
  /** Set up all curator-driven timers. Returns handles for shutdown. */
  setupTimers: () => CuratorTimers;
  /** Handler for decision preference updates — wire into context.ts deferred trigger. */
  handleDecisionUpdate: (
    decisionId: string,
    action: string,
    title: string,
    chosenOptionId: string | undefined,
    captainId: string | undefined,
  ) => void;
}

export interface CuratorTimers {
  curatorNudge: NodeJS.Timeout;
  curatorPattern: NodeJS.Timeout;
  subconscious: NodeJS.Timeout;
}

export type CreateCuratorLoop = () => AgentLoop | null;

export type EnqueueCuratorTask = (
  task: () => Promise<void>,
  label: string,
  priority?: 'high' | 'low',
) => Promise<void>;
