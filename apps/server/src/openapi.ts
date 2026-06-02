import { Hono } from 'hono';

export function openapiRouter() {
  const app = new Hono();

  app.get('/openapi.json', (c) => {
    return c.json({
      openapi: '3.0.0',
      info: {
        title: 'Cabinet API',
        version: '2.0.0',
        description: 'AI Collaboration Framework for super individuals and one-person companies.',
      },
      servers: [{ url: 'http://localhost:3000', description: 'Local dev server' }],
      paths: {
        '/health': {
          get: { summary: 'Health check', responses: { '200': { description: 'OK' } } },
        },
        '/api/dashboard/summary': {
          get: {
            summary: 'Dashboard stats',
            responses: { '200': { description: 'Stats object' } },
          },
        },
        '/api/secretary/chat': {
          post: {
            summary: 'Send message to secretary',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { sessionId: { type: 'string' }, message: { type: 'string' } },
                  },
                },
              },
            },
            responses: { '200': { description: 'Response with parsed intent' } },
          },
        },
        '/api/decisions': {
          get: {
            summary: 'List decisions',
            parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }],
            responses: { '200': { description: 'Decision list' } },
          },
        },
        '/api/decisions/{id}': {
          get: {
            summary: 'Decision detail',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Decision object' } },
          },
          post: { summary: 'Approve decision (at /approve)' },
        },
        '/api/meetings': {
          post: {
            summary: 'Create meeting',
            responses: { '200': { description: 'Meeting with cost estimate' } },
          },
        },
        '/api/factory/workflows': {
          get: { summary: 'List workflows' },
          post: { summary: 'Create workflow' },
        },
        '/api/settings/budget': { get: { summary: 'Get budget config' } },
        '/api/settings/api-keys': {
          get: { summary: 'List API keys (masked)' },
          post: { summary: 'Add API key' },
        },
        '/api/events/stream': {
          get: {
            summary: 'SSE event stream',
            responses: { '200': { description: 'text/event-stream' } },
          },
        },
        '/api/skills': {
          get: { summary: 'List skills' },
          post: { summary: 'Register skill' },
        },
      },
    });
  });

  // Simple Swagger UI HTML page
  app.get('/docs', (c) => {
    const html = `<!DOCTYPE html>
<html><head><title>Cabinet API Docs</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head><body><div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui' });
</script></body></html>`;
    return c.html(html);
  });

  return app;
}
