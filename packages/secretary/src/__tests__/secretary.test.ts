import { describe, it, expect, beforeEach } from 'vitest';
import { IntentParser } from '../intent-parser.js';
import { SessionManager } from '../session-manager.js';
import { GreetingService } from '../greeting.js';

describe('IntentParser', () => {
  let parser: IntentParser;
  beforeEach(() => { parser = new IntentParser(); });

  it('detects decision requests', () => {
    const result = parser.parse('帮我分析是否该进入母婴市场');
    expect(result.kind).toBe('decision_request');
  });

  it('detects meeting requests', () => {
    const result = parser.parse('帮我组织财务和市场顾问讨论预算');
    expect(result.kind).toBe('meeting_request');
  });

  it('detects knowledge queries', () => {
    const result = parser.parse('什么是SWOT分析？');
    expect(result.kind).toBe('knowledge_query');
  });

  it('returns unknown for unclear input', () => {
    const result = parser.parse('...');
    expect(result.kind).toBe('unknown');
  });
});

describe('SessionManager', () => {
  it('manages session lifecycle', () => {
    const sm = new SessionManager();
    sm.create('s1', 'Test');
    sm.addMessage('s1', 'user', 'Hello');
    sm.addMessage('s1', 'assistant', 'Hi!');
    const session = sm.get('s1');
    expect(session!.messages).toHaveLength(2);
  });
});

describe('GreetingService', () => {
  it('generates greeting with stats', () => {
    const svc = new GreetingService();
    const greeting = svc.generateGreeting('Captain', 3, 1.50);
    expect(greeting).toContain('Captain');
    expect(greeting).toContain('3 pending');
    expect(greeting).toContain('$1.50');
  });
});
