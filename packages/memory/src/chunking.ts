/**
 * Document chunking — split long texts into overlapping chunks.
 */

export interface Chunk {
  id: string;
  text: string;
  index: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface ChunkingOptions {
  /** Target chunk size in characters (default 800). */
  chunkSize?: number;
  /** Overlap between chunks in characters (default 100). */
  overlap?: number;
  /** Primary separator to prefer (default '\n\n'). */
  separator?: string;
}

/**
 * Split text into chunks with overlap.
 *
 * Strategy:
 * 1. Try to split by paragraphs first (separator).
 * 2. If a paragraph is still too long, split by sentence.
 * 3. If a sentence is still too long, split by chunkSize with overlap.
 */
export function chunkDocument(text: string, options?: ChunkingOptions): Chunk[] {
  const chunkSize = options?.chunkSize ?? 800;
  const overlap = options?.overlap ?? 100;
  const separator = options?.separator ?? '\n\n';

  const paragraphs = text.split(separator).filter((p) => p.trim().length > 0);
  const chunks: Chunk[] = [];
  let index = 0;

  for (const para of paragraphs) {
    if (para.length <= chunkSize) {
      chunks.push({ id: `chunk-${index}`, text: para.trim(), index });
      index++;
      continue;
    }

    // Paragraph too long — split by sentences
    const sentences = para.split(/(?<=[.!?。！？])\s+/);
    let buffer = '';

    for (const sentence of sentences) {
      if (buffer.length + sentence.length + 1 <= chunkSize) {
        buffer += (buffer ? ' ' : '') + sentence;
      } else {
        if (buffer) {
          chunks.push({ id: `chunk-${index}`, text: buffer.trim(), index });
          index++;
          buffer = buffer.slice(-overlap) + sentence;
        } else {
          // Single sentence exceeds chunkSize — hard split
          for (let i = 0; i < sentence.length; i += chunkSize - overlap) {
            const slice = sentence.slice(i, i + chunkSize);
            chunks.push({ id: `chunk-${index}`, text: slice.trim(), index });
            index++;
          }
          buffer = '';
        }
      }
    }

    if (buffer) {
      chunks.push({ id: `chunk-${index}`, text: buffer.trim(), index });
      index++;
    }
  }

  return chunks;
}

/** Chunk multiple documents at once. */
export function chunkDocuments(
  docs: Array<{ id: string; text: string; metadata?: Record<string, unknown> }>,
  options?: ChunkingOptions,
): Chunk[] {
  const all: Chunk[] = [];
  for (const doc of docs) {
    const chunks = chunkDocument(doc.text, options);
    for (const c of chunks) {
      c.source = doc.id;
      c.metadata = { ...doc.metadata, ...c.metadata };
    }
    all.push(...chunks);
  }
  return all;
}
