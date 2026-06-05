//
// SquadLeader — prompt builder and delegation tool for leader_decision squads.
//
// When a squad uses leader_decision routing, this module:
//   1. Builds a squad-aware system prompt for the leader agent
//   2. Provides a delegate_to_member tool definition
//

import type { SquadRepository, SquadRow, SquadMemberRow } from '@cabinet/storage';

export function buildSquadLeaderPrompt(squad: SquadRow, members: SquadMemberRow[]): string {
  const memberLines = members.map((m) => {
    const skills = JSON.parse(m.skills_json) as string[];
    return `- ${m.agent_id} (${m.member_type}): skills=[${skills.join(', ')}], max_concurrent=${m.max_concurrent_tasks}`;
  });

  return [
    `You are the leader of Squad "${squad.name}".`,
    `Description: ${squad.description ?? 'No description'}`,
    '',
    '## Squad Members',
    ...memberLines,
    '',
    '## Delegation Rules',
    '1. Analyze incoming tasks and identify which member is best suited.',
    '2. Use the "delegate_to_member" tool to assign tasks to members.',
    '3. If the task is simple enough, you may handle it yourself.',
    '4. If no member is suitable, respond with why and suggest alternatives.',
    `5. Fallback agent: ${squad.fallback_agent_id ?? 'none'}`,
    '',
    '## Delegate To Member Tool',
    'Use this tool to route a task to a squad member. The member will receive',
    'the task description and execute it independently.',
  ].join('\n');
}

/**
 * Build the tool definition for the delegate_to_member tool.
 * The caller (server/daemon) implements the actual logic when the tool is invoked.
 */
export function buildDelegateTool() {
  return {
    name: 'delegate_to_member',
    description: 'Delegate the current task to a specific squad member.',
    parameters: {
      type: 'object',
      properties: {
        member_id: {
          type: 'string',
          description: 'The agent_id of the squad member to delegate to.',
        },
        task_description: {
          type: 'string',
          description: 'The task for the member to execute.',
        },
        priority: {
          type: 'string',
          enum: ['normal', 'high'],
          description: 'Priority level for the delegated task.',
        },
      },
      required: ['member_id', 'task_description'],
    },
  };
}

// ── SquadLeaderLoop ────────────────────────────────────────────────

export interface SquadMemberInfo {
  agentId: string;
  memberType: 'ai' | 'human';
  skills: string[];
  priority: number;
  maxConcurrentTasks: number;
  active: boolean;
}

export interface SquadInfo {
  id: string;
  name: string;
  description?: string;
  routingStrategy: string;
  members: SquadMemberInfo[];
  leaderAgentId: string;
  fallbackAgentId?: string | null;
}

/**
 * SquadLeaderLoop orchestrates the Leader Decision delegation flow.
 *
 * When a task is routed to a Squad with leader_decision strategy:
 *   1. The Leader Agent receives the task with Squad-aware system prompt.
 *   2. Leader analyzes and either executes directly or calls delegate_to_member.
 *   3. The daemon re-routes the task to the chosen member.
 */
export class SquadLeaderLoop {
  constructor(
    private squad: SquadInfo,
    private onDelegate: (memberAgentId: string, taskSummary: string) => Promise<void>,
  ) {}

  /** Get the Squad-aware system prompt for the Leader Agent. */
  getSystemPrompt(): string {
    const memberLines = this.squad.members
      .filter((m) => m.active)
      .map((m) => {
        const skills = m.skills.length > 0 ? m.skills.join(', ') : 'general';
        const type = m.memberType === 'human' ? '[Human]' : '[AI]';
        return `- ${m.agentId} ${type}: skills=[${skills}], priority=${m.priority}, maxConcurrent=${m.maxConcurrentTasks}`;
      });

    return [
      `You are the Leader of Squad **"${this.squad.name}"**.`,
      this.squad.description ? `\nPurpose: ${this.squad.description}\n` : '',
      '',
      '## Your Squad Members',
      ...(memberLines.length > 0 ? memberLines : ['(No active members)']),
      '',
      '## Your Role',
      '1. Analyze each task and decide who should handle it.',
      '2. Use the `delegate_to_member` tool to assign tasks to the best member.',
      '3. Handle simple tasks yourself — delegate complex/domain-specific ones.',
      '4. For human members, only delegate tasks that need human judgment.',
      '',
      '## Delegation Rules',
      '- Match task requirements to member skills when possible.',
      '- Prefer members with lower current load.',
      `- Routing strategy: ${this.squad.routingStrategy}`,
      `- Fallback: ${this.squad.fallbackAgentId ?? 'handle directly'}`,
    ].join('\n');
  }

  /** Execute delegation — called when the Leader uses delegate_to_member. */
  async handleDelegation(memberAgentId: string, taskSummary: string): Promise<string> {
    const member = this.squad.members.find((m) => m.agentId === memberAgentId);
    if (!member || !member.active) {
      throw new Error(`Member ${memberAgentId} is not available in squad ${this.squad.name}`);
    }
    await this.onDelegate(memberAgentId, taskSummary);
    return `Task delegated to ${memberAgentId}`;
  }

  /** Get a load-aware summary of member status for the Leader. */
  getMemberStatus(loadMap: Map<string, number>): string {
    return this.squad.members
      .filter((m) => m.active)
      .map((m) => {
        const load = loadMap.get(m.agentId) ?? 0;
        return `- ${m.agentId}: load=${load}/${m.maxConcurrentTasks}, skills=[${m.skills.join(', ') || 'general'}]`;
      })
      .join('\n');
  }

  /** Check if the squad can handle a task (at least one active member or Leader can execute). */
  canHandle(): boolean {
    return this.squad.members.some((m) => m.active) || true; // Leader can always execute directly
  }
}
