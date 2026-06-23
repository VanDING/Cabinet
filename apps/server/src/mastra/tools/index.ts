import * as decision from './decision.js';
import * as agent from './agent.js';
import * as scheduler from './scheduler.js';
import * as status from './status.js';
import {
  gitStatusTool,
  gitDiffTool,
  gitDiffStagedTool,
  gitLogTool,
  gitShowTool,
  gitBranchTool,
  gitBlameTool,
  gitCheckoutBranchTool,
} from './git.js';

const allGitTools = {
  gitStatus: gitStatusTool,
  gitDiff: gitDiffTool,
  gitDiffStaged: gitDiffStagedTool,
  gitLog: gitLogTool,
  gitShow: gitShowTool,
  gitBranch: gitBranchTool,
  gitBlame: gitBlameTool,
  gitCheckoutBranch: gitCheckoutBranchTool,
};

export const cabinetTools = {
  ...decision,
  ...agent,
  ...scheduler,
  ...status,
  ...allGitTools,
};

export const readOnlyTools = {
  ...status,
  gitStatus: gitStatusTool,
  gitDiff: gitDiffTool,
  gitDiffStaged: gitDiffStagedTool,
  gitLog: gitLogTool,
  gitShow: gitShowTool,
  gitBranch: gitBranchTool,
  gitBlame: gitBlameTool,
};
