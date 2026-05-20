import { describe, it, expect } from 'vitest';
import type {
  Project,
  Employee,
  SkillDefinition,
  WorkflowDefinition,
} from '../primitives';
import {
  ProjectStatus,
  EmployeeKind,
  PermissionLevel,
  SkillKind,
  SkillStatus,
  MemoryLayer,
} from '../primitives';

describe('Project type', () => {
  it('accepts valid project object', () => {
    const project: Project = {
      id: 'proj-1',
      name: 'Product Launch',
      description: 'Launching the new product line',
      status: ProjectStatus.Active,
      createdAt: new Date(),
    };
    expect(project.status).toBe(ProjectStatus.Active);
  });

  it('ProjectStatus has all expected values', () => {
    expect(ProjectStatus.Active).toBe('active');
    expect(ProjectStatus.Archived).toBe('archived');
    expect(ProjectStatus.Draft).toBe('draft');
  });
});

describe('Employee type', () => {
  it('accepts AI pipeline employee', () => {
    const emp: Employee = {
      id: 'emp-1',
      projectId: 'proj-1',
      name: 'Financial Advisor',
      role: 'advisor',
      kind: EmployeeKind.AI,
      pipelineConfig: { model: 'claude-opus-4-7', systemPrompt: 'You are a financial advisor.' },
      persona: { name: 'Warren', tone: 'analytical', expertise: ['finance', 'investment'] },
      permissionLevel: PermissionLevel.Read,
    };
    expect(emp.kind).toBe('ai');
  });

  it('accepts human node employee', () => {
    const emp: Employee = {
      id: 'emp-2',
      projectId: 'proj-1',
      name: 'Captain',
      role: 'decision_maker',
      kind: EmployeeKind.Human,
      permissionLevel: PermissionLevel.Admin,
    };
    expect(emp.kind).toBe('human');
    expect(emp.pipelineConfig).toBeUndefined();
  });

  it('EmployeeKind has AI and Human values', () => {
    expect(EmployeeKind.AI).toBe('ai');
    expect(EmployeeKind.Human).toBe('human');
  });

  it('PermissionLevel has correct hierarchy', () => {
    const levels = [PermissionLevel.Read, PermissionLevel.Write, PermissionLevel.Admin];
    expect(levels).toHaveLength(3);
  });
});

describe('SkillDefinition type', () => {
  it('accepts valid skill definition', () => {
    const skill: SkillDefinition = {
      id: 'skill-1',
      name: 'Market Analysis',
      description: 'Analyzes market conditions for a given sector',
      kind: SkillKind.Tool,
      inputSchema: { type: 'object', properties: { sector: { type: 'string' } } },
      outputSchema: { type: 'object', properties: { report: { type: 'string' } } },
      promptTemplate: 'Analyze the market for {{sector}}.',
      version: 1,
      status: SkillStatus.Active,
    };
    expect(skill.version).toBe(1);
  });

  it('SkillStatus has draft and active values', () => {
    expect(SkillStatus.Draft).toBe('draft');
    expect(SkillStatus.Active).toBe('active');
    expect(SkillStatus.Deprecated).toBe('deprecated');
  });
});

describe('WorkflowDefinition type', () => {
  it('accepts valid declarative workflow definition', () => {
    const wf: WorkflowDefinition = {
      name: 'Market Entry Analysis',
      description: 'Analyze market entry feasibility and generate a decision recommendation',
      steps: [
        {
          id: 'data_collection',
          title: 'Data Collection',
          description: 'Collect market data from internal CRM and external sources',
          type: 'aiAgent',
          agent: 'market_analyst',
          input: { from: 'trigger' },
          prompt: 'Collect and validate market data from {{dataSource}}',
          constraints: { maxTokens: 3000, temperature: 0.3 },
        },
        {
          id: 'quality_check',
          title: 'Quality Check',
          description: 'Check if data quality meets threshold',
          type: 'condition',
          condition: { expression: '{{steps.data_collection.output.confidence}} > 0.7', trueBranch: 'report_gen', falseBranch: 'human_review' },
        },
        {
          id: 'human_review',
          title: 'Human Review',
          description: 'Captain reviews low-confidence analysis',
          type: 'humanApproval',
          approvalOptions: {
            actions: ['continue', 'retry', 'halt'],
            retryTarget: 'data_collection',
          },
        },
        {
          id: 'report_gen',
          title: 'Report Generation',
          description: 'Generate final report',
          type: 'aiAgent',
          agent: 'report_writer',
          input: { from: 'data_collection' },
          prompt: 'Generate structured report from analysis results',
        },
      ],
    };
    expect(wf.steps).toHaveLength(4);
    expect(wf.steps[0]!.agent).toBe('market_analyst');
    expect(wf.steps[2]!.type).toBe('humanApproval');
    expect(wf.steps[2]!.approvalOptions?.actions).toContain('retry');
  });
});

describe('MemoryLayer type', () => {
  it('has all four layers', () => {
    expect(MemoryLayer.ShortTerm).toBe('short_term');
    expect(MemoryLayer.LongTerm).toBe('long_term');
    expect(MemoryLayer.Entity).toBe('entity');
    expect(MemoryLayer.Project).toBe('project');
  });
});
