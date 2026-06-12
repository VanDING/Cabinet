/** Truncate text at a sentence or paragraph boundary to avoid mid-word cuts. */
export function truncateAtBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  // Try paragraph boundary first
  const paraCut = text.lastIndexOf('\n\n', maxLen);
  if (paraCut > maxLen * 0.7) return text.slice(0, paraCut) + '\n\n...';
  // Try sentence boundary
  const sentenceEnd = /[.!?。！？]\s/;
  let best = -1;
  for (let i = maxLen; i >= maxLen * 0.5; i--) {
    if (sentenceEnd.test(text.slice(i, i + 2))) {
      best = i + 1;
      break;
    }
  }
  if (best > 0) return text.slice(0, best) + ' ...';
  // Fallback: word boundary
  const wordCut = text.lastIndexOf(' ', maxLen);
  if (wordCut > maxLen * 0.7) return text.slice(0, wordCut) + ' ...';
  // Ultimate fallback: hard cut with ellipsis
  return text.slice(0, maxLen - 3) + '...';
}
