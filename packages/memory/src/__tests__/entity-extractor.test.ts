import { describe, it, expect } from 'vitest';
import { extractCandidateEntities } from '../entity-extractor.js';

describe('extractCandidateEntities', () => {
  it('extracts English capitalized phrases', () => {
    const text = 'The Cabinet AI System uses TypeScript and React.';
    const result = extractCandidateEntities(text);
    expect(result).toContain('Cabinet AI System');
    expect(result).toContain('TypeScript');
    expect(result).toContain('React');
  });

  it('extracts CJK words', () => {
    const text = '用户使用 Cabinet AI 系统。张三在阿里巴巴工作。';
    const result = extractCandidateEntities(text);
    expect(result.some((r) => r.includes('用户'))).toBe(true);
    expect(result.some((r) => r.includes('张三'))).toBe(true);
    expect(result.some((r) => r.includes('阿里巴巴'))).toBe(true);
  });

  it('extracts quoted terms', () => {
    const text = 'The project is called "Alpha Centauri" and uses "Quantum Engine".';
    const result = extractCandidateEntities(text);
    expect(result).toContain('Alpha Centauri');
    expect(result).toContain('Quantum Engine');
  });

  it('filters out stop words', () => {
    const text = 'The And Is Are Was Were';
    const result = extractCandidateEntities(text);
    // All of these are stop words and should be filtered
    expect(result).toHaveLength(0);
  });

  it('filters out short tokens', () => {
    const text = 'A B C D E F G';
    const result = extractCandidateEntities(text);
    expect(result).toHaveLength(0);
  });

  it('filters out pure numbers', () => {
    const text = 'Version 12345 and code 999';
    const result = extractCandidateEntities(text);
    expect(result.some((r) => /^\d+$/.test(r))).toBe(false);
  });

  it('deduplicates case-insensitively', () => {
    const text = 'React is great. React is fast.';
    const result = extractCandidateEntities(text);
    const reactMatches = result.filter((r) => r.toLowerCase() === 'react');
    expect(reactMatches).toHaveLength(1);
  });

  it('handles mixed content', () => {
    const text =
      'John Smith decided to use React for the frontend. 项目截止日期是2024-12-01。';
    const result = extractCandidateEntities(text);
    expect(result).toContain('React');
    expect(result.some((r) => r.includes('项目'))).toBe(true);
    // John Smith may be picked up by compromise enrichment
    expect(result.some((r) => r.toLowerCase().includes('john'))).toBe(true);
  });

  it('returns empty array for empty string', () => {
    expect(extractCandidateEntities('')).toHaveLength(0);
  });

  it('filters generic 2-3 letter acronyms', () => {
    const text = 'GET POST PUT DELETE OK';
    const result = extractCandidateEntities(text);
    expect(result).toHaveLength(0);
  });

  it('keeps meaningful short acronyms', () => {
    const text = 'The API uses SQL and the LLM generates responses.';
    const result = extractCandidateEntities(text);
    expect(result).toContain('API');
    expect(result).toContain('SQL');
    expect(result).toContain('LLM');
  });
});
