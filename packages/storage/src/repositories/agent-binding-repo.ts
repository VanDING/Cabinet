import type Database from 'better-sqlite3';

export interface AgentMcpBindingRow {
  id: string;
  agent_type: string;
  mcp_server_name: string;
  enabled: number;
  created_at: string;
}

export interface AgentSkillBindingRow {
  id: string;
  agent_type: string;
  skill_name: string;
  enabled: number;
  created_at: string;
}

export class AgentBindingRepository {
  constructor(private readonly db: Database.Database) {}

  // ── MCP bindings ──

  getMcpBindingsForAgent(agentType: string): AgentMcpBindingRow[] {
    return this.db
      .prepare('SELECT * FROM agent_mcp_bindings WHERE agent_type = ?')
      .all(agentType) as AgentMcpBindingRow[];
  }

  getMcpBindingsForServer(serverName: string): AgentMcpBindingRow[] {
    return this.db
      .prepare('SELECT * FROM agent_mcp_bindings WHERE mcp_server_name = ?')
      .all(serverName) as AgentMcpBindingRow[];
  }

  getAllMcpBindings(): AgentMcpBindingRow[] {
    return this.db.prepare('SELECT * FROM agent_mcp_bindings').all() as AgentMcpBindingRow[];
  }

  upsertMcpBinding(agentType: string, serverName: string, enabled: boolean): void {
    const id = `${agentType}__${serverName}`;
    this.db
      .prepare(
        `INSERT INTO agent_mcp_bindings (id, agent_type, mcp_server_name, enabled)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(agent_type, mcp_server_name)
         DO UPDATE SET enabled = excluded.enabled`,
      )
      .run(id, agentType, serverName, enabled ? 1 : 0);
  }

  deleteMcpBinding(agentType: string, serverName: string): void {
    this.db
      .prepare('DELETE FROM agent_mcp_bindings WHERE agent_type = ? AND mcp_server_name = ?')
      .run(agentType, serverName);
  }

  getEnabledMcpServersForAgent(agentType: string): string[] {
    const rows = this.db
      .prepare('SELECT mcp_server_name FROM agent_mcp_bindings WHERE agent_type = ? AND enabled = 1')
      .all(agentType) as Array<{ mcp_server_name: string }>;
    return rows.map((r) => r.mcp_server_name);
  }

  // ── Skill bindings ──

  getSkillBindingsForAgent(agentType: string): AgentSkillBindingRow[] {
    return this.db
      .prepare('SELECT * FROM agent_skill_bindings WHERE agent_type = ?')
      .all(agentType) as AgentSkillBindingRow[];
  }

  getAllSkillBindings(): AgentSkillBindingRow[] {
    return this.db.prepare('SELECT * FROM agent_skill_bindings').all() as AgentSkillBindingRow[];
  }

  upsertSkillBinding(agentType: string, skillName: string, enabled: boolean): void {
    const id = `${agentType}__${skillName}`;
    this.db
      .prepare(
        `INSERT INTO agent_skill_bindings (id, agent_type, skill_name, enabled)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(agent_type, skill_name)
         DO UPDATE SET enabled = excluded.enabled`,
      )
      .run(id, agentType, skillName, enabled ? 1 : 0);
  }

  deleteSkillBinding(agentType: string, skillName: string): void {
    this.db
      .prepare('DELETE FROM agent_skill_bindings WHERE agent_type = ? AND skill_name = ?')
      .run(agentType, skillName);
  }

  getEnabledSkillsForAgent(agentType: string): string[] {
    const rows = this.db
      .prepare('SELECT skill_name FROM agent_skill_bindings WHERE agent_type = ? AND enabled = 1')
      .all(agentType) as Array<{ skill_name: string }>;
    return rows.map((r) => r.skill_name);
  }
}
