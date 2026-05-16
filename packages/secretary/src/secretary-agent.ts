import type { AgentLoop } from '@cabinet/agent';
import type { AgentRoleType } from '@cabinet/agent';
import type { LLMGateway } from '@cabinet/gateway';
import { IntentParser, type ParsedIntent, type AgentRouteResult } from './intent-parser.js';
import { SessionManager } from './session-manager.js';

export class SecretaryAgent {
  private readonly intentParser: IntentParser;
  private lastIntent: string | null = null;
  private lastRoute: string | null = null;

  constructor(
    private readonly agentLoop: AgentLoop,
    intentParser: IntentParser,
    private readonly sessionManager: SessionManager,
    private readonly gateway?: LLMGateway,
    /** Callback to dispatch a message to a specialist agent. */
    private readonly dispatchToRole?: (
      roleType: AgentRoleType,
      message: string,
      sessionId: string,
    ) => Promise<string>,
  ) {
    this.intentParser = intentParser;
  }

  async handleMessage(
    sessionId: string,
    message: string,
  ): Promise<{
    intent: ParsedIntent;
    response: string;
    routeResult?: AgentRouteResult;
  }> {
    this.sessionManager.addMessage(sessionId, 'user', message);

    // Route with conversation context for follow-up detection
    const routeResult = await this.intentParser.routeToAgent(message, {
      lastIntent: this.lastIntent ?? undefined,
      lastRoute: this.lastRoute ?? undefined,
    });

    // Track state for next message
    this.lastIntent = routeResult.intent.kind;
    this.lastRoute = routeResult.targetAgent;

    // Handle follow-up: stay on the same agent
    let targetAgent = routeResult.targetAgent;
    if (routeResult.intent.kind === 'follow_up' && this.lastRoute) {
      targetAgent = this.lastRoute as AgentRoleType;
    }

    let response: string;
    if (targetAgent === 'secretary' || !this.dispatchToRole) {
      if (this.agentLoop) {
        const result = await this.agentLoop.run(message);
        response = result.content;
      } else {
        response = [
          `[No LLM available]`,
          `Intent: ${routeResult.intent.kind}`,
          `Would route to: ${targetAgent}`,
          routeResult.confidence < 0.5
            ? `\nNote: low confidence (${(routeResult.confidence * 100).toFixed(0)}%). ${routeResult.suggestion ?? ''}`
            : '',
        ]
          .filter(Boolean)
          .join('\n');
      }
    } else {
      response = await this.dispatchToRole(targetAgent, message, sessionId);
    }

    this.sessionManager.addMessage(sessionId, 'assistant', response);
    return { intent: routeResult.intent, response, routeResult };
  }
}
