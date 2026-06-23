import * as decision from './decision.js';
import * as agent from './agent.js';
import * as scheduler from './scheduler.js';
import * as status from './status.js';

export const cabinetTools = {
  ...decision,
  ...agent,
  ...scheduler,
  ...status,
};
