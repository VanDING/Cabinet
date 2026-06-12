import { getServerContext } from '../../../../context.js';

/** Resolve a role's modelTier to the actual model via user-configured modelMapping. */
export function resolveModel(role: { modelTier: string }): string {
  const ctx = getServerContext();
  const adapter = ctx.gateway as { resolveModelString?: (t: string) => string };
  if (adapter?.resolveModelString) {
    return adapter.resolveModelString(role.modelTier);
  }
  return role.modelTier;
}
