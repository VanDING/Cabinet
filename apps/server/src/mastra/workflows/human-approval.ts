import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { getServerContext } from '../../context.js';
import { broadcast } from '../../ws/handler.js';

export function createHumanApprovalStep(id: string) {
  return createStep({
    id,
    inputSchema: z.object({
      title: z.string(),
      description: z.string(),
      options: z.array(z.object({ id: z.string(), label: z.string() })),
      urgency: z.enum(['red', 'yellow', 'green']).default('yellow'),
    }),
    outputSchema: z.object({
      decisionId: z.string(),
      approved: z.boolean(),
      chosenOptionId: z.string().nullable(),
    }),
    execute: async ({ inputData, suspend }) => {
      const { decisionService, logger } = getServerContext();
      const decision = decisionService.create({
        id: `wf_dec_${Date.now()}`,
        projectId: 'workflow',
        type: 'action' as any,
        title: inputData.title,
        description: inputData.description,
        options: inputData.options.map((o: any) => ({ id: o.id, label: o.label, impact: '' })),
        classification: {
          scopeDescription: inputData.description,
          isCrossSession: false,
          optionCount: inputData.options.length,
          estimatedCost: 0,
          involvesFunds: false,
          involvesPermissions: inputData.urgency === 'red',
          involvesDataDeletion: false,
          involvesOrgConfig: false,
          fromExternalAgent: false,
          operationType: 'workflow_human_approval',
        } as any,
        captainId: undefined,
      } as any);

      broadcast('decision_created', {
        id: decision.id,
        title: decision.title,
        fromWorkflow: true,
      });

      logger.info('Workflow suspended for human approval', {
        stepId: id,
        decisionId: decision.id,
        title: inputData.title,
      });

      const result: any = await suspend({ decisionId: decision.id });

      const approved = result?.approved === true;
      const chosenOptionId = result?.chosenOptionId ?? null;

      if (approved) {
        decisionService.approve(decision.id, 'workflow', chosenOptionId ?? '');
      } else {
        decisionService.reject(decision.id, 'workflow');
      }

      return { decisionId: decision.id, approved, chosenOptionId };
    },
  });
}
