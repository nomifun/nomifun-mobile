/**
 * SWR hooks for the customer-service domain.
 *
 * Keys are namespaced (`cs:*`) rather than raw paths: these hooks pass their
 * own fetchers (the wire payloads need normalizing) and must never share a
 * cache entry with another feature that stores a differently-shaped value for
 * the same endpoint.
 *
 * `useCsAgent().patch` keeps the desktop semantics: merge locally first, then
 * write; on failure re-read the authoritative record so the UI never lies
 * after a failed save.
 */
import { useCallback, useMemo } from 'react';
import useSWR, { useSWRConfig, type SWRConfiguration } from 'swr';

import * as csApi from './api';
import { buildTaskModelGroups, mergeAgent, selectCsChannelBots } from './normalize';
import type {
  ChannelPluginStatus,
  CsAgent,
  CsAgentPatch,
  CsDialogue,
  CsMessage,
  CsNote,
  KnowledgeBaseSummary,
  TaskModelGroup,
} from './types';

export const csKeys = {
  agents: 'cs:agents',
  agent: (id: string) => `cs:agent:${id}`,
  notes: (id: string) => `cs:notes:${id}`,
  dialogues: (id: string) => `cs:dialogues:${id}`,
  messages: (id: string) => `cs:dialogue-messages:${id}`,
  bindings: (id: string) => `cs:bindings:${id}`,
  botOwners: 'cs:bot-owners',
  channelPlugins: 'cs:channel-plugins',
  knowledgeBases: 'cs:knowledge-bases',
  providers: 'cs:providers',
  chatModels: 'cs:chat-models',
} as const;

/** Catalog-ish data: stable after load, refreshed by explicit refresh calls. */
const CATALOG_OPTIONS: SWRConfiguration = { revalidateOnFocus: false };

function errorOf(error: unknown): Error | undefined {
  if (error instanceof Error) return error;
  return error == null ? undefined : new Error(String(error));
}

export interface CsAgentsResult {
  agents: CsAgent[];
  isLoading: boolean;
  error?: Error;
  refresh: () => Promise<unknown>;
  create: (name: string) => Promise<CsAgent>;
}

/** Roster of customer-service agents (newest first, server-ordered). */
export function useCsAgents(): CsAgentsResult {
  const { data, error, isLoading, mutate } = useSWR<CsAgent[]>(csKeys.agents, csApi.listAgents);

  const refresh = useCallback(() => mutate(), [mutate]);

  const create = useCallback(
    async (name: string) => {
      const agent = await csApi.createAgent(name.trim());
      await mutate();
      return agent;
    },
    [mutate],
  );

  return { agents: data ?? [], isLoading, error: errorOf(error), refresh, create };
}

export interface CsAgentResult {
  agent?: CsAgent;
  isLoading: boolean;
  error?: Error;
  refresh: () => Promise<unknown>;
  /** Optimistic partial merge; re-syncs from the server when the write fails. */
  patch: (patch: CsAgentPatch) => Promise<CsAgent>;
  remove: () => Promise<void>;
}

export function useCsAgent(csAgentId: string | undefined): CsAgentResult {
  const { mutate: globalMutate } = useSWRConfig();
  const key = csAgentId ? csKeys.agent(csAgentId) : null;
  const { data, error, isLoading, mutate } = useSWR<CsAgent>(key, () =>
    csApi.getAgent(csAgentId as string),
  );

  const refresh = useCallback(() => mutate(), [mutate]);

  const patch = useCallback(
    async (next: CsAgentPatch) => {
      if (!csAgentId) throw new Error('missing cs_agent_id');
      // Optimistic: merge locally first so switches/steppers feel instant.
      void mutate((current) => (current ? mergeAgent(current, next) : current), {
        revalidate: false,
      });
      try {
        const updated = await csApi.patchAgent(csAgentId, next);
        await mutate(updated, { revalidate: false });
        void globalMutate(csKeys.agents);
        return updated;
      } catch (err) {
        // Re-sync to the authoritative record so the UI never lies after a
        // failed save.
        void mutate();
        throw err;
      }
    },
    [csAgentId, globalMutate, mutate],
  );

  const remove = useCallback(async () => {
    if (!csAgentId) return;
    await csApi.deleteAgent(csAgentId);
    void globalMutate(csKeys.agents);
  }, [csAgentId, globalMutate]);

  return { agent: data, isLoading, error: errorOf(error), refresh, patch, remove };
}

export interface CsNotesResult {
  notes: CsNote[];
  isLoading: boolean;
  error?: Error;
  refresh: () => Promise<unknown>;
  mutateLocal: (notes: CsNote[]) => void;
}

/** Notes visible to one agent: its private notes plus every shared note. */
export function useCsNotes(csAgentId: string | undefined): CsNotesResult {
  const key = csAgentId ? csKeys.notes(csAgentId) : null;
  const { data, error, isLoading, mutate } = useSWR<CsNote[]>(key, () =>
    csApi.listNotes(csAgentId as string),
  );

  const refresh = useCallback(() => mutate(), [mutate]);
  const mutateLocal = useCallback(
    (notes: CsNote[]) => void mutate(notes, { revalidate: false }),
    [mutate],
  );

  return { notes: data ?? [], isLoading, error: errorOf(error), refresh, mutateLocal };
}

export interface CsDialoguesResult {
  dialogues: CsDialogue[];
  isLoading: boolean;
  error?: Error;
  refresh: () => Promise<unknown>;
}

/**
 * Visitor lanes of one agent. There are no customer-service WS events, so this
 * is poll-on-demand: pull-to-refresh plus a refresh when the tab regains
 * focus.
 */
export function useCsDialogues(csAgentId: string | undefined): CsDialoguesResult {
  const key = csAgentId ? csKeys.dialogues(csAgentId) : null;
  const { data, error, isLoading, mutate } = useSWR<CsDialogue[]>(key, () =>
    csApi.listDialogues(csAgentId as string),
  );
  const refresh = useCallback(() => mutate(), [mutate]);
  return { dialogues: data ?? [], isLoading, error: errorOf(error), refresh };
}

export interface CsMessagesResult {
  messages: CsMessage[];
  isLoading: boolean;
  error?: Error;
  refresh: () => Promise<unknown>;
}

/** Read-only transcript of one dialogue (chronological). */
export function useCsDialogueMessages(csDialogueId: string | null): CsMessagesResult {
  const key = csDialogueId ? csKeys.messages(csDialogueId) : null;
  const { data, error, isLoading, mutate } = useSWR<CsMessage[]>(key, () =>
    csApi.listDialogueMessages(csDialogueId as string),
  );
  const refresh = useCallback(() => mutate(), [mutate]);
  return { messages: data ?? [], isLoading, error: errorOf(error), refresh };
}

export interface KnowledgeBasesResult {
  bases: KnowledgeBaseSummary[];
  isLoading: boolean;
  error?: Error;
  refresh: () => Promise<unknown>;
  nameOf: (id: string) => string | undefined;
}

export function useKnowledgeBases(): KnowledgeBasesResult {
  const { data, error, isLoading, mutate } = useSWR<KnowledgeBaseSummary[]>(
    csKeys.knowledgeBases,
    csApi.listKnowledgeBases,
    CATALOG_OPTIONS,
  );
  const bases = data ?? [];
  const nameOf = useCallback(
    (id: string) => bases.find((base) => base.knowledge_base_id === id)?.name,
    [bases],
  );
  const refresh = useCallback(() => mutate(), [mutate]);
  return { bases, isLoading, error: errorOf(error), refresh, nameOf };
}

export interface ChatModelsResult {
  groups: TaskModelGroup[];
  isLoading: boolean;
  error?: Error;
  refresh: () => Promise<unknown>;
  providerName: (providerId: string | null) => string | undefined;
  modelsOf: (providerId: string | null) => string[];
}

/**
 * Chat-capable provider/model catalog: `POST /api/model-profiles/resolve`
 * joined against the enabled provider list. Provider order comes from the
 * provider list, model order from the catalog.
 */
export function useChatModels(): ChatModelsResult {
  const providers = useSWR(csKeys.providers, csApi.listProviders, CATALOG_OPTIONS);
  const catalog = useSWR(csKeys.chatModels, csApi.resolveChatModels, CATALOG_OPTIONS);

  const groups = useMemo(
    () => buildTaskModelGroups(catalog.data ?? [], providers.data ?? []),
    [catalog.data, providers.data],
  );

  const providerName = useCallback(
    (providerId: string | null) =>
      providerId == null
        ? undefined
        : (providers.data ?? []).find((provider) => provider.provider_id === providerId)?.name,
    [providers.data],
  );

  const modelsOf = useCallback(
    (providerId: string | null) =>
      providerId == null
        ? []
        : (groups.find((group) => group.provider.provider_id === providerId)?.models ?? []),
    [groups],
  );

  const refresh = useCallback(
    () => Promise.all([providers.mutate(), catalog.mutate()]),
    [catalog, providers],
  );

  return {
    groups,
    // Never treat a failed resolve as an authoritative empty catalog.
    isLoading: providers.isLoading || catalog.isLoading,
    error: errorOf(providers.error ?? catalog.error),
    refresh,
    providerName,
    modelsOf,
  };
}

export interface CsBotPoolResult {
  /** Bots in the customer-service domain (companion bots never appear). */
  bots: ChannelPluginStatus[];
  /** channel_plugin_id → owning cs_agent_id, across every agent. */
  ownerByBot: Map<string, string>;
  /** cs_agent_id → display name, for the「已绑客服：X」tag. */
  agentNames: Map<string, string>;
  isLoading: boolean;
  error?: Error;
  refresh: () => Promise<unknown>;
}

/**
 * The customer-service bot pool plus the full bot → agent ownership map, so a
 * row can be honestly labelled 绑本客服 / 已绑其他客服 / 未绑定. Building the
 * map needs one bindings request per agent; the roster is tiny and this view is
 * read-only, so we fan out on demand instead of guessing.
 */
export function useCsBotPool(): CsBotPoolResult {
  const plugins = useSWR<ChannelPluginStatus[]>(
    csKeys.channelPlugins,
    csApi.listChannelPlugins,
    CATALOG_OPTIONS,
  );
  const agents = useSWR<CsAgent[]>(csKeys.agents, csApi.listAgents, CATALOG_OPTIONS);

  const agentIds = (agents.data ?? []).map((agent) => agent.cs_agent_id);
  const ownersKey = agentIds.length > 0 ? `${csKeys.botOwners}:${agentIds.join(',')}` : null;

  const owners = useSWR<Array<{ agentId: string; pluginIds: string[] }>>(
    ownersKey,
    async () =>
      Promise.all(
        agentIds.map(async (agentId) => ({
          agentId,
          pluginIds: (await csApi.listBindings(agentId)).map(
            (binding) => binding.channel_plugin_id,
          ),
        })),
      ),
    CATALOG_OPTIONS,
  );

  const ownerByBot = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of owners.data ?? []) {
      for (const pluginId of entry.pluginIds) map.set(pluginId, entry.agentId);
    }
    return map;
  }, [owners.data]);

  const agentNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents.data ?? []) map.set(agent.cs_agent_id, agent.name);
    return map;
  }, [agents.data]);

  const bots = useMemo(() => selectCsChannelBots(plugins.data ?? []), [plugins.data]);

  const refresh = useCallback(
    () => Promise.all([plugins.mutate(), agents.mutate(), owners.mutate()]),
    [agents, owners, plugins],
  );

  return {
    bots,
    ownerByBot,
    agentNames,
    isLoading: plugins.isLoading || agents.isLoading || owners.isLoading,
    error: errorOf(plugins.error ?? agents.error ?? owners.error),
    refresh,
  };
}
