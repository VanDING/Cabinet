import type { MessageEnvelope } from '@cabinet/types';

/**
 * 从事件集中构建给定消息的因果链。
 * 返回从根事件到目标消息的事件列表（按 timestamp 排序）。
 * 防止循环引用导致的无限遍历。
 */
export function buildCausationChain(
  messageId: string,
  allEvents: MessageEnvelope[],
): MessageEnvelope[] {
  const eventMap = new Map<string, MessageEnvelope>();
  for (const event of allEvents) {
    eventMap.set(event.messageId, event);
  }

  const chain: MessageEnvelope[] = [];
  const visited = new Set<string>();
  let currentId: string | null = messageId;

  while (currentId !== null && !visited.has(currentId)) {
    visited.add(currentId);
    const event = eventMap.get(currentId);
    if (!event) break;
    chain.push(event);
    currentId = event.causationId;
  }

  // 从根到叶排序（oldest first）
  chain.reverse();
  return chain;
}

/**
 * 检查事件是否为根事件（无上游因果事件）。
 */
export function isRootEvent(envelope: MessageEnvelope): boolean {
  return envelope.causationId === null;
}

/**
 * 验证事件集合的因果一致性。
 */
export function validateCausation(events: MessageEnvelope[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const idSet = new Set<string>();

  for (const event of events) {
    // 检查重复 messageId
    if (idSet.has(event.messageId)) {
      errors.push(`Duplicate messageId: ${event.messageId}`);
    }
    idSet.add(event.messageId);

    // 检查 causationId 引用的消息是否存在
    if (event.causationId !== null) {
      const referenced = events.find((e) => e.messageId === event.causationId);
      if (!referenced) {
        errors.push(
          `messageId=${event.messageId} references nonexistent causationId=${event.causationId}`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
