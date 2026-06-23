import type { BuildState } from './build-state.js';
import type { ServerContext } from './types.js';
import { registerBuildServerContext } from './state.js';
import { initDatabase } from './db.js';
import { initDecisionService } from './decision.js';
import { initGateway } from './gateway.js';
import { initCoreMemory } from './core-memory.js';
import { initMemoryFacade } from './memory.js';
import { initInfrastructure } from './infrastructure.js';
import { initAgentRegistry } from './agents.js';
import { initDaemon } from './daemon.js';
import { initAutopilot } from './autopilot.js';
import { initSkills, scanSkillDirectory } from './skills.js';
import { initMcpManager } from './mcp.js';
import { scanAgentDirectory, scanProjectDirectory } from './discovery.js';
import { loadSettingsAndTemplate } from './settings.js';
import { initFeedbackLoop } from './feedback.js';
import { initKnowledgeAndSubconscious } from './knowledge.js';
import { initCuratorSubsystem } from './curator-integration.js';
import { initScheduler } from './scheduler.js';
import { initTimersAndWatchers } from './timers.js';
import { assembleContext } from './assembly.js';
import { mastra as mastraInstance } from '../mastra/index.js';

function buildServerContextImpl(): ServerContext {
  const state: BuildState = {
    dataDir: '',
    dbPath: '',
    dbMode: 'file',
    modelMapping: {},
    providerConfigsFromSettings: {},
  };

  initDatabase(state);
  initCoreMemory(state);
  initDecisionService(state);
  initGateway(state);
  initInfrastructure(state);
  initMemoryFacade(state);
  initAgentRegistry(state);
  initDaemon(state);
  initAutopilot(state);
  initSkills(state);
  initMcpManager(state);
  scanSkillDirectory(state);
  scanAgentDirectory(state);
  scanProjectDirectory(state);
  loadSettingsAndTemplate(state);
  initFeedbackLoop(state);
  initKnowledgeAndSubconscious(state);
  const curator = initCuratorSubsystem(state);
  state.curatorSubsystem = curator;
  state.curatorTimers = curator.timers;
  initScheduler(state);
  initTimersAndWatchers(state);

  const ctx = assembleContext(state);
  ctx.mastra = mastraInstance;

  // Update curator deps with fully-populated ctx
  (state.curatorSubsystem as any).ctx = ctx;

  return ctx;
}

registerBuildServerContext(buildServerContextImpl);
