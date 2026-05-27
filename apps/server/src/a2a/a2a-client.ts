import type { Logger } from '@cabinet/storage';

export interface A2AAgentCard {
  name: string;
  description: string;
  version: string;
  url?: string;
  capabilities?: { streaming?: boolean };
  skills?: { id: string; name: string; description: string; tags: string[] }[];
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
}

export interface A2AMessage {
  role: 'user' | 'agent';
  content: string;
}

export class A2AClient {
  constructor(private readonly logger: Logger) {}

  /** Discover an external agent via its Agent Card. */
  async discoverAgent(baseUrl: string): Promise<A2AAgentCard | null> {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/.well-known/agent-card.json`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return (await res.json()) as A2AAgentCard;
    } catch (e) {
      this.logger.warn('A2A agent discovery failed', { baseUrl, error: String(e) });
      return null;
    }
  }

  /** Send a synchronous message to an external agent. */
  async sendMessage(agentUrl: string, message: A2AMessage): Promise<string> {
    const url = `${agentUrl.replace(/\/$/, '')}/api/a2a/message`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) throw new Error(`A2A sendMessage failed: ${res.status}`);
    const data = await res.json();
    return data.response ?? data.content ?? JSON.stringify(data);
  }

  /** Send a streaming message (returns SSE reader). */
  async sendStreamingMessage(
    agentUrl: string,
    message: A2AMessage,
  ): Promise<ReadableStream<Uint8Array> | null> {
    try {
      const url = `${agentUrl.replace(/\/$/, '')}/api/a2a/message/stream`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (!res.ok || !res.body) return null;
      return res.body;
    } catch (e) {
      this.logger.warn('A2A streaming failed', { agentUrl, error: String(e) });
      return null;
    }
  }
}
