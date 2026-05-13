export interface ProjectContext {
  projectId: string;
  goals: string[];
  milestones: { title: string; status: 'pending' | 'done'; date?: Date }[];
  keyDecisions: { title: string; outcome: string; date: Date }[];
  summary: string;
  updatedAt: Date;
}

export class ProjectMemory {
  private projects = new Map<string, ProjectContext>();

  initialize(projectId: string, goals: string[]): ProjectContext {
    const ctx: ProjectContext = {
      projectId,
      goals,
      milestones: [],
      keyDecisions: [],
      summary: `Project initialized with ${goals.length} goals.`,
      updatedAt: new Date(),
    };
    this.projects.set(projectId, ctx);
    return ctx;
  }

  get(projectId: string): ProjectContext | null {
    return this.projects.get(projectId) ?? null;
  }

  addMilestone(projectId: string, title: string): void {
    const ctx = this.projects.get(projectId);
    if (ctx) {
      ctx.milestones.push({ title, status: 'pending' });
      ctx.updatedAt = new Date();
    }
  }

  addDecision(projectId: string, title: string, outcome: string): void {
    const ctx = this.projects.get(projectId);
    if (ctx) {
      ctx.keyDecisions.push({ title, outcome, date: new Date() });
      ctx.updatedAt = new Date();
    }
  }

  updateSummary(projectId: string, summary: string): void {
    const ctx = this.projects.get(projectId);
    if (ctx) {
      ctx.summary = summary;
      ctx.updatedAt = new Date();
    }
  }
}
