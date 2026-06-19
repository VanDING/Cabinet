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

  /** Send a synchronous message to an external agent (A2A v1.0). */
  async sendMessage(agentUrl: string, message: A2AMessage): Promise<string> {
    const url = `${agentUrl.replace(/\/$/, '')}/a2a/tasks`;
    const taskId = `task_${Date.now()}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: taskId,
        session_id: `session_${Date.now()}`,
        capability: 'default',
        input: message.content,
        slot: {},
        configuration: { max_retries: 2, timeout_ms: 120000, slot_write_url: '' },
      }),
    });
    if (!res.ok) throw new Error(`A2A sendMessage failed: ${res.status}`);
    const data = await res.json();
    if ((data as any).status === 'rejected')
      throw new Error(`A2A task rejected: ${(data as any).error}`);

    // Poll for completion
    const statusUrl = `${agentUrl.replace(/\/$/, '')}/a2a/tasks/${taskId}`;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const sr = await fetch(statusUrl);
      if (!sr.ok) continue;
      const status = await sr.json();
      if (status.status === 'completed') return status.output ?? JSON.stringify(status);
      if (status.status === 'failed' || status.status === 'cancelled') {
        throw new Error(`A2A task ${status.status}: ${status.message ?? ''}`);
      }
    }
    throw new Error('A2A task timed out');
  }

  /** Send a streaming message to an external agent (A2A v1.0). */
  async sendStreamingMessage(
    agentUrl: string,
    message: A2AMessage,
  ): Promise<ReadableStream<Uint8Array> | null> {
    try {
      const url = `${agentUrl.replace(/\/$/, '')}/a2a/tasks`;
      const taskId = `task_${Date.now()}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: taskId,
          session_id: `session_${Date.now()}`,
          capability: 'default',
          input: message.content,
          slot: {},
          configuration: { max_retries: 2, timeout_ms: 120000, slot_write_url: '' },
        }),
      });
      if (!res.ok || !res.body) return null;
      return res.body;
    } catch (e) {
      this.logger.warn('A2A streaming failed', { agentUrl, error: String(e) });
      return null;
    }
  }
}
