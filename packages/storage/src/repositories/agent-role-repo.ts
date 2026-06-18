import { buildUpdateSql } from './base-repo.js';
import type Database from 'better-sqlite3';

export interface AgentRoleRow {
  type: string;
  name: string;
  description: string;
  system_prompt: string;
  model?: string;
  model_tier?: string;
  temperature: number;
  max_response_tokens: number;
  allowed_tools: string;
  context_budget: number;
  is_builtin: number;
  created_at: string;
}

export class AgentRoleRepository {
  constructor(private readonly db: Database.Database) {}

  findAll(): AgentRoleRow[] {
    const rows = this.db.prepare('SELECT * FROM agent_roles ORDER BY name ASC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToRole(r));
  }

  findBuiltin(): AgentRoleRow[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_roles WHERE is_builtin = 1 ORDER BY name ASC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToRole(r));
  }

  findCustom(): AgentRoleRow[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_roles WHERE is_builtin = 0 ORDER BY name ASC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToRole(r));
  }

  findByName(name: string): AgentRoleRow | null {
    const row = this.db
      .prepare('SELECT * FROM agent_roles WHERE name = ? AND is_builtin = 0')
      .get(name) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToRole(row);
  }

  findByType(type: string): AgentRoleRow | null {
    const row = this.db.prepare('SELECT * FROM agent_roles WHERE type = ?').get(type) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.rowToRole(row);
  }

  upsert(role: AgentRoleRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO agent_roles (type, name, description, system_prompt, model, model_tier, temperature, max_response_tokens, allowed_tools, context_budget, is_builtin, external_config, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        role.type,
        role.name,
        role.description,
        role.system_prompt,
        role.model ?? 'default',
        role.model_tier ?? null,
        role.temperature,
        role.max_response_tokens,
        role.allowed_tools,
        role.context_budget,
        role.is_builtin,
        (role as any).external_config ?? null,
        role.created_at ?? new Date().toISOString(),
      );
  }

  update(
    name: string,
    changes: Partial<
      Pick<
        AgentRoleRow,
        | 'system_prompt'
        | 'model'
        | 'model_tier'
        | 'temperature'
        | 'max_response_tokens'
        | 'allowed_tools'
        | 'context_budget'
      >
    >,
  ): void {
    const result = buildUpdateSql(
      'agent_roles',
      changes,
      {
        system_prompt: 'system_prompt',
        model: 'model',
        model_tier: 'model_tier',
        temperature: 'temperature',
        max_response_tokens: 'max_response_tokens',
        allowed_tools: 'allowed_tools',
        context_budget: 'context_budget',
      },
      'WHERE name = ? AND is_builtin = 0',
    );
    if (!result) return;
    this.db.prepare(result.sql).run(...result.values, name);
  }

  deleteByName(name: string): void {
    this.db.prepare('DELETE FROM agent_roles WHERE name = ?').run(name);
  }

  deleteByType(type: string): void {
    this.db.prepare('DELETE FROM agent_roles WHERE type = ?').run(type);
  }

  private rowToRole(row: Record<string, unknown>): AgentRoleRow {
    return {
      type: row.type as string,
      name: row.name as string,
      description: row.description as string,
      system_prompt: row.system_prompt as string,
      model: row.model as string,
      model_tier: row.model_tier as string | undefined,
      temperature: row.temperature as number,
      max_response_tokens: row.max_response_tokens as number,
      allowed_tools: row.allowed_tools as string,
      context_budget: row.context_budget as number,
      is_builtin: row.is_builtin as number,
      created_at: row.created_at as string,
    };
  }
}
