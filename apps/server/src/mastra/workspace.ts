import { Workspace, LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS } from '@mastra/core/workspace';

export const cabinetWorkspace = new Workspace({
  filesystem: new LocalFilesystem({
    basePath: '.',
  }),
  sandbox: new LocalSandbox({
    workingDirectory: '.',
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
