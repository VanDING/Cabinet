// API Key management — extracted from context.ts (Phase 1.2 split).

export let activeApiKeyId: string | null = null;

export function setActiveApiKeyId(id: string | null) {
  activeApiKeyId = id;
}

export function getActiveApiKeyId(): string | null {
  return activeApiKeyId;
}
