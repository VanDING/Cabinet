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

// ── Analysis perspectives for meetings ──
// MeetingChair selects from these to construct the analysis Brief.
// A single Advisor agent applies the selected perspectives in one LLM call.
// Captain is intentionally NOT here — Captain is the human user.
export const ANALYSIS_PERSPECTIVES = [
  {
    id: 'financial',
    name: '财务视角',
    framework: '分析成本结构、ROI、预算影响、定价策略、现金流',
    evaluation_criteria: ['成本效益比', '投资回报周期', '现金流影响'],
  },
  {
    id: 'market',
    name: '市场视角',
    framework: '分析竞争格局、市场规模、用户需求、趋势变化',
    evaluation_criteria: ['市场增速', '竞争壁垒', '用户获取成本'],
  },
  {
    id: 'legal',
    name: '合规视角',
    framework: '分析法律风险、合规要求、知识产权、数据隐私',
    evaluation_criteria: ['合规风险等级', '法律前置条件', '潜在责任'],
  },
  {
    id: 'technical',
    name: '技术视角',
    framework: '分析技术可行性、架构影响、技术债、扩展性',
    evaluation_criteria: ['实现复杂度', '维护成本', '技术风险'],
  },
];

// ── Budget defaults (mirrors @cabinet/types boundaries) ──
export { DAILY_BUDGET_USD, WEEKLY_BUDGET_USD, MONTHLY_BUDGET_USD } from '@cabinet/types';
