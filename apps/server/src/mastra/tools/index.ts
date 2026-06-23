import * as decision from './decision.js';
import * as agent from './agent.js';
import * as scheduler from './scheduler.js';
import * as status from './status.js';
import * as git from './git.js';

export const cabinetTools = {
  ...decision,
  ...agent,
  ...scheduler,
  ...status,
  ...git,
};

export const readOnlyTools = {
  ...status,
  ...git,
};
