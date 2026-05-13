import type { AgentLoop } from '@cabinet/agent';
import type { LLMGateway } from '@cabinet/gateway';
import { IntentParser, type ParsedIntent } from './intent-parser.js';
import { SessionManager } from './session-manager.js';

export class SecretaryAgent {
  private readonly intentParser: IntentParser;

  constructor(
    private readonly agentLoop: AgentLoop,
    intentParser: IntentParser,
    private readonly sessionManager: SessionManager,
    private readonly gateway?: LLMGateway
  ) {
    // If gateway was provided but not passed through IntentParser, wrap it
    this.intentParser = intentParser;
  }

  async handleMessage(sessionId: string, message: string): Promise<{
    intent: ParsedIntent;
    response: string;
  }> {
    this.sessionManager.addMessage(sessionId, 'user', message);

    // Use LLM-powered parsing when gateway is available
    let intent: ParsedIntent;
    if (this.gateway) {
      intent = await this.intentParser.parseWithLLM(message);
    } else {
      intent = this.intentParser.parse(message);
    }

    // Run agent loop with the message
    const result = await this.agentLoop.run(message);
    this.sessionManager.addMessage(sessionId, 'assistant', result.content);

    return { intent, response: result.content };
  }
}
