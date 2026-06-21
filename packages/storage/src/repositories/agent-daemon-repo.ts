//
// AgentDaemonRepository — persistence for daemon heartbeats and workspace lifecycle.
//

import type Database from 'better-sqlite3';

export interface HeartbeatRow {
  daemon_id: string;
  agent_id: string;
  status: string;
  last_heartbeat_at: string;
  started_at: string;
  version: string;
  metadata_json: string;
}

export interface WorkspaceRow {
  id: string;
  agent_id: string;
  task_id: string | null;
  path: string;
  size_bytes: number;
  status: string;
  created_at: string;
  last_used_at: string;
  expires_at: string | null;
}

export class AgentDaemonRepository {
  constructor(private readonly db: Database.Database) {}

  // ── Heartbeats ──

  upsertHeartbeat(daemonId: string, agentId: string, status = 'online'): void {
    this.db
      .prepare(
        `
      INSERT INTO agent_daemon_heartbeats (daemon_id, agent_id, status, last_heartbeat_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(daemon_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        status = excluded.status,
        last_heartbeat_at = excluded.last_heartbeat_at
    `,
      )
      .run(daemonId, agentId, status);
  }

  /** Find daemons whose last heartbeat is within the given timeout (ms). */
  findOnlineDaemons(heartbeatTimeoutMs: number): HeartbeatRow[] {
    const cutoff = new Date(Date.now() - heartbeatTimeoutMs).toISOString();
    const rows = this.db
      .prepare(
        `
      SELECT * FROM agent_daemon_heartbeats WHERE last_heartbeat_at >= ? AND status != 'offline'
    `,
      )
      .all(cutoff) as Record<string, unknown>[];
    return rows.map((r) => this.rowToHeartbeat(r));
  }

  markOffline(daemonId: string): void {
    this.db
      .prepare(
        `
      UPDATE agent_daemon_heartbeats SET status = 'offline' WHERE daemon_id = ?
    `,
      )
      .run(daemonId);
  }

  findByAgent(agentId: string): HeartbeatRow | null {
    const row = this.db
      .prepare('SELECT * FROM agent_daemon_heartbeats WHERE agent_id = ?')
      .get(agentId) as Record<string, unknown> | undefined;
    return row ? this.rowToHeartbeat(row) : null;
  }

  // ── Workspaces ──

  createWorkspace(row: WorkspaceRow): void {
    this.db
      .prepare(
        `
      INSERT INTO agent_workspaces (id, agent_id, task_id, path, size_bytes, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(row.id, row.agent_id, row.task_id, row.path, row.size_bytes, row.status, row.expires_at);
  }

  findExpiredWorkspaces(): WorkspaceRow[] {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(
        `
      SELECT * FROM agent_workspaces WHERE expires_at IS NOT NULL AND expires_at < ?
    `,
      )
      .all(now) as Record<string, unknown>[];
    return rows.map((r) => this.rowToWorkspace(r));
  }

  findWorkspacesByAgent(agentId: string, status?: string): WorkspaceRow[] {
    const where = status ? 'agent_id = ? AND status = ?' : 'agent_id = ?';
    const params: unknown[] = status ? [agentId, status] : [agentId];
    const rows = this.db
      .prepare(`SELECT * FROM agent_workspaces WHERE ${where} ORDER BY last_used_at DESC`)
      .all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToWorkspace(r));
  }

  updateWorkspaceLastUsed(id: string): void {
    this.db
      .prepare(
        `
      UPDATE agent_workspaces SET last_used_at = datetime('now') WHERE id = ?
    `,
      )
      .run(id);
  }

  updateWorkspaceStatus(id: string, status: string): void {
    this.db
      .prepare(
        `
      UPDATE agent_workspaces SET status = ? WHERE id = ?
    `,
      )
      .run(status, id);
  }

  deleteWorkspace(id: string): void {
    this.db.prepare('DELETE FROM agent_workspaces WHERE id = ?').run(id);
  }

  // ── Row mappers ──

  private rowToHeartbeat(row: Record<string, unknown>): HeartbeatRow {
    return {
      daemon_id: row.daemon_id as string,
      agent_id: row.agent_id as string,
      status: row.status as string,
      last_heartbeat_at: row.last_heartbeat_at as string,
      started_at: row.started_at as string,
      version: row.version as string,
      metadata_json: row.metadata_json as string,
    };
  }

  private rowToWorkspace(row: Record<string, unknown>): WorkspaceRow {
    return {
      id: row.id as string,
      agent_id: row.agent_id as string,
      task_id: row.task_id as string | null,
      path: row.path as string,
      size_bytes: row.size_bytes as number,
      status: row.status as string,
      created_at: row.created_at as string,
      last_used_at: row.last_used_at as string,
      expires_at: row.expires_at as string | null,
    };
  }
}
