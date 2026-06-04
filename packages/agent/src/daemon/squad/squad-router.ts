//
// SquadRouter — routes incoming tasks to the best squad member.
//
// Four strategies:
//   - auto:          weight by skill match + current load
//   - round_robin:   simple round-robin pointer
//   - leader_decision: delegate to leader agent (returns leader's agentId,
//                      leader then calls delegate_to_member tool)
//   - skill_match:   match task keywords against member skills_json
//

import type { SquadRepository, SquadRow, SquadMemberRow } from '@cabinet/storage';

export interface SquadRouteResult {
  targetAgentId: string;
  strategy: string;
  reason: string;
}

export class SquadRouter {
  constructor(private readonly repo: SquadRepository) {}

  /**
   * Route a task to the best squad member.
   * @param squadId — the squad to route within
   * @param taskDescription — task description text (for skill matching)
   * @param activeTaskCounts — map of agentId → current active task count (for load balancing)
   */
  route(
    squadId: string,
    taskDescription: string,
    activeTaskCounts: Map<string, number> = new Map(),
  ): SquadRouteResult | null {
    const squad = this.repo.findById(squadId);
    if (!squad || !squad.enabled) return null;

    const members = this.repo.findActiveMembers(squadId);
    if (members.length === 0) {
      if (squad.fallback_agent_id) {
        return { targetAgentId: squad.fallback_agent_id, strategy: 'fallback', reason: 'No active members' };
      }
      return null;
    }

    switch (squad.routing_strategy) {
      case 'leader_decision':
        return { targetAgentId: squad.leader_agent_id, strategy: 'leader_decision', reason: 'Delegated to leader' };
      case 'round_robin':
        return this.routeRoundRobin(squad, members);
      case 'skill_match':
        return this.routeBySkill(members, taskDescription);
      case 'auto':
      default:
        return this.routeAuto(squad, members, taskDescription, activeTaskCounts);
    }
  }

  /** Get squad status including member states. */
  getSquadStatus(squadId: string, activeTaskCounts: Map<string, number> = new Map()) {
    const squad = this.repo.findById(squadId);
    if (!squad) return null;

    const members = this.repo.findMembers(squadId);
    return {
      squad,
      members: members.map((m) => ({
        ...m,
        skills: JSON.parse(m.skills_json) as string[],
        activeTaskCount: activeTaskCounts.get(m.agent_id) ?? 0,
      })),
    };
  }

  // ── Routing strategies ──

  private routeRoundRobin(squad: SquadRow, members: SquadMemberRow[]): SquadRouteResult {
    const nextIdx = this.repo.advanceRoundRobin(squad.id, members.length);
    const member = members[nextIdx]!;
    return { targetAgentId: member.agent_id, strategy: 'round_robin', reason: `Round-robin index ${nextIdx}` };
  }

  private routeBySkill(members: SquadMemberRow[], task: string): SquadRouteResult {
    const lower = task.toLowerCase();
    let bestMember = members[0]!;
    let bestScore = 0;

    for (const member of members) {
      const skills = JSON.parse(member.skills_json) as string[];
      let score = 0;
      for (const skill of skills) {
        if (lower.includes(skill.toLowerCase())) score += 2;
        // Partial match: check if any skill word appears in task
        for (const word of skill.toLowerCase().split(/[\s/_-]+/)) {
          if (word.length > 2 && lower.includes(word)) score += 1;
        }
      }
      // Apply priority bonus
      score += member.priority * 0.5;
      if (score > bestScore) {
        bestScore = score;
        bestMember = member;
      }
    }

    return { targetAgentId: bestMember.agent_id, strategy: 'skill_match', reason: `Score ${bestScore}` };
  }

  private routeAuto(
    _squad: SquadRow,
    members: SquadMemberRow[],
    task: string,
    activeCounts: Map<string, number>,
  ): SquadRouteResult {
    // Weighted: skill match (0-10) + priority bonus (0-5) - load penalty (0-5)
    const lower = task.toLowerCase();
    let bestMember = members[0]!;
    let bestScore = -Infinity;

    for (const member of members) {
      const skills = JSON.parse(member.skills_json) as string[];
      let skillScore = 0;
      for (const skill of skills) {
        if (lower.includes(skill.toLowerCase())) skillScore += 2;
      }
      const load = activeCounts.get(member.agent_id) ?? 0;
      const loadPenalty = Math.min(load, member.max_concurrent_tasks) * 1.5;
      const score = skillScore + member.priority * 0.5 - loadPenalty;

      if (score > bestScore) {
        bestScore = score;
        bestMember = member;
      }
    }

    return { targetAgentId: bestMember.agent_id, strategy: 'auto', reason: `Score ${bestScore} (skill+priority-load)` };
  }
}
