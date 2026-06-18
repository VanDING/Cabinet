/**
 * Shared read-only tool set — canonical source for both safety classification
 * and parallel-execution optimization. Single source of truth to prevent drift.
 *
 * When adding a new read-only tool, add it HERE (not in safety.ts or execute-generator.ts).
 */
export const READ_ONLY_TOOLS = new Set([
  // Decisions
  'query_decisions',
  'get_decision',
  // Status & events
  'get_status',
  'get_recent_events',
  // Project
  'get_project_context',
  'get_captain_preferences',
  'list_projects',
  // Memory
  'recall',
  'search_memory',
  // Workflow
  'list_workflows',
  'get_workflow',
  // Agent
  'list_agents',
  // Files
  'read_file',
  'list_directory',
  'glob',
  'grep',
  'file_info',
  'recent_files',
  'watch_file',
  // LSP
  'workspace_symbol',
  'go_to_definition',
  'find_references',
  'diagnostics',
  // Web
  'web_fetch',
  // Scheduled tasks
  'list_scheduled_tasks',
  // Knowledge
  'search_documents',
]);
