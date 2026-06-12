import { setupCuratorSubsystem } from './curator.js';
import type { CuratorSubsystem, CuratorTimers } from './curator.js';
import type { BuildState } from './build-state.js';
import { getCurrentTier } from './state.js';

export function initCuratorSubsystem(
  state: BuildState,
): CuratorSubsystem & { timers: CuratorTimers } {
  const {
    db,
    gateway,
    agentRegistry,
    logger,
    sessionManager,
    shortTerm,
    longTerm,
    entity,
    project,
    memoryFacade,
    decisionRepo,
    decisionService,
    eventBus,
    costTracker,
    subconsciousLoop,
    harnessAnalyst,
  } = state;

  if (
    !db ||
    !agentRegistry ||
    !logger ||
    !sessionManager ||
    !shortTerm ||
    !longTerm ||
    !entity ||
    !project ||
    !memoryFacade ||
    !decisionRepo ||
    !decisionService ||
    !eventBus ||
    !costTracker ||
    !subconsciousLoop ||
    !harnessAnalyst
  ) {
    throw new Error('Missing required state for curator subsystem');
  }

  const gatewayOrNull = gateway ?? null;
  const curatorDeps = {
    db,
    gateway: gatewayOrNull,
    agentRegistry,
    logger,
    sessionManager,
    shortTerm,
    longTerm,
    entity,
    project,
    memoryFacade,
    decisionRepo,
    decisionService,
    eventBus: eventBus as any,
    currentTier: getCurrentTier(),
    costTracker,
    subconsciousLoop,
    harnessAnalyst,
    ctx: state as unknown as Record<string, unknown>,
  };

  const curatorSubsystem = setupCuratorSubsystem(curatorDeps);
  state.setCuratorDecisionUpdateTrigger?.(curatorSubsystem.handleDecisionUpdate);

  const curatorTimers = curatorSubsystem.setupTimers();
  return { ...curatorSubsystem, timers: curatorTimers };
}
