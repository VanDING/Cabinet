import { join } from 'node:path';
import { unlinkSync, writeFileSync } from 'node:fs';
import { CABINET_DIR } from '@cabinet/storage';

export const PROJECTS_DIR = join(CABINET_DIR, 'projects');

export function writeProjectIndex(project: {
  id: string;
  name: string;
  description?: string;
  rootPath?: string;
  archived?: boolean;
  lastActivityAt?: string;
  createdAt?: string;
}): void {
  const indexPath = join(PROJECTS_DIR, `${project.id}.json`);
  writeFileSync(
    indexPath,
    JSON.stringify(
      {
        id: project.id,
        name: project.name,
        description: project.description ?? '',
        rootPath: project.rootPath ?? '',
        archived: project.archived ?? false,
        lastActivityAt: project.lastActivityAt ?? new Date().toISOString(),
        createdAt: project.createdAt ?? new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf-8',
  );
}

export function removeProjectIndex(id: string): void {
  const indexPath = join(PROJECTS_DIR, `${id}.json`);
  try {
    unlinkSync(indexPath);
  } catch {
    /* ok */
  }
}
