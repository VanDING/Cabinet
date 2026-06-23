import { MCPClient } from '@mastra/mcp';

export const browserMcp = new MCPClient({
  id: 'cabinet-browser',
  servers: {
    browser: {
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
    },
  },
});
