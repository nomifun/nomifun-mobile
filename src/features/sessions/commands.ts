import type { RequestOptions } from '@/api/transport-client';
import { ApiError, AuthExpiredError, StaleConnectionError } from '@/api/types';
import type { ModelRef, ProviderResponse } from '@/features/models/types';
import { firstUsableModel, isUsableModelRef } from '@/features/models/selectors';
import { resolveRequiredResourceSelections } from './resource-selections';
import { createdConversationId } from './wire';

export type SessionRequest = <T>(path: string, options?: RequestOptions) => Promise<T>;

export interface CreateConversationOptions {
  /** One key per user intent, retained by the owner across uncertain retries. */
  idempotencyKey: string;
  /** The original rendered connection owns every request in this command. */
  expectedEpoch: number;
  /** Absolute desktop directory selected from the server's directory picker. */
  workspace?: string;
}

export interface CreatedConversation {
  conversation_id: string;
  epoch: number;
}

interface AgentPresetTemplate {
  template_key: string;
  seed?: { required_resource_kinds?: unknown };
}

interface AgentPresetLibrary {
  official_templates?: AgentPresetTemplate[];
}

interface AgentPresetEditorResponse {
  preset?: { preset_id?: string };
}

const CHAT_TEMPLATE_KEYS = ['assistant.general', 'chat.minimal'] as const;
const MAX_PENDING_CREATIONS = 32;

/** Injectable command boundary, shared by every session creation entry point. */
export function createConversationCommand(request: SessionRequest, currentEpoch: () => number) {
  const prepared = new Map<string, { epoch: number; signature: string; body: Record<string, unknown> }>();
  const inFlight = new Map<string, { epoch: number; signature: string; promise: Promise<CreatedConversation> }>();
  const changedIntent = () => new ApiError('A changed creation intent requires a new idempotency key', 409, 'IDEMPOTENCY_INTENT_CHANGED');
  const execute = async (
    name: string | undefined,
    options: CreateConversationOptions,
    intentKey: string,
    signature: string,
  ): Promise<CreatedConversation> => {
    const { expectedEpoch, idempotencyKey } = options;
    const assertCurrent = () => {
      if (currentEpoch() !== expectedEpoch) throw new StaleConnectionError();
    };
    const send = async <T>(path: string, input: RequestOptions = {}): Promise<T> => {
      assertCurrent();
      const result = await request<T>(path, { ...input, expectedEpoch });
      assertCurrent();
      return result;
    };
    const rethrowTerminal = (error: unknown) => {
      assertCurrent();
      if (error instanceof StaleConnectionError || error instanceof AuthExpiredError ||
        (error instanceof ApiError && error.code === 'INVALID_API_RESPONSE')) throw error;
    };

    assertCurrent();
    if (typeof idempotencyKey !== 'string' || !/^[\x21-\x7e]+$/.test(idempotencyKey)) {
      throw new ApiError('A session creation intent requires a visible ASCII idempotency key', 400, 'INVALID_IDEMPOTENCY_KEY');
    }
    const previous = prepared.get(intentKey);
    if (previous && previous.signature !== signature) throw changedIntent();
    const prepare = async (): Promise<Record<string, unknown>> => {
      let model: ModelRef | undefined;
      try {
        const settings = await send<Record<string, unknown>>('/api/settings/client');
        const raw = settings?.['nomi.defaultModel'];
        if (raw && typeof raw === 'object') {
          const { provider_id, model: modelName } = raw as Record<string, unknown>;
          if (typeof provider_id === 'string' && provider_id && typeof modelName === 'string' && modelName) {
            model = { provider_id, model: modelName };
          }
        }
      } catch (error) {
        rethrowTerminal(error);
      }
      try {
        const providers = await send<ProviderResponse[]>('/api/providers');
        if (!isUsableModelRef(providers, model, 'chat')) model = firstUsableModel(providers, 'chat');
      } catch (error) {
        // A transient catalog failure can retain a saved model, but cannot move
        // the command to another connection or conceal a broken API contract.
        rethrowTerminal(error);
      }

      const library = await send<AgentPresetLibrary>('/api/agent-preset-templates?source=official');
      const templates = library.official_templates ?? [];
      const template = templates.find(value => value.template_key === CHAT_TEMPLATE_KEYS[0]) ??
        templates.find(value => value.template_key === CHAT_TEMPLATE_KEYS[1]) ?? templates[0];
      if (!template) throw new Error('The desktop reports no official Agent templates');
      const resources = resolveRequiredResourceSelections(template.seed?.required_resource_kinds);
      if (!resources) throw new ApiError('The desktop resource manifest is unavailable', 422, 'SESSION_RESOURCE_MANIFEST_UNAVAILABLE');
      if (resources.missingKinds.length > 0) {
        throw Object.assign(new ApiError('Agent resources require selection', 422, 'SESSION_RESOURCE_SELECTION_REQUIRED'), {
          kinds: resources.missingKinds,
        });
      }
      const editor = await send<AgentPresetEditorResponse>(
        `/api/agent-presets/from-template/${encodeURIComponent(template.template_key)}`,
        { body: {
          display_name: 'Nomi', model_route_refs: {}, chat_route_records: {}, reuse_existing: true,
          ...(model ? { model: { provider_id: model.provider_id, model: model.model } } : {}),
        } },
      );
      const presetId = editor.preset?.preset_id;
      if (!presetId) throw new Error('The desktop did not materialize an Agent preset');
      const workspace = options.workspace?.trim();
      return {
        preset_id: presetId,
        ...(name ? { title: name } : {}),
        ...(model ? { model: { provider_id: model.provider_id, model: model.model } } : {}),
        ...(resources.selections.length ? { resource_selections: resources.selections } : {}),
        ...(workspace ? { workspace } : {}),
      };
    };
    const body = previous?.body ?? await prepare();
    prepared.set(intentKey, { epoch: expectedEpoch, signature, body });
    const receipt = await send<unknown>('/api/agent-sessions', {
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    // A committed ID is sufficient to navigate and invalidate projections.
    // Projection availability is a separate read state, never a create failure.
    const conversationId = createdConversationId(receipt);
    prepared.delete(intentKey);
    return { conversation_id: conversationId, epoch: expectedEpoch };
  };
  return function createConversation(name: string | undefined, options: CreateConversationOptions): Promise<CreatedConversation> {
    const epoch = currentEpoch();
    for (const [key, intent] of prepared) {
      if (intent.epoch !== epoch) prepared.delete(key);
    }
    const intentKey = JSON.stringify([options.expectedEpoch, options.idempotencyKey]);
    const signature = JSON.stringify([name ?? '', options.workspace?.trim() ?? '']);
    const running = inFlight.get(intentKey);
    if (running) return running.signature === signature ? running.promise : Promise.reject(changedIntent());
    // Do not evict uncertain requests: the same key/body remains retryable.
    // Refuse additional intents if all available slots await a known outcome.
    const activeKeys = [...inFlight].filter(([, intent]) => intent.epoch === epoch).map(([key]) => key);
    if (!prepared.has(intentKey) && new Set([...prepared.keys(), ...activeKeys]).size >= MAX_PENDING_CREATIONS) {
      return Promise.reject(new ApiError('Too many session creation intents have an unknown outcome', 409, 'SESSION_CREATION_PENDING_LIMIT'));
    }
    const promise = execute(name, options, intentKey, signature).finally(() => {
      if (inFlight.get(intentKey)?.promise === promise) inFlight.delete(intentKey);
    });
    inFlight.set(intentKey, { epoch: options.expectedEpoch, signature, promise });
    return promise;
  };
}
