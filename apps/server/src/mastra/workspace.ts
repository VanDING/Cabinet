import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { CABINET_DIR } from '@cabinet/storage';
import { Workspace, LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS } from '@mastra/core/workspace';

const WORKSPACE_PATH = join(CABINET_DIR, 'workspace');
if (!existsSync(WORKSPACE_PATH)) mkdirSync(WORKSPACE_PATH, { recursive: true });

export const cabinetWorkspace = new Workspace({
  filesystem: new LocalFilesystem({
    basePath: WORKSPACE_PATH,
  }),
  sandbox: new LocalSandbox({
    workingDirectory: WORKSPACE_PATH,
  }),
  tools: {
    [WORKSPACE_TOOLS.FILESYSTEM.READ_FILE]: { name: 'readFile' },
    [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: { name: 'writeFile' },
    [WORKSPACE_TOOLS.FILESYSTEM.LIST_FILES]: { name: 'listDirectory' },
    [WORKSPACE_TOOLS.FILESYSTEM.GREP]: { name: 'grep' },
    [WORKSPACE_TOOLS.FILESYSTEM.FILE_STAT]: { name: 'fileInfo' },
    [WORKSPACE_TOOLS.FILESYSTEM.MKDIR]: { name: 'makeDirectory' },
    [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: { name: 'deleteFile', requireApproval: true },
    [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: { name: 'executeCommand', requireApproval: true },
    [WORKSPACE_TOOLS.SEARCH.SEARCH]: { name: 'search' },
    [WORKSPACE_TOOLS.LSP.LSP_INSPECT]: { name: 'lspInspect' },
  },
});
