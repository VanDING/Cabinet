import type Database from 'better-sqlite3';

export interface SkillRow {
  id: string;
  name: string;
  description: string;
  kind: string;
  input_schema: string;
  output_schema: string;
  prompt_template: string;
  version: number;
  status: string;
  metadata: string | null;
  references_path: string | null;
  scripts_path: string | null;
}

export class SkillRepository {
  constructor(private readonly db: Database.Database) {}

  findAll(): SkillRow[] {
    const rows = this.db.prepare('SELECT * FROM skills ORDER BY version DESC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToSkill(r));
  }

  findActive(): SkillRow[] {
    const rows = this.db.prepare("SELECT * FROM skills WHERE status = 'active'").all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToSkill(r));
  }

  findById(id: string): SkillRow | null {
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.rowToSkill(row);
  }

  findByName(name: string): { id: string } | null {
    const row = this.db.prepare('SELECT id FROM skills WHERE name = ?').get(name) as
      | { id: string }
      | undefined;
    return row ?? null;
  }

  insert(skill: SkillRow): void {
    this.db
      .prepare(
        `INSERT INTO skills (id, name, description, kind, input_schema, output_schema, prompt_template, version, status, metadata, references_path, scripts_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        skill.id,
        skill.name,
        skill.description,
        skill.kind,
        skill.input_schema,
        skill.output_schema,
        skill.prompt_template,
        skill.version,
        skill.status,
        skill.metadata,
        skill.references_path,
        skill.scripts_path,
      );
  }

  upsert(skill: SkillRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO skills (id, name, description, kind, input_schema, output_schema, prompt_template, version, status, metadata, references_path, scripts_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        skill.id,
        skill.name,
        skill.description,
        skill.kind,
        skill.input_schema,
        skill.output_schema,
        skill.prompt_template,
        skill.version,
        skill.status,
        skill.metadata,
        skill.references_path,
        skill.scripts_path,
      );
  }

  update(
    id: string,
    changes: { name?: string; description?: string; version?: number; metadata?: string },
  ): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (changes.name !== undefined) {
      sets.push('name = ?');
      values.push(changes.name);
    }
    if (changes.description !== undefined) {
      sets.push('description = ?');
      values.push(changes.description);
    }
    if (changes.version !== undefined) {
      sets.push('version = ?');
      values.push(changes.version);
    }
    if (changes.metadata !== undefined) {
      sets.push('metadata = ?');
      values.push(changes.metadata);
    }
    if (sets.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE skills SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  }

  private rowToSkill(row: Record<string, unknown>): SkillRow {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      kind: row.kind as string,
      input_schema: row.input_schema as string,
      output_schema: row.output_schema as string,
      prompt_template: row.prompt_template as string,
      version: row.version as number,
      status: row.status as string,
      metadata: row.metadata as string | null,
      references_path: row.references_path as string | null,
      scripts_path: row.scripts_path as string | null,
    };
  }
}
