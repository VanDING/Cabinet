// ── Meeting protocol types ──

export interface PerspectiveDef {
  id: string;
  name: string;
  focus: string;
}

export interface AnalysisBrief {
  selected_perspectives: PerspectiveDef[];
  topic_refined: string;
  key_questions: string[];
}

export interface AdvisorFinding {
  perspective: string;
  claim: string;
  evidence: string;
  confidence: number;
}

export interface AdvisorResult {
  findings: AdvisorFinding[];
  synthesis: string;
  risks: string[];
  open_questions: string[];
}

export interface ReviewIssue {
  type: string;
  detail: string;
  severity: 'high' | 'medium' | 'low';
}

export interface ReviewResult {
  pass: boolean;
  score: number;
  issues: ReviewIssue[];
  suggestion?: { action: string; detail: string };
}

export interface ExtractionResult {
  hasDecision: boolean;
  title?: string;
  description?: string;
  options?: { label: string; impact: string }[];
  level?: string;
}

// ── Phase 1: Chair — perspective generation ──

export function buildChairPrompt(topic: string, userAdvisors?: string[]): string {
  const userSpecifiedLine =
    userAdvisors && userAdvisors.length > 0
      ? `\nThe user specifically requested these perspectives (include them all):\n${userAdvisors.map((a) => `- ${a}`).join('\n')}\n`
      : '';

  return [
    `You are the Meeting Chair. Your job is to coordinate analysis, not perform it.`,
    `Design the analytical perspectives needed for this topic.`,
    '',
    `Topic: "${topic}"`,
    userSpecifiedLine,
    `Your task:`,
    `1. Determine what analytical perspectives are needed for this specific topic. Use as many perspectives as the topic genuinely requires — simple topics may need only 2, complex cross-domain topics may need 5-6. Do NOT pad with unnecessary perspectives. Do NOT use generic categories — every topic needs its own tailored perspectives.`,
    ...(userAdvisors && userAdvisors.length > 0
      ? [
          `2. The user's specified perspectives (above) MUST all be included. Add additional complementary perspectives if there are meaningful coverage gaps.`,
        ]
      : [
          `2. Name each perspective with a short, descriptive label (e.g., "供应链韧性", "用户体验风险", "监管合规").`,
        ]),
    `3. For each perspective, specify a FOCUSED analysis angle — specific to THIS topic, not a generic template.`,
    `4. Include any project context that is relevant.`,
    '',
    `Output as JSON:`,
    `{`,
    `  "selected_perspectives": [`,
    `    {"id": "supply_chain", "name": "供应链韧性", "focus": "assess supplier concentration risk in Southeast Asia for this product"},`,
    `    ...`,
    `  ],`,
    `  "topic_refined": "refined topic statement",`,
    `  "key_questions": ["question the analysis must answer"]`,
    `}`,
  ].join('\n');
}

export function parseChairResponse(content: string, topic: string): AnalysisBrief {
  const fallback: AnalysisBrief = {
    selected_perspectives: [{ id: 'general', name: 'General Analysis', focus: topic }],
    topic_refined: topic,
    key_questions: [],
  };

  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]);
    return {
      selected_perspectives:
        (parsed.selected_perspectives as PerspectiveDef[]) ?? fallback.selected_perspectives,
      topic_refined: (parsed.topic_refined as string) ?? topic,
      key_questions: (parsed.key_questions as string[]) ?? [],
    };
  } catch {
    return fallback;
  }
}

// ── Phase 2: Advisor — multi-perspective analysis ──

export function buildAdvisorPrompt(brief: AnalysisBrief): string {
  const perspectiveInstructions = brief.selected_perspectives
    .map((p) => `- ${p.name}: FOCUS on "${p.focus}"`)
    .join('\n');

  return [
    `You are a specialized analyst. Analyze the following topic from MULTIPLE perspectives in a single response.`,
    '',
    `Topic: ${brief.topic_refined}`,
    `Key questions to answer: ${brief.key_questions.join('; ')}`,
    '',
    `You must analyze from these perspectives:`,
    perspectiveInstructions,
    '',
    `For each perspective, provide:`,
    `- claim: your analytical conclusion`,
    `- evidence: supporting data or reasoning`,
    `- confidence: 0.0 to 1.0`,
    '',
    `After all perspectives, provide:`,
    `- synthesis: 2-3 sentence overall conclusion`,
    `- risks: key risks identified`,
    `- open_questions: what remains uncertain`,
    '',
    `Output as JSON:`,
    `{`,
    `  "perspectives_applied": ["list"],`,
    `  "findings": [`,
    `    {"perspective": "name", "claim": "...", "evidence": "...", "confidence": 0.8}`,
    `  ],`,
    `  "synthesis": "...",`,
    `  "risks": ["..."],`,
    `  "open_questions": ["..."]`,
    `}`,
  ].join('\n');
}

export function parseAdvisorResponse(content: string): AdvisorResult {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return { findings: [], synthesis: content, risks: [], open_questions: [] };
    const parsed = JSON.parse(match[0]);
    return {
      findings: (parsed.findings as AdvisorFinding[]) ?? [],
      synthesis: (parsed.synthesis as string) ?? content,
      risks: (parsed.risks as string[]) ?? [],
      open_questions: (parsed.open_questions as string[]) ?? [],
    };
  } catch {
    return { findings: [], synthesis: content, risks: [], open_questions: [] };
  }
}

// ── Phase 3: Reviewer — quality review ──

export function buildReviewerTask(
  topic: string,
  findings: AdvisorFinding[],
  synthesisText: string,
): string {
  const findingsSummary = findings
    .map(
      (f) =>
        `[${f.perspective}] claim: ${f.claim} | evidence: ${f.evidence} | confidence: ${f.confidence}`,
    )
    .join('\n');

  return [
    `## Meeting Analysis Review`,
    '',
    `Review the following analysis produced for a meeting on: "${topic}"`,
    '',
    `Analysis findings:`,
    findingsSummary || 'No structured findings',
    '',
    `Synthesis: ${synthesisText}`,
    '',
    `Review for: logical completeness, risk assessment adequacy, evidence quality, unstated assumptions, factual errors.`,
    `Use tools (search_memory, search_documents, read_file) to verify factual claims if possible.`,
    '',
    `After your review, output ONLY a JSON object:`,
    `{"pass": true/false, "score": 0.0-1.0, "issues": [...], "suggestion": {...}}`,
  ].join('\n');
}

export function parseReviewerResponse(content: string): ReviewResult {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return { pass: true, score: 1, issues: [] };
    const parsed = JSON.parse(match[0]);
    return {
      pass: parsed.pass === true,
      score: typeof parsed.score === 'number' ? parsed.score : 0.5,
      issues: (parsed.issues as ReviewIssue[]) ?? [],
      suggestion: parsed.suggestion as ReviewResult['suggestion'],
    };
  } catch {
    return { pass: true, score: 1, issues: [] };
  }
}

// ── Phase 4: Extraction — decision extraction ──

export function buildExtractionPrompt(
  topic: string,
  synthesis: string,
  findings: AdvisorFinding[],
): string {
  const summary = findings.map((f) => `[${f.perspective}]: ${f.claim}`).join('\n');

  return [
    `Analyze this meeting outcome and determine if it contains a decision the Captain should make.`,
    '',
    `Topic: ${topic}`,
    '',
    `Synthesis: ${synthesis}`,
    '',
    `Advisor views:`,
    summary,
    '',
    `Respond with ONLY a JSON object. If there IS an actionable decision, return:`,
    `{"hasDecision": true, "title": "short decision title", "description": "1-2 sentence summary", "options": [{"label": "Option A", "impact": "what happens if chosen"}], "level": "L1"}`,
    '',
    `If there is NO actionable decision (just information sharing, status updates, etc.), return:`,
    `{"hasDecision": false}`,
    '',
    `Only flag as a decision if there are genuinely different options the Captain needs to choose between.`,
  ].join('\n');
}

export function parseExtractionResponse(content: string): ExtractionResult {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return { hasDecision: false };
    const parsed = JSON.parse(match[0]);
    return {
      hasDecision: parsed.hasDecision === true,
      title: parsed.title as string | undefined,
      description: parsed.description as string | undefined,
      options: parsed.options as ExtractionResult['options'],
      level: parsed.level as string | undefined,
    };
  } catch {
    return { hasDecision: false };
  }
}
