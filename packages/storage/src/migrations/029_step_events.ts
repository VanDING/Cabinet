import type Database from 'better-sqlite3';

export function runMigration029(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS step_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      step_number INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      -- event_type enum: 'tool_call', 'tool_result', 'zone_snapshot', 'zone_crossing',
      --                    'handoff', 'error', 'checkpoint', 'llm_call'
      payload TEXT NOT NULL DEFAULT '{}',
      -- payload JSON structure varies by event_type:
      --   tool_call:    { tool_name, args, blocked }
      --   tool_result:  { tool_name, success, duration_ms }
      --   zone_snapshot:{ utilization, zone, breakdown: {...} }
      --   zone_crossing:{ from, to, utilization }
      --   handoff:      { reason, tokens_before, tokens_after }
      --   error:        { category, message }
      --   checkpoint:   { checkpoint_id }
      --   llm_call:     { model, prompt_tokens, completion_tokens, cost }
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_step_events_session ON step_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_step_events_session_step ON step_events(session_id, step_number);
    CREATE INDEX IF NOT EXISTS idx_step_events_type ON step_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_step_events_time ON step_events(timestamp);
  `);
}
