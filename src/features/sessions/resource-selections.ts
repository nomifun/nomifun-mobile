/** Product resource identities published by the desktop's Agent launch UI. */
export interface AgentResourceSelection {
  resource_kind: string;
  resource_id: string;
}

// These are installation-owned selection IDs, not resource bindings or grants.
// Keep aligned with desktop ui/src/renderer/hooks/agent/agentResourceSelection.ts.
// The desktop resolves ownership, availability, operations and workspace paths.
const AUTOMATIC_RESOURCE_IDS = new Map<string, string>([
  ['workspace', 'default-workspace'],
  ['project_memory', 'default-project-memory'],
  ['process_session', 'managed-process-session'],
  ['terminal', 'managed-terminal'],
  ['asset_library', 'creative-studio-assets'],
  ['browser', 'managed-browser'],
  ['computer', 'local-desktop'],
  ['scheduler', 'installation-scheduler'],
]);

// The published product contract permits these enhancements to remain unbound.
// Mobile has no resource picker here and must never choose a user's resource.
const OPTIONAL_UNBOUND_KINDS = new Set([
  'knowledge_base', 'channel', 'robot', 'canvas', 'ssh_host',
]);

export interface ResourceSelectionResolution {
  selections: AgentResourceSelection[];
  missingKinds: string[];
}

/**
 * Convert the server template manifest into the narrow create request shape.
 * An absent/malformed manifest is distinct from a valid empty requirement list.
 * Unknown non-optional kinds remain missing instead of inventing permissions or
 * silently switching to a less capable Agent template.
 */
export function resolveRequiredResourceSelections(
  requiredKinds: unknown,
): ResourceSelectionResolution | null {
  if (
    !Array.isArray(requiredKinds) ||
    !requiredKinds.every((kind) => typeof kind === 'string' && /^[a-z][a-z0-9_]*$/.test(kind))
  ) return null;

  const selections: AgentResourceSelection[] = [];
  const missingKinds: string[] = [];
  for (const resourceKind of [...new Set<string>(requiredKinds)].sort()) {
    const resourceId = AUTOMATIC_RESOURCE_IDS.get(resourceKind);
    if (resourceId) selections.push({ resource_kind: resourceKind, resource_id: resourceId });
    else if (!OPTIONAL_UNBOUND_KINDS.has(resourceKind)) missingKinds.push(resourceKind);
  }
  return { selections, missingKinds };
}
