import { buildUpdateSql } from './base-repo.js';
//
// SquadRepository — persistence for agent squads and members.
//

import type Database from 'better-sqlite3';

export interface SquadRow {
  id: string;
  name: string;
  description: string | null;
  workspace_id: string;
  leader_agent_id: string;
  routing_strategy: 'auto' | 'round_robin' | 'leader_decision' | 'skill_match';
  fallback_agent_id: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface SquadMemberRow {
  id: string;
  squad_id: string;
  agent_id: string;
  member_type: 'ai' | 'human';
  skills_json: string;
  priority: number;
  max_concurrent_tasks: number;
  active: number;
  created_at: string;
}

export class SquadRepository {
  constructor(private readonly db: Database.Database) {}

  // ── Squads ──

  findAll(workspaceId?: string): SquadRow[] {
    const where = workspaceId ? 'WHERE workspace_id = ?' : '';
    const params = workspaceId ? [workspaceId] : [];
    const rows = this.db
      .prepare(`SELECT * FROM agent_squads ${where} ORDER BY created_at DESC`)
      .all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToSquad(r));
  }

  findById(id: string): SquadRow | null {
    const row = this.db.prepare('SELECT * FROM agent_squads WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToSquad(row) : null;
  }

  create(row: Omit<SquadRow, 'created_at' | 'updated_at'>): string {
    this.db
      .prepare(
        `
      INSERT INTO agent_squads (id, name, description, workspace_id, leader_agent_id,
        routing_strategy, fallback_agent_id, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        row.id,
        row.name,
        row.description,
        row.workspace_id,
        row.leader_agent_id,
        row.routing_strategy,
        row.fallback_agent_id,
        row.enabled,
      );
    return row.id;
  }

  update(id: string, updates: Partial<SquadRow>): void {
    const sets: string[] = ["updated_at = datetime('now')"];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) continue;
      sets.push(`${k} = ?`);
      params.push(v);
    }
    params.push(id);
    this.db.prepare(`UPDATE agent_squads SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM agent_squads WHERE id = ?').run(id);
  }

  // ── Members ──

  findMembers(squadId: string): SquadMemberRow[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_squad_members WHERE squad_id = ? ORDER BY priority DESC')
      .all(squadId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToMember(r));
  }

  findActiveMembers(squadId: string): SquadMemberRow[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM agent_squad_members WHERE squad_id = ? AND active = 1 ORDER BY priority DESC',
      )
      .all(squadId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToMember(r));
  }

  addMember(row: Omit<SquadMemberRow, 'created_at'>): string {
    this.db
      .prepare(
        `
      INSERT INTO agent_squad_members (id, squad_id, agent_id, member_type, skills_json, priority, max_concurrent_tasks, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        row.id,
        row.squad_id,
        row.agent_id,
        row.member_type,
        row.skills_json,
        row.priority,
        row.max_concurrent_tasks,
        row.active,
      );
    return row.id;
  }

  updateMember(id: string, updates: Partial<SquadMemberRow>): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) continue;
      sets.push(`${k} = ?`);
      params.push(v);
    }
    if (sets.length === 0) return;
    params.push(id);
    this.db
      .prepare(`UPDATE agent_squad_members SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params);
  }

  removeMember(id: string): void {
    this.db.prepare('DELETE FROM agent_squad_members WHERE id = ?').run(id);
  }

  // ── Round-robin ──

  getNextRoundRobin(squadId: string): number {
    const row = this.db
      .prepare('SELECT last_member_index FROM agent_squad_round_robin WHERE squad_id = ?')
      .get(squadId) as { last_member_index: number } | undefined;
    return row?.last_member_index ?? 0;
  }

  advanceRoundRobin(squadId: string, memberCount: number): number {
    const txn = this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT last_member_index FROM agent_squad_round_robin WHERE squad_id = ?')
        .get(squadId) as { last_member_index: number } | undefined;
      const current = row?.last_member_index ?? 0;
      const next = (current + 1) % memberCount;
      this.db
        .prepare(
          `
        INSERT INTO agent_squad_round_robin (squad_id, last_member_index)
        VALUES (?, ?)
        ON CONFLICT(squad_id) DO UPDATE SET last_member_index = excluded.last_member_index
      `,
        )
        .run(squadId, next);
      return next;
    });
    return txn();
  }

  // ── Row mappers ──

  private rowToSquad(row: Record<string, unknown>): SquadRow {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string | null,
      workspace_id: row.workspace_id as string,
      leader_agent_id: row.leader_agent_id as string,
      routing_strategy: row.routing_strategy as SquadRow['routing_strategy'],
      fallback_agent_id: row.fallback_agent_id as string | null,
      enabled: row.enabled as number,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  private rowToMember(row: Record<string, unknown>): SquadMemberRow {
    return {
      id: row.id as string,
      squad_id: row.squad_id as string,
      agent_id: row.agent_id as string,
      member_type: row.member_type as SquadMemberRow['member_type'],
      skills_json: row.skills_json as string,
      priority: row.priority as number,
      max_concurrent_tasks: row.max_concurrent_tasks as number,
      active: row.active as number,
      created_at: row.created_at as string,
    };
  }
}
