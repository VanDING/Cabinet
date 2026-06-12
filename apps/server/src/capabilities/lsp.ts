export function createLSPCapabilities() {
  return {
    workspaceSymbols: async () => ({
      available: false as const,
      error: 'LSP not available in capabilities mode',
    }),
    goToDefinition: async () => ({
      available: false as const,
      error: 'LSP not available in capabilities mode',
    }),
    findReferences: async () => ({
      available: false as const,
      error: 'LSP not available in capabilities mode',
    }),
    diagnostics: async () => ({
      available: false as const,
      error: 'LSP not available in capabilities mode',
    }),
  };
}
