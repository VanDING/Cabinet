import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { toolServices } from './tool-context.js';

export const queryKnowledgeGraphTool = createTool({
  id: 'queryKnowledgeGraph',
  description: 'Search the knowledge graph for entities by name',
  inputSchema: z.object({ query: z.string(), limit: z.number().optional().default(10) }),
  execute: async ({ query, limit }) => {
    const kg = toolServices.knowledgeGraph;
    const entities = kg.searchEntities(query, limit);
    return { entities };
  },
});

export const addEntityTool = createTool({
  id: 'addKnowledgeEntity',
  description: 'Add an entity to the knowledge graph',
  inputSchema: z.object({
    name: z.string(),
    type: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  execute: async ({ name, type, metadata }) => {
    const entity = toolServices.knowledgeGraph.addEntity(name, type, metadata);
    return { entity };
  },
});

export const findEntityTool = createTool({
  id: 'findKnowledgeEntity',
  description: 'Find an entity by exact name and optional type',
  inputSchema: z.object({ name: z.string(), type: z.string().optional() }),
  execute: async ({ name, type }) => {
    const entity = toolServices.knowledgeGraph.findEntityByName(name, type);
    return { entity };
  },
});

export const linkEntitiesTool = createTool({
  id: 'linkKnowledgeEntities',
  description: 'Create a relationship between two entities',
  inputSchema: z.object({
    fromId: z.string(),
    toId: z.string(),
    relation: z.string(),
    strength: z.number().optional().default(1),
  }),
  execute: async ({ fromId, toId, relation, strength }) => {
    toolServices.knowledgeGraph.linkEntities(fromId, toId, relation, strength);
    return { success: true };
  },
});

export const detectContradictionsTool = createTool({
  id: 'detectContradictions',
  description: 'Detect contradictions in the knowledge graph for a statement',
  inputSchema: z.object({ content: z.string() }),
  execute: async ({ content }) => {
    const contradictions = toolServices.knowledgeGraph.detectContradictions(content);
    return { contradictions };
  },
});

export const findRelatedTool = createTool({
  id: 'findRelatedEntities',
  description: 'Find entities related to a given entity',
  inputSchema: z.object({ entityName: z.string(), depth: z.number().optional().default(2) }),
  execute: async ({ entityName, depth }) => {
    const entities = toolServices.knowledgeGraph.findRelated(entityName, depth);
    return { entities };
  },
});
