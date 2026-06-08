//
// DispatchGraph — unified graph-based dispatcher for single/pipeline/parallel.
//
// Replaces runPipeline() / runParallel() / runSingle() with a compiled
// execution graph. AgentNode wraps runAgentStep(); SynthesizeNode wraps
// ResultSynthesizer.
//

import type { PipelineStep, AgentOutput, PipelineContext } from '@cabinet/types';
import type { AgentRoleType } from './agent-roles.js';

export type AgentStepFn = (
  role: AgentRoleType,
  input: string,
) => Promise<PipelineStep & { structuredOutput?: AgentOutput }>;

export type SynthesizeFn = (outputs: AgentOutput[]) => AgentOutput;

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
  execute: () => Promise<PipelineStep & { structuredOutput?: AgentOutput }>;
  next?: string;
  fork?: string[];
  join?: boolean;
}

/**
 * Compile a dispatch graph from options.
 *
 *   single:   [AgentNode(role)] → END
 *   pipeline: [AgentNode(r1)] → [AgentNode(r2)] → ... → END
 *   parallel: fork([AgentNode(r1), AgentNode(r2), ...]) → SynthesizeNode → END
 */
export function compileDispatchGraph(options: DispatchGraphOptions): GraphNode[] {
  const nodes: GraphNode[] = [];

  switch (options.mode) {
    case 'single': {
      const role = (options.roles[0] ?? 'secretary') as AgentRoleType;
      nodes.push({
        id: 'single',
        execute: () => options.agentStep(role, options.request),
      });
      break;
    }

    case 'pipeline': {
      const roles = (options.roles.length > 0 ? options.roles : ['secretary']) as AgentRoleType[];
      let prevId: string | undefined;

      for (let i = 0; i < roles.length; i++) {
        const id = `pipeline_${i}`;
        const role = roles[i]!;
        nodes.push({
          id,
          execute: () => options.agentStep(role, ''), // input assembled at runtime
          next: i < roles.length - 1 ? `pipeline_${i + 1}` : undefined,
        });
        if (prevId) {
          const prevNode = nodes.find((n) => n.id === prevId);
          if (prevNode) prevNode.next = id;
        }
        prevId = id;
      }
      break;
    }

    case 'parallel': {
      const roles = (options.roles.length > 0 ? options.roles : ['secretary']) as AgentRoleType[];
      const forkIds = roles.map((_, i) => `parallel_${i}`);

      for (let i = 0; i < roles.length; i++) {
        const role = roles[i]!;
        nodes.push({
          id: forkIds[i]!,
          execute: () => options.agentStep(role, options.request),
        });
      }

      // Add a synthetic join node for synthesis
      nodes.push({
        id: 'synthesize',
        execute: async () => {
          throw new Error('Synthesize node should not be executed directly');
        },
        join: true,
      });
      break;
    }
  }

  return nodes;
}

/**
 * Execute a compiled dispatch graph.
 */
export async function executeDispatchGraph(
  options: DispatchGraphOptions,
): Promise<DispatchGraphResult> {
  const startTime = Date.now();
  const { mode, request, agentStep, synthesize } = options;

  switch (mode) {
    case 'single': {
      const role = (options.roles[0] ?? 'secretary') as AgentRoleType;
      const step = await agentStep(role, request);
      return {
        mode,
        steps: [step],
        finalOutput: step.output ?? step.error ?? 'No output.',
        totalSteps: step.steps,
        totalDurationMs: Date.now() - startTime,
        structuredOutput: step.structuredOutput,
      };
    }

    case 'pipeline': {
      const steps: PipelineStep[] = [];
      let totalSteps = 0;
      const roles = options.roles.length > 0 ? options.roles : ['secretary'];

      const pipelineContext: PipelineContext = {
        originalRequest: request,
        steps: [],
      };

      for (const role of roles as AgentRoleType[]) {
        const input = serializePipelineContext(pipelineContext);
        const step = await agentStep(role, input);
        steps.push(step);
        totalSteps += step.steps;

        if (step.status === 'failed') {
          return {
            mode,
            steps,
            finalOutput: `${role} failed: ${step.error}`,
            totalSteps,
            totalDurationMs: Date.now() - startTime,
          };
        }

        pipelineContext.steps.push({
          role,
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

    case 'parallel': {
      const roles = (options.roles.length > 0 ? options.roles : ['secretary']) as AgentRoleType[];
      const maxConcurrency = options.maxConcurrency ?? 3;

      const steps: PipelineStep[] = [];
      for (let i = 0; i < roles.length; i += maxConcurrency) {
        const batch = roles.slice(i, i + maxConcurrency);
        const batchSteps = await Promise.all(batch.map((role) => agentStep(role, request)));
        steps.push(...batchSteps);
      }

      const totalSteps = steps.reduce((sum, s) => sum + s.steps, 0);
      const structuredOutputs = steps
        .map((s) => s.structuredOutput)
        .filter(Boolean) as AgentOutput[];

      let finalOutput: string;
      let synthesized: AgentOutput | undefined;
      if (structuredOutputs.length > 0 && synthesize) {
        synthesized = synthesize(structuredOutputs);
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

    default:
      throw new Error(`Unknown dispatch mode: ${mode}`);
  }
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
