/** Strict desktop DTO allowlists. Response-only observations never enter writes. */
import type {
  BedrockConfig, ProviderConnectionInput, ProviderModelCapabilityInput, ProviderModelInput,
} from './types';

export function capabilityInput(input: ProviderModelCapabilityInput): ProviderModelCapabilityInput {
  return {
    task: input.task,
    ...(input.traits === undefined ? {} : { traits: [...input.traits] }),
    protocol: input.protocol,
    connection_role: input.connection_role,
    ...(input.base_url_override === undefined ? {} : { base_url_override: input.base_url_override }),
    ...(input.endpoint === undefined ? {} : { endpoint: input.endpoint }),
    ...(input.poll_endpoint === undefined ? {} : { poll_endpoint: input.poll_endpoint }),
    ...(input.content_endpoint === undefined ? {} : { content_endpoint: input.content_endpoint }),
    ...(input.realtime_endpoint === undefined ? {} : { realtime_endpoint: input.realtime_endpoint }),
    ...(input.allow_cross_origin_credentials === undefined ? {} : { allow_cross_origin_credentials: input.allow_cross_origin_credentials }),
    ...(input.provider_params === undefined ? {} : { provider_params: input.provider_params }),
    ...(input.context_limit === undefined ? {} : { context_limit: input.context_limit }),
    ...(input.output_limit === undefined ? {} : { output_limit: input.output_limit }),
    ...(input.compaction_threshold_pct === undefined ? {} : { compaction_threshold_pct: input.compaction_threshold_pct }),
  };
}

export function modelInput(input: ProviderModelInput): ProviderModelInput {
  return {
    model: input.model,
    ...(input.display_name === undefined ? {} : { display_name: input.display_name }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.sort_order === undefined ? {} : { sort_order: input.sort_order }),
    capabilities: input.capabilities.map(capabilityInput),
  };
}

export function connectionInput(input: ProviderConnectionInput): ProviderConnectionInput {
  return {
    role: input.role,
    ...(input.label === undefined ? {} : { label: input.label }),
    base_url: input.base_url,
    auth_scheme: input.auth_scheme,
    credentials: input.credentials,
    ...(input.extra === undefined ? {} : { extra: input.extra }),
  };
}

export function bedrockInput(input: BedrockConfig): BedrockConfig {
  return {
    auth_method: input.auth_method,
    region: input.region,
    ...(input.profile === undefined ? {} : { profile: input.profile }),
  };
}
