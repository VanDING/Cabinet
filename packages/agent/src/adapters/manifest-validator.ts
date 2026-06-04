//
// Manifest Validator — validates agent.json against the standard schema.
//
// Uses the JSON Schema defined in agent-manifest.schema.json.
// Falls back to structural validation if JSON Schema validator is not available.
//

import type { AgentCapability } from './types.js';

// ── Types ────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface ValidatedManifest {
  agent_id: string;
  display_name: string;
  version: string;
  description?: string;
  protocol: 'a2a' | 'cli';
  configSource: 'cabinet_managed' | 'agent_native';
  capabilities: AgentCapability[];
  connection: {
    // A2A
    base_url?: string;
    health_check_url?: string;
    auth?: { type: 'api_key' | 'oauth'; header?: string; env_var?: string };
    // CLI
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    permission_mode?: string;
    detect_command?: string;
    install_command?: string;
    // Shared
    timeout_ms?: number;
    max_retries?: number;
  };
}

// ── Structural Validation (no external dependencies) ─────────────

export function validateManifest(data: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['Manifest must be a JSON object'], warnings: [] };
  }

  const m = data as Record<string, unknown>;

  // Required fields
  if (typeof m.agent_id !== 'string' || !m.agent_id) {
    errors.push('agent_id is required and must be a non-empty string');
  } else if (!/^[a-z0-9_-]+$/.test(m.agent_id)) {
    errors.push('agent_id must match pattern: ^[a-z0-9_-]+$');
  }

  if (typeof m.display_name !== 'string' || !m.display_name) {
    errors.push('display_name is required and must be a non-empty string');
  }

  if (typeof m.version !== 'string' || !m.version) {
    errors.push('version is required');
  }

  // Protocol
  if (m.protocol !== 'a2a' && m.protocol !== 'cli') {
    errors.push('protocol must be "a2a" or "cli"');
  }

  // Config source
  if (m.configSource !== undefined && m.configSource !== 'cabinet_managed' && m.configSource !== 'agent_native') {
    errors.push('configSource must be "cabinet_managed" or "agent_native"');
  }

  // Capabilities
  if (m.capabilities !== undefined) {
    if (!Array.isArray(m.capabilities)) {
      errors.push('capabilities must be an array');
    } else {
      for (let i = 0; i < m.capabilities.length; i++) {
        const cap = m.capabilities[i] as Record<string, unknown>;
        if (typeof cap.name !== 'string' || !cap.name) {
          errors.push(`capabilities[${i}].name is required`);
        }
        if (typeof cap.description !== 'string' || !cap.description) {
          errors.push(`capabilities[${i}].description is required`);
        }
      }
    }
  } else {
    warnings.push('No capabilities declared — agent will only be routable by name');
  }

  // Connection — protocol-specific validation
  const conn = m.connection as Record<string, unknown> | undefined;
  if (m.protocol === 'a2a') {
    if (!conn?.base_url || typeof conn.base_url !== 'string') {
      errors.push('connection.base_url is required for A2A agents');
    }
  } else if (m.protocol === 'cli') {
    if (!conn?.command || typeof conn.command !== 'string') {
      errors.push('connection.command is required for CLI agents');
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  return { ok: true, errors: [], warnings };
}

/** Parse and validate, returning a typed manifest if valid. */
export function parseManifest(data: unknown): { manifest?: ValidatedManifest; result: ValidationResult } {
  const result = validateManifest(data);
  if (!result.ok) return { result };

  const m = data as Record<string, unknown>;
  const conn = (m.connection ?? {}) as Record<string, unknown>;

  const manifest: ValidatedManifest = {
    agent_id: m.agent_id as string,
    display_name: m.display_name as string,
    version: m.version as string,
    description: m.description as string | undefined,
    protocol: m.protocol as 'a2a' | 'cli',
    configSource: (m.configSource as 'cabinet_managed' | 'agent_native') ?? 'agent_native',
    capabilities: (m.capabilities ?? []) as AgentCapability[],
    connection: {
      base_url: conn.base_url as string | undefined,
      health_check_url: conn.health_check_url as string | undefined,
      auth: conn.auth as any,
      command: conn.command as string | undefined,
      args: conn.args as string[] | undefined,
      env: conn.env as Record<string, string> | undefined,
      permission_mode: conn.permission_mode as string | undefined,
      detect_command: conn.detect_command as string | undefined,
      install_command: conn.install_command as string | undefined,
      timeout_ms: conn.timeout_ms as number | undefined,
      max_retries: conn.max_retries as number | undefined,
    },
  };

  return { manifest, result };
}
