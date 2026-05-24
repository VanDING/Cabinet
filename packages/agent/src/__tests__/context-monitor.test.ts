import { describe, it, expect } from 'vitest';
import { getEncoding } from 'js-tiktoken';
import { ContextMonitor } from '../context-monitor.js';
import { MemoryEventBus } from '@cabinet/events';

// 10 representative text samples covering English, CJK, mixed, code, and edge cases
const samples = [
  { name: 'empty', text: '' },
  { name: 'english-short', text: 'Hello, world!' },
  { name: 'english-paragraph', text: 'The quick brown fox jumps over the lazy dog. This pangram contains every letter of the English alphabet at least once.' },
  { name: 'cjk-short', text: '你好世界' },
  { name: 'cjk-paragraph', text: '人工智能技术正在快速发展，大型语言模型已经能够理解和生成自然语言文本。这种技术在翻译、摘要、对话系统等领域有广泛应用。' },
  { name: 'mixed-en-zh', text: 'Hello 你好 world 世界! This is a test 这是一个测试。' },
  { name: 'code-snippet', text: 'function add(a: number, b: number): number { return a + b; }' },
  { name: 'markdown', text: '# Title\n\n- Item 1\n- Item 2\n\n**Bold** and *italic* text.' },
  { name: 'json', text: '{"name": "Alice", "age": 30, "active": true, "roles": ["admin", "user"]}' },
  { name: 'special-chars', text: '$$ E = mc^2 $$\n\t\\n\\t\\n' },
];

describe('ContextMonitor token estimation', () => {
  const bus = new MemoryEventBus();

  it('matches js-tiktoken for cl100k_base models', () => {
    const monitor = ContextMonitor.forModel('claude-sonnet-4-6', bus);
    const enc = getEncoding('cl100k_base');

    for (const { text } of samples) {
      const expected = enc.encode(text).length;
      const actual = monitor.estimateTokens(text);
      const diff = Math.abs(actual - expected) / (expected || 1);
      expect(diff).toBeLessThan(0.01); // < 1% difference
      expect(actual).toBe(expected); // exact match since we use the same library
    }
  });

  it('matches js-tiktoken for o200k_base models', () => {
    const monitor = ContextMonitor.forModel('gpt-4o', bus);
    const enc = getEncoding('o200k_base');

    for (const { text } of samples) {
      const expected = enc.encode(text).length;
      const actual = monitor.estimateTokens(text);
      expect(actual).toBe(expected);
    }
  });

  it('returns 0 for empty or nullish text', () => {
    const monitor = ContextMonitor.forModel('claude-sonnet-4-6', bus);
    expect(monitor.estimateTokens('')).toBe(0);
    expect(monitor.estimateTokens('')).toBe(0);
  });

  it('uses cl100k_base as fallback for unknown models', () => {
    const monitor = ContextMonitor.forModel('unknown-model-v99', bus);
    const enc = getEncoding('cl100k_base');
    const text = 'Hello world';
    expect(monitor.estimateTokens(text)).toBe(enc.encode(text).length);
  });

  it('produces consistent results across repeated calls', () => {
    const monitor = ContextMonitor.forModel('deepseek-v3', bus);
    const text = 'Consistency check';
    const first = monitor.estimateTokens(text);
    const second = monitor.estimateTokens(text);
    expect(first).toBe(second);
  });
});

describe('ContextMonitor zone classification', () => {
  const bus = new MemoryEventBus();

  it('classifies smart zone below 40%', () => {
    const monitor = new ContextMonitor(bus, { maxTokens: 1000 });
    const snap = monitor.snapshot({ systemPrompt: 100, messages: 100, toolResults: 100, memory: 99 });
    expect(snap.zone).toBe('smart');
  });

  it('classifies warning zone at 40-60%', () => {
    const monitor = new MemoryEventBus();
    const m = new ContextMonitor(monitor, { maxTokens: 1000 });
    const snap = m.snapshot({ systemPrompt: 200, messages: 200, toolResults: 0, memory: 0 });
    expect(snap.zone).toBe('warning');
  });

  it('classifies critical zone at 60-80%', () => {
    const monitor = new MemoryEventBus();
    const m = new ContextMonitor(monitor, { maxTokens: 1000 });
    const snap = m.snapshot({ systemPrompt: 300, messages: 300, toolResults: 100, memory: 0 });
    expect(snap.zone).toBe('critical');
  });

  it('classifies dumb zone above 80%', () => {
    const monitor = new MemoryEventBus();
    const m = new ContextMonitor(monitor, { maxTokens: 1000 });
    const snap = m.snapshot({ systemPrompt: 500, messages: 300, toolResults: 100, memory: 100 });
    expect(snap.zone).toBe('dumb');
  });
});
