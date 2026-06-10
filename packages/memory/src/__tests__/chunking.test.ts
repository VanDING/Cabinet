import { describe, it, expect } from 'vitest';
import { chunkDocument, chunkDocuments } from '../chunking.js';

describe('chunkDocument', () => {
  it('splits long text into chunks', () => {
    const text = 'A'.repeat(2000);
    const chunks = chunkDocument(text, { chunkSize: 500, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]!.text.length).toBeLessThanOrEqual(500);
  });

  it('preserves short paragraphs', () => {
    const text = 'Short para one.\n\nShort para two.\n\nShort para three.';
    const chunks = chunkDocument(text, { chunkSize: 500 });
    expect(chunks.length).toBe(3);
    expect(chunks[0]!.text).toContain('Short para one');
  });

  it('handles empty text', () => {
    expect(chunkDocument('')).toEqual([]);
  });

  it('chunks multiple documents', () => {
    const docs = [
      { id: 'd1', text: 'Hello world. This is a test.', metadata: { source: 'test' } },
      { id: 'd2', text: 'Another document here.', metadata: { source: 'test2' } },
    ];
    const chunks = chunkDocuments(docs, { chunkSize: 100 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.source === 'd1')).toBe(true);
  });
});
