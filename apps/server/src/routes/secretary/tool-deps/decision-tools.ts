import type { ServerContext } from '../../../context.js';
import type { Decision } from '@cabinet/types';

export function buildDecisionTools(ctx: ServerContext) {
  return {
    decisionStore: ctx.decisionRepo,

    createDecision(input: any) {
      const id = `dec_${Date.now()}`;
      const decision = ctx.decisionService.create({
        id,
        projectId: input.projectId,
        type: input.type,
        title: input.title,
        description: input.description,
        options: input.options,
        classification: input.classification,
        captainId: input.captainId,
      }) as Decision;
      if (decision.status === 'approved' && decision.captainId === 'system') {
        ctx.logger.info('Decision auto-approved', {
          decisionId: decision.id,
          title: decision.title,
          level: decision.level,
        });
      }
      return decision;
    },
    approveDecision(decisionId: any, captainId: any, chosenOptionId?: any) {
      return ctx.decisionService.approve(decisionId, captainId, chosenOptionId);
    },
    rejectDecision(decisionId: string, captainId: string) {
      return ctx.decisionService.reject(decisionId, captainId);
    },
  };
}
