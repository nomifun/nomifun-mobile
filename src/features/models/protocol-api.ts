/** UI-independent HTTP adapter for setup discovery and gateway control. */
import type { RequestOptions } from '@/api/transport-client';
import type {
  CreateModelGatewayRequest, DiscoverModelProtocolsAnonymousRequest, DiscoverModelProtocolsRequest,
  DiscoverModelProtocolsResponse, ModelGatewayAccountResponse, ModelGatewayCatalogResponse,
  ModelGatewayMetaResponse, ProviderResponse, SyncModelGatewayResponse, UpdateModelGatewayConnectionRequest,
} from './types';
import { bedrockInput, capabilityInput, connectionInput } from './wire';

type Request = <T>(path: string, options?: RequestOptions) => Promise<T>;
export type ModelSetupRequestOptions = Pick<RequestOptions, 'signal' | 'expectedEpoch'>;

function discoveryInput(input: DiscoverModelProtocolsRequest) {
  return {
    model: input.model,
    capability: capabilityInput(input.capability),
    ...(input.preferred_protocol === undefined ? {} : { preferred_protocol: input.preferred_protocol }),
    ...(input.apply_recommended_defaults === undefined ? {} : { apply_recommended_defaults: input.apply_recommended_defaults }),
  };
}

export function createModelProtocolApi(request: Request) {
  const providerPath = (providerId: string) => `/api/providers/${encodeURIComponent(providerId)}/model-gateway`;
  return {
    discoverModelProtocols(input: DiscoverModelProtocolsAnonymousRequest, options: ModelSetupRequestOptions = {}) {
      return request<DiscoverModelProtocolsResponse>('/api/providers/discover-model-protocols', {
        ...options, timeoutMs: 120_000,
        body: {
          platform: input.platform, base_url: input.base_url, auth_scheme: input.auth_scheme,
          credentials: input.credentials, ...discoveryInput(input),
          ...(input.connections === undefined ? {} : { connections: input.connections.map(connectionInput) }),
          ...(input.bedrock_config === undefined ? {} : { bedrock_config: bedrockInput(input.bedrock_config) }),
        },
      });
    },
    discoverProviderModelProtocols(providerId: string, input: DiscoverModelProtocolsRequest, options: ModelSetupRequestOptions = {}) {
      return request<DiscoverModelProtocolsResponse>(`/api/providers/${encodeURIComponent(providerId)}/discover-model-protocols`, {
        ...options, timeoutMs: 120_000, body: discoveryInput(input),
      });
    },
    modelGateway: {
      meta(input: { base_url: string }, options: ModelSetupRequestOptions = {}) {
        return request<ModelGatewayMetaResponse>('/api/providers/model-gateway/meta', {
          ...options, body: { base_url: input.base_url }, timeoutMs: 30_000,
        });
      },
      catalog(input: { base_url: string; api_key: string }, options: ModelSetupRequestOptions = {}) {
        return request<ModelGatewayCatalogResponse>('/api/providers/model-gateway/catalog', {
          ...options, body: { base_url: input.base_url, api_key: input.api_key }, timeoutMs: 30_000,
        });
      },
      create(input: CreateModelGatewayRequest, options: ModelSetupRequestOptions = {}) {
        return request<ProviderResponse>('/api/providers/model-gateway/create', {
          ...options, body: { base_url: input.base_url, api_key: input.api_key, name: input.name, models: [...input.models] },
          timeoutMs: 60_000,
        });
      },
      providerMeta(providerId: string, options: ModelSetupRequestOptions = {}) {
        return request<ModelGatewayMetaResponse>(`${providerPath(providerId)}/meta`, options);
      },
      account(providerId: string, options: ModelSetupRequestOptions = {}) {
        return request<ModelGatewayAccountResponse>(`${providerPath(providerId)}/account`, options);
      },
      sync(providerId: string, options: ModelSetupRequestOptions = {}) {
        return request<SyncModelGatewayResponse>(`${providerPath(providerId)}/sync`, { ...options, body: {}, timeoutMs: 60_000 });
      },
      updateConnection(providerId: string, input: UpdateModelGatewayConnectionRequest, options: ModelSetupRequestOptions = {}) {
        return request<ProviderResponse>(`${providerPath(providerId)}/connection`, {
          ...options, method: 'PUT', timeoutMs: 60_000,
          body: { base_url: input.base_url, ...(input.api_key == null ? {} : { api_key: input.api_key }), ...(input.name == null ? {} : { name: input.name }) },
        });
      },
    },
  };
}
