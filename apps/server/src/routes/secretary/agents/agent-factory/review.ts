import type { ServerContext } from '../../../../context.js';
import { EvaluationResultRepository } from '@cabinet/storage';

/** Persist review result to evaluation_results table. */
export function persistReviewResult(
  ctx: ServerContext,
  sourceType: string,
  sourceId: string,
  review: { pass: boolean; score: number; issues: any[] },
): void {
  try {
    new EvaluationResultRepository(ctx.db).insert({
      project_id: null,
      session_id: null,
      source_type: sourceType,
      source_id: sourceId,
      overall_score: review.score ?? 0,
      dimensions: JSON.stringify({ pass: review.pass, issues: review.issues ?? [] }),
      feedback: null,
      evaluator_model: 'claude-haiku-4-5',
    });
  } catch {
    /* persistence failure is non-fatal */
  }
}
