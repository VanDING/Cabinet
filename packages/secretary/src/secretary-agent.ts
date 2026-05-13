import type { AgentLoop } from '@cabinet/agent';
import { IntentParser, type ParsedIntent } from './intent-parser.js';
import { SessionManager } from './session-manager.js';

export class SecretaryAgent {
  constructor(
    private readonly agentLoop: AgentLoop,
    private readonly intentParser: IntentParser,
    private readonly sessionManager: SessionManager
  ) {}

  async handleMessage(sessionId: string, message: string): Promise<{
    intent: ParsedIntent;
    response: string;
  }> {
    this.sessionManager.addMessage(sessionId, 'user', message);
    const intent = this.intentParser.parse(message);

    // Run agent loop with the message
    const result = await this.agentLoop.run(message);
    this.sessionManager.addMessage(sessionId, 'assistant', result.content);

    return { intent, response: result.content };
  }
}
