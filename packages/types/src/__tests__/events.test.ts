import { describe, it, expect } from 'vitest';
import { MessageType, type MessageEnvelope, type DecisionRequest } from '../events';

describe('MessageType', () => {
  it('has all 17 message types', () => {
    const types = Object.values(MessageType);
    expect(types).toHaveLength(17);
  });

  it('includes core message types', () => {
    expect(MessageType.DecisionRequest).toBe('decision_request');
    expect(MessageType.DecisionResolved).toBe('decision_resolved');
    expect(MessageType.TaskOrder).toBe('task_order');
    expect(MessageType.DeliberationProposal).toBe('deliberation_proposal');
    expect(MessageType.WorkflowStatusChanged).toBe('workflow_status_changed');
    expect(MessageType.SecretaryMessage).toBe('secretary_message');
    expect(MessageType.GreetingGenerated).toBe('greeting_generated');
    expect(MessageType.BudgetAlert).toBe('budget_alert');
    expect(MessageType.QualityAlert).toBe('quality_alert');
  });
});

describe('MessageEnvelope', () => {
  it('accepts valid message envelope', () => {
    const envelope: MessageEnvelope = {
      messageId: 'msg-1',
      correlationId: 'corr-1',
      causationId: 'cause-1',
      timestamp: new Date(),
      messageType: MessageType.DecisionRequest,
      payload: {
        decisionId: 'dec-1',
        title: 'Test decision',
        level: 'L2',
      } satisfies DecisionRequest,
    };
    expect(envelope.correlationId).toBe('corr-1');
    expect(envelope.messageType).toBe(MessageType.DecisionRequest);
  });

  it('causationId can be null for root events', () => {
    const envelope: MessageEnvelope = {
      messageId: 'msg-root',
      correlationId: 'corr-root',
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.SecretaryMessage,
      payload: { text: 'Hello' },
    };
    expect(envelope.causationId).toBeNull();
  });

  it('messageId is required', () => {
    const envelope: MessageEnvelope = {
      messageId: 'msg-2',
      correlationId: 'corr-2',
      causationId: 'msg-1',
      timestamp: new Date(),
      messageType: MessageType.TaskOrder,
      payload: { orderId: 'order-1', action: 'execute' },
    };
    expect(typeof envelope.messageId).toBe('string');
  });
});
