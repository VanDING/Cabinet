export const readOnlyBlockList = ['writeFile', 'deleteFile', 'executeCommand', 'makeDirectory'];

export function blockWriteOps(
  toolName: string,
  agentName: string,
): { proceed: false; output: string } | undefined {
  if (readOnlyBlockList.includes(toolName)) {
    return { proceed: false, output: `${agentName} is read-only.` };
  }
}
