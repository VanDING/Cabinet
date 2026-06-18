import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';
import { DEFAULT_CAPTAIN_ID } from '@cabinet/types';
import { DecisionAnalysisService } from '../services/decision-analysis.js';

export const decisionsRouter = new Hono();

decisionsRouter.get('/', (c) => {
  const { decisionRepo } = getServerContext();
  const status = c.req.query('status') ?? 'pending';
  const projectId = c.req.query('projectId') || undefined;

  try {
    const decisions =
      status === 'all'
        ? projectId
          ? decisionRepo.listByProject(projectId)
          : decisionRepo.listAll()
        : projectId
          ? decisionRepo.listPending(projectId)
          : decisionRepo.listAllPending();
    return c.json({ decisions, status, total: decisions.length });
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('Failed to list decisions', { error: (err as Error).message, status, projectId });
    return c.json({ decisions: [], status, total: 0, error: 'Failed to load decisions' });
  }
});

decisionsRouter.get('/:id', async (c) => {
  const { decisionService } = getServerContext();
  const decision = decisionService.getById(c.req.param('id'));
  if (!decision) return c.json({ error: 'Decision not found' }, 404);

  // Trigger background analysis if missing (non-blocking)
  const analysisService = new DecisionAnalysisService(getServerContext());
  analysisService.ensureAnalysis(decision.id).catch((err) => {
    console.warn('Operation failed', err);
  });

  return c.json({ decision });
});

const createSchema = z.object({
  projectId: z.string(),
  type: z.enum(['strategic', 'action', 'execution', 'anomaly', 'evolution']),
  title: z.string(),
  description: z.string().optional(),
  options: z.array(z.object({ id: z.string(), label: z.string(), impact: z.string() })).optional(),
  classification: z
    .object({
      scopeDescription: z.string().optional(),
      estimatedCost: z.number().optional(),
      permissionLevel: z.string().optional(),
      optionCount: z.number().optional(),
    })
    .optional(),
  captainId: z.string().optional(),
});

decisionsRouter.post('/', async (c) => {
  const { decisionService, logger } = getServerContext();
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const input = {
    id: `dec_${Date.now()}`,
    projectId: parsed.data.projectId,
    type: parsed.data.type,
    title: parsed.data.title,
    description: parsed.data.description ?? '',
    options: parsed.data.options ?? [
      { id: 'approve', label: 'Approve', impact: 'Proceed' },
      { id: 'reject', label: 'Reject', impact: 'Decline' },
    ],
    classification: {
      scopeDescription: parsed.data.classification?.scopeDescription ?? parsed.data.title,
      estimatedCost: parsed.data.classification?.estimatedCost ?? 0,
      optionCount: parsed.data.options?.length ?? 2,
      isCrossSession: false,
      involvesFunds: false,
      involvesPermissions: false,
      involvesDataDeletion: false,
      involvesOrgConfig: false,
    },
    captainId: parsed.data.captainId,
  };

  try {
    const decision = decisionService.create(input);
    broadcast('decision_created', {
      decisionId: decision.id,
      title: decision.title,
      level: decision.level,
    });
    // Audit log
    try {
      getServerContext().auditLogRepo.insert(
        'decision',
        decision.id,
        'create',
        input.captainId ?? DEFAULT_CAPTAIN_ID,
        { title: decision.title, level: decision.level },
      );
    } catch (err) {
      logger?.error('Audit log insert failed', {
        decisionId: decision.id,
        error: (err as Error).message,
      });
    }
    return c.json({ decision }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

decisionsRouter.post('/:id/approve', async (c) => {
  const { decisionService, logger } = getServerContext();
  const body = await c.req.json();
  try {
    const decision = decisionService.approve(
      c.req.param('id'),
      body.captainId ?? DEFAULT_CAPTAIN_ID,
      body.chosenOptionId ?? 'approve',
    );
    broadcast('decision_updated', { decisionId: decision.id, status: 'approved' });
    try {
      getServerContext().auditLogRepo.insert(
        'decision',
        decision.id,
        'approve',
        body.captainId ?? DEFAULT_CAPTAIN_ID,
        { chosenOptionId: decision.chosenOptionId },
      );
    } catch (err) {
      logger?.error('Audit log insert failed', {
        decisionId: decision.id,
        error: (err as Error).message,
      });
    }
    return c.json({ status: decision.status, chosenOptionId: decision.chosenOptionId, decision });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith('Decision not found')) return c.json({ error: msg }, 404);
    return c.json({ error: msg }, 500);
  }
});

decisionsRouter.post('/:id/reject', async (c) => {
  const { decisionService, logger } = getServerContext();
  let body: Record<string, string> = {};
  try {
    body = await c.req.json();
  } catch {
    /* body is optional */
  }
  try {
    const decision = decisionService.reject(
      c.req.param('id'),
      body.captainId ?? DEFAULT_CAPTAIN_ID,
    );
    broadcast('decision_updated', { decisionId: decision.id, status: 'rejected' });
    try {
      getServerContext().auditLogRepo.insert(
        'decision',
        decision.id,
        'reject',
        body.captainId ?? DEFAULT_CAPTAIN_ID,
        {},
      );
    } catch (err) {
      logger?.error('Audit log insert failed', {
        decisionId: decision.id,
        error: (err as Error).message,
      });
    }
    return c.json({ status: decision.status, decision });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith('Decision not found')) return c.json({ error: msg }, 404);
    return c.json({ error: msg }, 500);
  }
});

// GET /api/decisions/:id/audit — audit trail for a decision
decisionsRouter.get('/:id/audit', (c) => {
  const { auditLogRepo, decisionRepo } = getServerContext();
  const id = c.req.param('id');
  const rows = auditLogRepo.findByEntity('decision', id);
  const trail = rows.reverse().map((r) => ({
    action: r.action,
    actor: r.actor,
    changes: JSON.parse(r.changes ?? '{}'),
    timestamp: r.timestamp,
  }));
  // Also include the decision's own created/resolved timestamps
  const decision = decisionRepo.get(id);
  return c.json({
    decisionId: id,
    trail,
    decision: decision
      ? {
          createdAt: decision.createdAt.toISOString(),
          resolvedAt: decision.resolvedAt?.toISOString() ?? null,
          status: decision.status,
        }
      : null,
  });
});

// ── Decision Comments (M4 discussion threads) ──────────────────

// GET /api/decisions/:id/comments — list threaded comments
decisionsRouter.get('/:id/comments', (c) => {
  const { decisionCommentRepo } = getServerContext();
  const decisionId = c.req.param('id');
  try {
    const threaded = decisionCommentRepo.getThreadedComments(decisionId);
    return c.json({ comments: threaded, total: threaded.length });
  } catch (err) {
    return c.json({ error: 'Failed to load comments' }, 500);
  }
});

// POST /api/decisions/:id/comments — add a comment
const commentSchema = z.object({
  content: z.string().min(1),
  authorId: z.string().optional(),
  authorName: z.string().optional(),
  parentCommentId: z.string().optional(),
});

decisionsRouter.post('/:id/comments', async (c) => {
  const { decisionCommentRepo } = getServerContext();
  const decisionId = c.req.param('id');
  const body = await c.req.json();
  const parsed = commentSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  try {
    const id = decisionCommentRepo.addComment({
      decisionId,
      content: parsed.data.content,
      authorId: parsed.data.authorId,
      authorName: parsed.data.authorName,
      parentCommentId: parsed.data.parentCommentId,
    });
    broadcast('decision_comment_added', { decisionId, commentId: id });
    return c.json({ id, decisionId, createdAt: new Date().toISOString() }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to add comment' }, 500);
  }
});

// DELETE /api/decisions/:id/comments/:commentId — delete a comment
decisionsRouter.delete('/:id/comments/:commentId', (c) => {
  const { decisionCommentRepo } = getServerContext();
  const commentId = c.req.param('commentId');
  try {
    const deleted = decisionCommentRepo.deleteComment(commentId);
    if (!deleted) return c.json({ error: 'Comment not found' }, 404);
    broadcast('decision_comment_deleted', { commentId });
    return c.json({ deleted: true });
  } catch (err) {
    return c.json({ error: 'Failed to delete comment' }, 500);
  }
});
