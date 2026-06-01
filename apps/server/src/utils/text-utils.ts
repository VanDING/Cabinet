export interface ChunkResult {
  content: string;
  startChar: number;
  endChar: number;
}

export function chunkText(text: string, chunkSize = 800, overlap = 100): ChunkResult[] {
  const chunks: ChunkResult[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let current = '';
  let startChar = 0;
  let currentStart = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (current.length + trimmed.length > chunkSize && current.length > 0) {
      chunks.push({ content: current.trim(), startChar: currentStart, endChar: startChar });
      const overlapText = current.length > overlap ? current.slice(-overlap) : current;
      current = overlapText + '\n\n' + trimmed;
      currentStart = startChar - overlapText.length;
    } else {
      current = current ? current + '\n\n' + trimmed : trimmed;
      if (!current || current.length === trimmed.length) currentStart = startChar;
    }
    startChar += para.length + 2;
  }

  if (current.trim()) {
    chunks.push({ content: current.trim(), startChar: currentStart, endChar: text.length });
  }

  return chunks;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function extractTitle(html: string, contentType: string): string | undefined {
  if (!contentType.includes('html')) return undefined;
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim().slice(0, 200);
}
