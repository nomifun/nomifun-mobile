import { describe, expect, it } from 'bun:test';

import { resolveRequiredResourceSelections } from '@/features/sessions/resource-selections';

describe('official Agent resource selection wire contract', () => {
  it('admits every assistant.general resource before the desktop freezes a project workspace', () => {
    expect(resolveRequiredResourceSelections([
      'computer', 'process_session', 'project_memory', 'scheduler', 'workspace',
    ])).toEqual({
      selections: [
        { resource_kind: 'computer', resource_id: 'local-desktop' },
        { resource_kind: 'process_session', resource_id: 'managed-process-session' },
        { resource_kind: 'project_memory', resource_id: 'default-project-memory' },
        { resource_kind: 'scheduler', resource_id: 'installation-scheduler' },
        { resource_kind: 'workspace', resource_id: 'default-workspace' },
      ],
      missingKinds: [],
    });
  });

  it('does not inject unused resources into chat.minimal or a narrower template', () => {
    expect(resolveRequiredResourceSelections([])).toEqual({ selections: [], missingKinds: [] });
    expect(resolveRequiredResourceSelections(['workspace'])).toEqual({
      selections: [{ resource_kind: 'workspace', resource_id: 'default-workspace' }],
      missingKinds: [],
    });
  });

  it('deduplicates the manifest and sends only kind/id instead of client-granted operations', () => {
    const result = resolveRequiredResourceSelections(['terminal', 'browser', 'terminal', 'asset_library']);
    expect(result).toEqual({
      selections: [
        { resource_kind: 'asset_library', resource_id: 'creative-studio-assets' },
        { resource_kind: 'browser', resource_id: 'managed-browser' },
        { resource_kind: 'terminal', resource_id: 'managed-terminal' },
      ],
      missingKinds: [],
    });
    for (const selection of result?.selections ?? []) {
      expect(Object.keys(selection).sort()).toEqual(['resource_id', 'resource_kind']);
    }
  });

  it('leaves optional user-owned enhancements unbound and reports required choices', () => {
    expect(resolveRequiredResourceSelections([
      'knowledge_base', 'channel', 'robot', 'canvas', 'ssh_host',
      'companion', 'mcp_server', 'future_resource', 'constructor',
    ])).toEqual({
      selections: [],
      missingKinds: ['companion', 'constructor', 'future_resource', 'mcp_server'],
    });
  });

  it('never mistakes missing or malformed manifest metadata for no required resources', () => {
    for (const value of [undefined, null, {}, 'workspace', ['workspace', null], [' workspace'], ['']]) {
      expect(resolveRequiredResourceSelections(value)).toBeNull();
    }
  });
});
