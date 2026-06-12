import type { ServerContext } from '../../../context.js';

export function buildEmployeeTools(ctx: ServerContext, activeProjectId?: string) {
  return {
    createEmployee(input: any) {
      const id = `emp_${Date.now()}`;
      const targetProjectId = activeProjectId ?? 'default';
      ctx.db
        .prepare(
          'INSERT INTO employees (id, project_id, name, role, kind, persona, permission_level) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, targetProjectId, input.name, input.role, input.kind, '{}', 'read');
      ctx.logger.info('Employee created via tool', { id, name: input.name });
    },
  };
}
