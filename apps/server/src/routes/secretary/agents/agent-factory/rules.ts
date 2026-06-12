import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { RulesLoader } from '@cabinet/agent';

export function buildRulesLoader(projectRootPath?: string) {
  const dirs: string[] = [];
  const homeRules = join(homedir(), '.cabinet', 'rules');
  if (existsSync(homeRules)) dirs.push(homeRules);
  if (projectRootPath) {
    const projectRules = join(projectRootPath, '.cabinet', 'rules');
    if (existsSync(projectRules)) dirs.push(projectRules);
  }
  const globalFile = join(homedir(), '.cabinet', 'CABINET.md');
  return new RulesLoader(dirs, existsSync(globalFile) ? globalFile : undefined);
}
