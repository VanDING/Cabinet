//
// DispatchGraph — unified graph-based dispatcher for single/pipeline/parallel.
//
// All three modes compile to a GraphNode[] and execute via a single
// graph-walking interpreter. No more switch-case per mode.
//

import type { PipelineStep, AgentOutput, PipelineContext } from '@cabinet/types';
import type { AgentRoleType } from './agent-roles.js';

export type AgentStepFn = (
  role: AgentRoleType,
  input: string,
) => Promise<PipelineStep & { structuredOutput?: AgentOutput }>;

export type SynthesizeFn = (outputs: AgentOutput[]) => {
  output: AgentOutput;
  conflicts?: Array<{ agentA: number; agentB: number; reason: string }>;
  superseded?: number[];
};

export interface DispatchGraphOptions {
  mode: 'single' | 'pipeline' | 'parallel';
  roles: AgentRoleType[];
  request: string;
  agentStep: AgentStepFn;
  synthesize?: SynthesizeFn;
  maxConcurrency?: number;
}

export interface DispatchGraphResult {
  mode: 'single' | 'pipeline' | 'parallel';
  steps: PipelineStep[];
  finalOutput: string;
  totalSteps: number;
  totalDurationMs: number;
  structuredOutput?: AgentOutput;
}

interface GraphNode {
  id: string;
  execute: (input: string) => Promise<PipelineStep & { structuredOutput?: AgentOutput }>;
  next?: string;
  isJoin?: boolean;
}

/**
 * Compile a dispatch graph from options.
 *
 *   single:   [AgentNode(role)] → END
 *   pipeline: [AgentNode(r1)] → [AgentNode(r2)] → ... → END
 *   parallel: [AgentNode(r1), AgentNode(r2), ...] → SynthesizeNode → END
 */
export function compileDispatchGraph(options: DispatchGraphOptions): GraphNode[] {
  const nodes: GraphNode[] = [];
  const roles = (options.roles.length > 0 ? options.roles : ['secretary']) as AgentRoleType[];

  switch (options.mode) {
    case 'single': {
      const role = roles[0]!;
      nodes.push({
        id: 'single',
        execute: (input) => options.agentStep(role, input),
      });
      break;
    }

    case 'pipeline': {
      for (let i = 0; i < roles.length; i++) {
        const id = `pipeline_${i}`;
        const role = roles[i]!;
        nodes.push({
          id,
          execute: (input) => options.agentStep(role, input),
          next: i < roles.length - 1 ? `pipeline_${i + 1}` : undefined,
        });
      }
      break;
    }

    case 'parallel': {
      for (let i = 0; i < roles.length; i++) {
        const role = roles[i]!;
        nodes.push({
          id: `parallel_${i}`,
          execute: (input) => options.agentStep(role, input),
        });
      }
      // Synthetic join node — not executed directly, marks where synthesis happens
      nodes.push({
        id: 'synthesize',
        execute: () => {
          throw new Error('Synthesize node should not be executed directly');
        },
        isJoin: true,
      });
      break;
    }
  }

  return nodes;
}

/**
 * Execute a compiled dispatch graph.
 *
 * Walks the compiled nodes in mode-specific order:
 *   single:   run the sole node
 *   pipeline: walk the next-chain, passing accumulated context
 *   parallel: run all non-join nodes concurrently (batched by maxConcurrency),
 *             then synthesize structured outputs if a synthesizer is provided.
 */
export async function executeDispatchGraph(
  options: DispatchGraphOptions,
): Promise<DispatchGraphResult> {
  const startTime = Date.now();
  const { mode, request, synthesize, maxConcurrency } = options;
  const nodes = compileDispatchGraph(options);

  if (mode === 'single') {
    const node = nodes[0]!;
    const step = await node.execute(request);
    return {
      mode,
      steps: [step],
      finalOutput: step.output ?? step.error ?? 'No output.',
      totalSteps: step.steps,
      totalDurationMs: Date.now() - startTime,
      structuredOutput: step.structuredOutput,
    };
  }

  if (mode === 'pipeline') {
    const steps: PipelineStep[] = [];
    let totalSteps = 0;
    const pipelineContext: PipelineContext = { originalRequest: request, steps: [] };

    for (const node of nodes) {
      const input = steps.length === 0 ? request : serializePipelineContext(pipelineContext);
      const step = await node.execute(input);
      steps.push(step);
      totalSteps += step.steps;

      if (step.status === 'failed') {
        return {
          mode,
          steps,
          finalOutput: `${step.role} failed: ${step.error}`,
          totalSteps,
          totalDurationMs: Date.now() - startTime,
        };
      }

      pipelineContext.steps.push({
        role: step.role,
        summary: step.structuredOutput?.summary ?? step.output?.slice(0, 500) ?? '',
        findings: step.structuredOutput?.findings ?? [],
        decisions: step.structuredOutput?.decisions ?? [],
      });
    }

    const final = steps[steps.length - 1];
    return {
      mode,
      steps,
      finalOutput: final?.output ?? 'No output produced.',
      totalSteps,
      totalDurationMs: Date.now() - startTime,
      structuredOutput: final?.structuredOutput,
    };
  }

  // parallel
  const agentNodes = nodes.filter((n) => !n.isJoin);
  const roles = agentNodes.map((_, i) => `parallel_${i}`);
  const concurrency = maxConcurrency ?? 3;

  const steps: PipelineStep[] = [];
  for (let i = 0; i < agentNodes.length; i += concurrency) {
    const batch = agentNodes.slice(i, i + concurrency);
    const batchSteps = await Promise.all(batch.map((n) => n.execute(request)));
    steps.push(...batchSteps);
  }

  const totalSteps = steps.reduce((sum, s) => sum + s.steps, 0);
  const structuredOutputs = steps.map((s) => s.structuredOutput).filter(Boolean) as AgentOutput[];

  let finalOutput: string;
  let synthesized: AgentOutput | undefined;
  if (structuredOutputs.length > 0 && synthesize) {
    const synthesis = synthesize(structuredOutputs);
    synthesized = synthesis.output;
    finalOutput = [
      ...steps.map((s) => `[${s.role}] ${s.output}`),
      '',
      '--- Synthesized ---',
      synthesized.summary,
      ...(synthesized.findings.length > 0
        ? ['\nFindings:', ...synthesized.findings.map((f) => `- [${f.type}] ${f.detail}`)]
        : []),
    ].join('\n');
  } else {
    finalOutput =
      steps
        .filter((s) => s.status === 'completed')
        .map((s) => `[${s.role}] ${s.output}`)
        .join('\n\n---\n\n') || 'No outputs produced.';
  }

  return {
    mode,
    steps,
    finalOutput,
    totalSteps,
    totalDurationMs: Date.now() - startTime,
    structuredOutput: synthesized,
  };
}

function serializePipelineContext(ctx: PipelineContext): string {
  const parts: string[] = [];
  parts.push(`Original request: ${ctx.originalRequest}`);
  if (ctx.steps.length > 0) {
    parts.push('\n## Previous steps');
    for (const step of ctx.steps) {
      parts.push(`\n### ${step.role}`);
      parts.push(`Summary: ${step.summary}`);
      if (step.findings.length > 0) {
        parts.push('Findings:');
        for (const f of step.findings) {
          parts.push(`- [${f.type}${f.severity ? `/${f.severity}` : ''}] ${f.detail}`);
        }
      }
      if (step.decisions.length > 0) {
        parts.push('Decisions:');
        for (const d of step.decisions) {
          parts.push(`- ${d.decision}`);
        }
      }
    }
  }
  return parts.join('\n');
}
