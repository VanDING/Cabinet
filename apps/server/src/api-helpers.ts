import type { Context } from 'hono';

// ── Unified API error response ──
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function err(
  c: Context,
  status: 400 | 401 | 403 | 404 | 429 | 500,
  code: string,
  message: string,
  details?: unknown,
) {
  const body: ApiError = { error: { code, message } };
  if (details !== undefined) (body.error as Record<string, unknown>).details = details;
  return c.json(body, status as unknown as 200);
}

// Fix the overload: hono c.json returns a typed Response
export function errResponse(
  status: 400 | 401 | 403 | 404 | 429 | 500,
  code: string,
  message: string,
  details?: unknown,
) {
  const body: ApiError = { error: { code, message } };
  if (details !== undefined) (body.error as Record<string, unknown>).details = details;
  return Response.json(body, { status });
}

// ── Budget defaults (mirrors @cabinet/types boundaries) ──
export { DAILY_BUDGET, WEEKLY_BUDGET, MONTHLY_BUDGET } from '@cabinet/types';
