import { readTextFile } from '../utils.js';

export interface ChatFile {
  name: string;
  path: string;
  type?: string;
}

export async function augmentMessageWithFiles(message: string, files: ChatFile[]): Promise<string> {
  if (files.length === 0) return message;

  const fileLines: string[] = [];
  for (const f of files) {
    fileLines.push(`- ${f.name} (${f.path})`);
    if (f.type === 'project') {
      try {
        const { readFile } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const root = join(process.cwd(), '..', '..', '..');
        const fullPath = join(root, f.path);
        if (fullPath.startsWith(root)) {
          const content = await readTextFile(fullPath);
          fileLines.push(`\n--- ${f.path} ---\n${content.slice(0, 8000)}\n`);
        }
      } catch {
        /* file not readable, skip content */
      }
    }
  }
  return `${message}\n\n[Attached files]\n${fileLines.join('\n')}`;
}
