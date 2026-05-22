import { readFileSync, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

function readTextFileSync(filePath: string): string {
  const buf = readFileSync(filePath);
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return buf.toString('utf-8').slice(1);
  }
  const utf8 = buf.toString('utf-8');
  if (utf8.includes('�')) {
    try { return new TextDecoder('gbk').decode(buf); } catch { /* fall through */ }
  }
  return utf8;
}

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.less',
  '.html', '.htm', '.vue', '.svelte', '.json', '.yml', '.yaml', '.toml',
  '.md', '.mdx', '.txt', '.xml', '.ini', '.cfg', '.env', '.gitignore',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp',
  '.h', '.hpp', '.cs', '.php', '.sql', '.sh', '.bash', '.zsh',
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', '__pycache__', '.venv', 'target', '.cabinet']);

interface IndexerOptions {
  projectId: string;
  rootPath: string;
  db: any;
  gateway: any;
  logger: any;
  maxFiles?: number;
  force?: boolean;
}

/** Simple text chunking without external embedding lib dependency. */
function chunkText(text: string, maxChunkSize = 800, overlap = 100): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChunkSize, text.length);
    // Try to find a natural break point (newline)
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end);
      if (nl > start + maxChunkSize / 2) end = nl;
    }
    chunks.push(text.slice(start, end).trim());
    start = Math.max(start + maxChunkSize - overlap, start + 1);
  }
  return chunks.filter((c) => c.length > 20);
}

/** Generate embeddings via the LLM gateway's embedding endpoint. */
async function generateEmbeddings(texts: string[], gateway: any): Promise<number[][] | null> {
  if (!gateway || !gateway.generateEmbeddings) return null;
  try {
    const result = await gateway.generateEmbeddings({ texts });
    return result.embeddings ?? null;
  } catch {
    return null;
  }
}

export async function indexProject(options: IndexerOptions): Promise<{ indexed: number; skipped: number; errors: number }> {
  const { projectId, rootPath, db, gateway, logger, maxFiles = 200, force = false } = options;

  if (!existsSync(rootPath)) {
    logger.warn('Project root not found for indexing', { rootPath, projectId });
    return { indexed: 0, skipped: 0, errors: 1 };
  }

  // Check which files are already indexed
  const indexedFiles = new Set<string>();
  if (!force) {
    const rows = db.prepare(
      'SELECT DISTINCT file_path FROM document_chunks WHERE project_id = ?',
    ).all(projectId) as any[];
    for (const r of rows) {
      indexedFiles.add(r.file_path);
    }
  }

  let indexed = 0;
  let skipped = 0;
  let errors = 0;

  // Collect source files
  const sourceFiles: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 10 || sourceFiles.length >= maxFiles) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (sourceFiles.length >= maxFiles) return;
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else {
        const ext = extname(entry.name).toLowerCase();
        if (TEXT_EXTENSIONS.has(ext) || (!ext && entry.name === 'Dockerfile')) {
          const relPath = relative(rootPath, fullPath).replace(/\\/g, '/');
          if (!indexedFiles.has(relPath)) {
            sourceFiles.push(fullPath);
          } else {
            skipped++;
          }
        }
      }
    }
  }

  await walk(rootPath, 0);

  // Process in batches for embedding efficiency
  const BATCH_SIZE = 10;
  for (let i = 0; i < sourceFiles.length; i += BATCH_SIZE) {
    const batch = sourceFiles.slice(i, i + BATCH_SIZE);
    const batchChunks: { filePath: string; chunkIndex: number; content: string }[] = [];
    const batchTexts: string[] = [];

    for (const filePath of batch) {
      try {
        const content = readTextFileSync(filePath);
        if (content.length < 10) continue; // skip empty files
        const chunks = chunkText(content);
        const relPath = relative(rootPath, filePath).replace(/\\/g, '/');
        for (const chunk of chunks) {
          batchTexts.push(chunk);
          batchChunks.push({ filePath: relPath, chunkIndex: batchChunks.length, content: chunk });
        }
      } catch {
        errors++;
      }
    }

    if (batchTexts.length === 0) continue;

    // Generate embeddings
    const embeddings = await generateEmbeddings(batchTexts, gateway);

    // Store chunks in DB
    const insertStmt = db.prepare(
      'INSERT INTO document_chunks (project_id, file_path, chunk_index, content, embedding) VALUES (?, ?, ?, ?, ?)',
    );
    const tx = db.transaction(() => {
      for (let j = 0; j < batchChunks.length; j++) {
        const chunk = batchChunks[j]!;
        insertStmt.run(
          projectId,
          chunk.filePath,
          chunk.chunkIndex,
          chunk.content,
          embeddings?.[j] ? JSON.stringify(embeddings[j]) : null,
        );
      }
    });
    tx();
    indexed += batch.length;
    logger.info('Indexed batch', { batchStart: i, count: batch.length, projectId });
  }

  logger.info('Project indexing complete', { projectId, indexed, skipped, errors });
  return { indexed, skipped, errors };
}
