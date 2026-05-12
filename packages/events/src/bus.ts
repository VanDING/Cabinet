import type { MessageEnvelope, MessageType } from '@cabinet/types';

export type MessageHandler = (message: MessageEnvelope) => void | Promise<void>;

export interface EventBus {
  /** 发布事件。事件不可变，仅追加写入。 */
  publish(envelope: MessageEnvelope): Promise<void>;

  /** 订阅特定消息类型 */
  subscribe(messageType: MessageType, handler: MessageHandler): void;

  /** 取消订阅 */
  unsubscribe(messageType: MessageType, handler: MessageHandler): void;

  /** 按 correlationId 查询因果链，返回从根到叶的事件列表 */
  getCausationChain(correlationId: string): Promise<MessageEnvelope[]>;
}
