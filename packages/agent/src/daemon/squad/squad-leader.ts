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
