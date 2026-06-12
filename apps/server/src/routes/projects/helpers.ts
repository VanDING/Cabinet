import { relative, join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';

export function rowToProject(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    rootPath: row.root_path ?? '',
    archived: row.archived === 1,
    lastActivityAt: row.last_activity_at,
    icon: row.icon ?? 'folder',
    workflowCount: row.workflow_count ?? 0,
    createdAt: row.created_at,
  };
}

export function collectFileTree(rootPath: string, currentPath: string, maxDepth = 4): any[] {
  const results: any[] = [];
  if (maxDepth <= 0) return results;

  try {
    const entries = readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden files and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const fullPath = join(currentPath, entry.name);
      const relPath = relative(rootPath, fullPath);

      if (entry.isDirectory()) {
        results.push({
          name: entry.name,
          path: relPath,
          type: 'directory',
          children: collectFileTree(rootPath, fullPath, maxDepth - 1),
        });
      } else {
        try {
          const stat = statSync(fullPath);
          results.push({
            name: entry.name,
            path: relPath,
            type: 'file',
            size: stat.size,
          });
        } catch {
          results.push({ name: entry.name, path: relPath, type: 'file' });
        }
      }
    }
  } catch {
    // Permission issues — skip
  }

  return results;
}
