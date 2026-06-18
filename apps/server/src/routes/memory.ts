import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';

export const memoryRouter = new Hono();

// GET /api/memory — query across all memory layers
// Query params: layer (short_term|long_term|entity|project|all), query (search text), limit (default 20)
memoryRouter.get('/', async (c) => {
  const { shortTerm, longTerm, entity, project, logger } = getServerContext();
  const layer = c.req.query('layer') ?? 'all';
  const query = c.req.query('query') ?? '';
  const limit = parseInt(c.req.query('limit') ?? '20', 10);

  const entries: {
    id: string;
    layer: string;
    content: string;
    metadata: any;
    timestamp: string;
  }[] = [];

  if (layer === 'all' || layer === 'short_term') {
    for (const sessionId of getAllSessionIds(shortTerm)) {
      const data = shortTerm.getAll(sessionId);
      for (const [key, value] of Object.entries(data)) {
        const content = typeof value === 'string' ? value : JSON.stringify(value);
        if (!query || content.toLowerCase().includes(query.toLowerCase())) {
          entries.push({
            id: `st_${sessionId}_${key}`,
            layer: 'short_term',
            content,
            metadata: { sessionId, key },
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }

  if (layer === 'all' || layer === 'long_term') {
    try {
      const results = await longTerm.search(query || '*', limit);
      for (const r of results) {
        const meta = r.metadata ?? {};
        entries.push({
          id: r.id ?? `lt_${Date.now()}`,
          layer: 'long_term',
          content: r.content,
          metadata: meta,
          timestamp: r.timestamp?.toISOString?.() ?? new Date().toISOString(),
        });
      }
    } catch (err) {
      logger.warn('Long-term memory unavailable', { error: (err as Error).message });
    }
  }

  if (layer === 'all' || layer === 'entity') {
    const allPrefs = entity.getAllPreferences?.() ?? {};
    for (const [captainId, prefs] of Object.entries(allPrefs)) {
      const content = JSON.stringify(prefs);
      if (!query || content.toLowerCase().includes(query.toLowerCase())) {
        entries.push({
          id: `ent_${captainId}`,
          layer: 'entity',
          content,
          metadata: { captainId },
          timestamp: new Date().toISOString(),
        });
      }
    }
    const allEmployees = entity.getAllEmployees?.() ?? {};
    for (const [empId, emp] of Object.entries(allEmployees)) {
      const content = JSON.stringify(emp);
      if (!query || content.toLowerCase().includes(query.toLowerCase())) {
        entries.push({
          id: `emp_${empId}`,
          layer: 'entity',
          content,
          metadata: { employeeId: empId },
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  if (layer === 'all' || layer === 'project') {
    const allProjects = project.getAll?.() ?? {};
    for (const [projId, ctx] of Object.entries(allProjects)) {
      const content = JSON.stringify(ctx);
      if (!query || content.toLowerCase().includes(query.toLowerCase())) {
        entries.push({
          id: `proj_${projId}`,
          layer: 'project',
          content,
          metadata: { projectId: projId },
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // Sort by timestamp desc, cap at limit
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const sliced = entries.slice(0, limit);

  return c.json({
    entries: sliced,
    total: entries.length,
    layers: {
      short_term: entries.filter((e) => e.layer === 'short_term').length,
      long_term: entries.filter((e) => e.layer === 'long_term').length,
      entity: entries.filter((e) => e.layer === 'entity').length,
      project: entries.filter((e) => e.layer === 'project').length,
    },
  });
});

// DELETE /api/memory/:id — delete entry
memoryRouter.delete('/:id', async (c) => {
  const { longTerm, entity, project, logger } = getServerContext();
  const id = c.req.param('id');
  try {
    if (id.startsWith('ent_')) {
      const captainId = id.slice(4);
      entity.deletePreferences?.(captainId);
    } else if (id.startsWith('emp_')) {
      const empId = id.slice(4);
      entity.deleteEmployee?.(empId);
    } else if (id.startsWith('proj_')) {
      const projId = id.slice(5);
      project.delete?.(projId);
    } else {
      await longTerm.delete(id);
    }
    broadcast('memory_changed', { action: 'deleted', id });
    return c.json({ status: 'deleted' });
  } catch (err) {
    logger.warn('Failed to delete memory entry', { error: (err as Error).message, id });
    return c.json({ error: 'Delete failed' }, 500);
  }
});

// POST /api/memory/consolidate — manually trigger basic consolidation
memoryRouter.post('/consolidate', async (c) => {
  const { shortTerm, longTerm, logger } = getServerContext();
  let migrated = 0;
  try {
    for (const sessionId of getAllSessionIds(shortTerm)) {
      const data = shortTerm.getAll(sessionId);
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' && value.length > 50) {
          await longTerm.store({
            content: value,
            metadata: { key, sessionId, source: 'manual_consolidation' },
            timestamp: new Date(),
          });
          migrated++;
        }
      }
      shortTerm.clear(sessionId);
    }
    logger.info('Manual consolidation completed', { migrated });
    return c.json({ migrated, status: 'completed' });
  } catch (e: any) {
    return c.json({ error: e.message, migrated }, 500);
  }
});

// GET /api/memory/graph — return knowledge graph entities and relations
memoryRouter.get('/graph', (c) => {
  const { knowledgeGraph, logger } = getServerContext();
  try {
    const db = (knowledgeGraph as any).db;
    const entities = db
      .prepare('SELECT * FROM memory_entities ORDER BY frequency DESC LIMIT 200')
      .all() as any[];
    const relations = db.prepare('SELECT * FROM memory_relations LIMIT 500').all() as any[];
    return c.json({
      entities: entities.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        frequency: e.frequency,
      })),
      relations: relations.map((r) => ({
        id: r.id,
        from: r.from_entity_id,
        to: r.to_entity_id,
        relation: r.relation,
        strength: r.strength,
      })),
    });
  } catch (err) {
    logger.warn('Knowledge graph query failed', { error: (err as Error).message });
    return c.json({ entities: [], relations: [] });
  }
});

// GET /api/memory/graph/entity/:id — single entity detail
memoryRouter.get('/graph/entity/:id', (c) => {
  const { knowledgeGraph, logger } = getServerContext();
  const id = c.req.param('id');
  try {
    const db = (knowledgeGraph as any).db;
    const entity = db.prepare('SELECT * FROM memory_entities WHERE id = ?').get(id) as any;
    if (!entity) return c.json({ error: 'Entity not found' }, 404);
    return c.json({
      id: entity.id,
      name: entity.name,
      type: entity.type,
      frequency: entity.frequency,
      first_seen: entity.first_seen,
      last_seen: entity.last_seen,
      metadata: entity.metadata ? JSON.parse(entity.metadata) : {},
    });
  } catch (err) {
    logger.warn('Entity detail query failed', { error: (err as Error).message, id });
    return c.json({ error: 'Query failed' }, 500);
  }
});

// GET /api/memory/graph/entity/:id/relations — all relations for an entity
memoryRouter.get('/graph/entity/:id/relations', (c) => {
  const { knowledgeGraph, logger } = getServerContext();
  const id = c.req.param('id');
  try {
    const db = (knowledgeGraph as any).db;
    const relations = db
      .prepare(
        `SELECT r.id, r.from_entity_id, r.to_entity_id, r.relation, r.strength,
                e_from.name as fromName, e_from.type as fromType,
                e_to.name as toName, e_to.type as toType
         FROM memory_relations r
         LEFT JOIN memory_entities e_from ON r.from_entity_id = e_from.id
         LEFT JOIN memory_entities e_to ON r.to_entity_id = e_to.id
         WHERE r.from_entity_id = ? OR r.to_entity_id = ?`,
      )
      .all(id, id) as any[];
    return c.json({
      relations: relations.map((r) => ({
        id: r.id,
        from: r.from_entity_id,
        to: r.to_entity_id,
        relation: r.relation,
        strength: r.strength,
        otherEntityName: r.from_entity_id === id ? r.toName : r.fromName,
        otherEntityType: r.from_entity_id === id ? r.toType : r.fromType,
        direction: r.from_entity_id === id ? 'out' : 'in',
      })),
    });
  } catch (err) {
    logger.warn('Entity relations query failed', { error: (err as Error).message, id });
    return c.json({ relations: [] });
  }
});

// GET /api/memory/graph/search?q=... — search entities by name
memoryRouter.get('/graph/search', (c) => {
  const { knowledgeGraph, logger } = getServerContext();
  const q = c.req.query('q') ?? '';
  if (!q) return c.json({ entities: [] });
  try {
    const entities = knowledgeGraph.searchEntities(q, 20);
    return c.json({
      entities: entities.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        frequency: e.frequency,
      })),
    });
  } catch (err) {
    logger.warn('Entity search failed', { error: (err as Error).message, q });
    return c.json({ entities: [] });
  }
});

// GET /api/memory/stats — memory health statistics across layers
memoryRouter.get('/stats', (c) => {
  const { shortTerm, longTerm, entity, project, logger } = getServerContext();
  try {
    const shortTermCount = (shortTerm as any).size?.() ?? 0;
    const longTermCount = (longTerm as any).size?.() ?? 0;
    const entityCount = (entity as any).size?.() ?? 0;
    const decayResult = { lastRun: (memoryRouter as any)._lastDecayResult };

    return c.json({
      shortTerm: { count: shortTermCount },
      longTerm: { count: longTermCount },
      entity: { count: entityCount },
      decay: decayResult,
    });
  } catch (err) {
    logger.warn('Memory stats query failed', { error: (err as Error).message });
    return c.json({ error: 'Failed to retrieve memory stats' }, 500);
  }
});

// POST /api/memory/scope — change memory scope (project | global | workspace)
memoryRouter.post('/scope', async (c) => {
  const { longTerm, logger } = getServerContext();
  const body = await c.req.json<{ ids: string[]; scope: string }>().catch(() => null);
  if (!body || !Array.isArray(body.ids) || !body.scope) {
    return c.json({ error: 'Missing ids or scope' }, 400);
  }
  try {
    const { CrossProjectMigrator } = await import('@cabinet/memory');
    const migrator = new CrossProjectMigrator(longTerm);
    let updated = 0;
    if (body.scope === 'global') {
      updated = await migrator.markAsGlobal(body.ids);
    } else if (body.scope === 'workspace') {
      updated = await migrator.markAsWorkspace(body.ids);
    }
    logger.info('Memory scope updated', { count: updated, scope: body.scope });
    return c.json({ updated, scope: body.scope });
  } catch (err) {
    logger.warn('Failed to update memory scope', { error: (err as Error).message });
    return c.json({ error: 'Scope update failed' }, 500);
  }
});

// POST /api/memory/migrate — copy memories to a different project
memoryRouter.post('/migrate', async (c) => {
  const { longTerm, logger } = getServerContext();
  const body = await c.req.json<{ ids: string[]; targetProjectId: string }>().catch(() => null);
  if (!body || !Array.isArray(body.ids) || !body.targetProjectId) {
    return c.json({ error: 'Missing ids or targetProjectId' }, 400);
  }
  try {
    const { CrossProjectMigrator } = await import('@cabinet/memory');
    const migrator = new CrossProjectMigrator(longTerm);
    const migrated = await migrator.migrateToProject(body.ids, body.targetProjectId);
    logger.info('Memory migrated', { count: migrated, target: body.targetProjectId });
    return c.json({ migrated, targetProjectId: body.targetProjectId });
  } catch (err) {
    logger.warn('Failed to migrate memories', { error: (err as Error).message });
    return c.json({ error: 'Migration failed' }, 500);
  }
});

// GET /api/memory/global — search globally-scoped memories
memoryRouter.get('/global', async (c) => {
  const { longTerm, logger } = getServerContext();
  const query = c.req.query('query') ?? '';
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  try {
    const { CrossProjectMigrator } = await import('@cabinet/memory');
    const migrator = new CrossProjectMigrator(longTerm);
    const results = await migrator.findGlobalMemories(query, limit);
    return c.json({
      entries: results.map((r) => ({
        id: r.id,
        content: r.content,
        metadata: r.metadata,
        timestamp: r.timestamp.toISOString(),
      })),
      total: results.length,
    });
  } catch (err) {
    logger.warn('Global memory search failed', { error: (err as Error).message });
    return c.json({ entries: [], total: 0 });
  }
});

// GET /api/memory/patterns — detect cross-project memory patterns
memoryRouter.get('/patterns', async (c) => {
  const { longTerm, logger } = getServerContext();
  const minSimilarity = parseFloat(c.req.query('minSimilarity') ?? '0.4');
  try {
    const { CrossProjectMigrator } = await import('@cabinet/memory');
    const migrator = new CrossProjectMigrator(longTerm);
    const patterns = await migrator.findCrossProjectPatterns(minSimilarity);
    return c.json({ patterns });
  } catch (err) {
    logger.warn('Cross-project pattern detection failed', { error: (err as Error).message });
    return c.json({ patterns: [] });
  }
});

// Helper: get tracked session IDs from ShortTermMemory

function getAllSessionIds(shortTerm: any): string[] {
  try {
    if (typeof shortTerm.getSessionIds === 'function') return shortTerm.getSessionIds();
    if (shortTerm._store instanceof Map) return [...shortTerm._store.keys()];
  } catch {
    /* session IDs not available */
  }
  return ['default'];
}
