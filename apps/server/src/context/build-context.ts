import type { BuildState } from './types.js';
import type { ServerContext } from './types.js';
import { registerBuildServerContext } from './state.js';
import { initDatabase } from './db.js';
import { initDecisionService } from './decision.js';
import { initCoreMemory } from './core-memory.js';
import { initMemoryFacade } from './memory.js';
import { initInfrastructure } from './infrastructure.js';
import { initAgentRegistry } from './agents.js';
import { initSkills, scanSkillDirectory } from './skills.js';
import { initMcpManager } from './mcp.js';
import { scanAgentDirectory, scanProjectDirectory } from './discovery.js';
import { loadSettingsAndTemplate } from './settings.js';
import { initKnowledgeAndSubconscious } from './knowledge.js';
import { initScheduler } from './scheduler.js';
import { assembleContext } from './assembly.js';
import { mastra as mastraInstance } from '../mastra/index.js';

function buildServerContextImpl(): ServerContext {
  const state: BuildState = {
    dataDir: '',
    dbPath: '',
    dbMode: 'file',
  };

  initDatabase(state);
  initCoreMemory(state);
  initDecisionService(state);
  initInfrastructure(state);
  initMemoryFacade(state);
  initAgentRegistry(state);
  initSkills(state);
  initMcpManager(state);
  scanSkillDirectory(state);
  scanAgentDirectory(state);
  scanProjectDirectory(state);
  loadSettingsAndTemplate(state);
  initKnowledgeAndSubconscious(state);
  initScheduler(state);

  const ctx = assembleContext(state);
  ctx.mastra = mastraInstance;

  return ctx;
}

registerBuildServerContext(buildServerContextImpl);
