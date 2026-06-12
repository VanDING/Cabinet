import {
  getWorkspaceSymbols,
  getDefinition,
  getReferences,
  getDiagnostics,
} from '../../../lsp/ts-service.js';

export function buildLSPTools() {
  return {
    workspaceSymbols: async (query: string): Promise<any> => getWorkspaceSymbols(query),
    goToDefinition: async (file: string, line: number, column: number): Promise<any> =>
      getDefinition(file, line, column),
    findReferences: async (file: string, line: number, column: number): Promise<any> =>
      getReferences(file, line, column),
    diagnostics: async (file: string): Promise<any> => getDiagnostics(file),
  };
}
