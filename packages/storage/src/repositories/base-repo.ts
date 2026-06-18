/**
 * Build a dynamic UPDATE SQL string and parameter list.
 * Returns `null` when no fields changed (no SET clauses).
 */
export interface UpdateSqlResult {
  sql: string;
  values: unknown[];
}

export function buildUpdateSql<T extends Record<string, unknown>>(
  tableName: string,
  changes: Partial<T>,
  columnMap: Record<keyof T & string, string>,
  whereClause = 'WHERE id = ?',
): UpdateSqlResult | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(columnMap)) {
    const val = (changes as Record<string, unknown>)[key];
    if (val !== undefined) {
      sets.push(`${col} = ?`);
      values.push(val);
    }
  }
  if (sets.length === 0) return null;
  return {
    sql: `UPDATE ${tableName} SET ${sets.join(', ')} ${whereClause}`,
    values,
  };
}
