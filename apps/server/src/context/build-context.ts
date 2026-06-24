import type { BuildState } from './types.js';
import type { ServerContext } from './types.js';
import { registerBuildServerContext } from './state.js';
import { initDatabase } from './db.js';
import { initDecisionService } from './decision.js';
import { initInfrastructure } from './infrastructure.js';
import { initAgentRegistry } from './agents.js';
import { initSkills, scanSkillDirectory } from './skills.js';
import { initMcpManager } from './mcp.js';
import { scanAgentDirectory, scanProjectDirectory } from './discovery.js';
import { loadSettingsAndTemplate } from './settings.js';
import { initScheduler } from './scheduler.js';
import { assembleContext } from './assembly.js';

function buildServerContextImpl(): ServerContext {
  const state: BuildState = {
    dataDir: '',
    dbPath: '',
    dbMode: 'file',
  };

  initDatabase(state);
  initDecisionService(state);
  initInfrastructure(state);
  initAgentRegistry(state);
  initSkills(state);
  initMcpManager(state);
  scanSkillDirectory(state);
  scanAgentDirectory(state);
  scanProjectDirectory(state);
  loadSettingsAndTemplate(state);
  initScheduler(state);

  const ctx = assembleContext(state);

  return ctx;
}

registerBuildServerContext(buildServerContextImpl);
