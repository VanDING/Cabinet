import * as decision from './decision.js';
import * as agent from './agent.js';
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
import { webFetchTool, webSearchTool } from './web.js';
import { npmInstallTool, npmListTool } from './npm.js';
import { createSkillTool, updateSkillTool, useSkillTool } from './skill.js';

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
  ...status,
  ...allGitTools,
  webFetch: webFetchTool,
  webSearch: webSearchTool,
  npmInstall: npmInstallTool,
  npmList: npmListTool,
  create_skill: createSkillTool,
  update_skill: updateSkillTool,
  use_skill: useSkillTool,
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
  webFetch: webFetchTool,
  webSearch: webSearchTool,
};
