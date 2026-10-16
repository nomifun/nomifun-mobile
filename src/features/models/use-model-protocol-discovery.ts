import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { connectionStore } from '@/api/connection';
import { discoverModelProtocols, discoverProviderModelProtocols } from './api';
import { capabilityInputFromDraft, type ModelCapabilityDraft } from './advanced';
import { discoveryAppliesDefaults, discoveryContextSnapshot, discoverySnapshot, type ModelProtocolDiscoveryContext } from './protocol-discovery';
import type { DiscoverModelProtocolsResponse } from './types';

/** Explicit invocation only; never auto-runs billable checks while editing. */
export function useModelProtocolDiscovery(model: string, capability: ModelCapabilityDraft, context: ModelProtocolDiscoveryContext) {
  const [result, setResult] = useState<DiscoverModelProtocolsResponse>();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [testedSnapshot, setTestedSnapshot] = useState('');
  const [testedContext, setTestedContext] = useState('');
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const epoch = useSyncExternalStore(connectionStore.subscribe, connectionStore.epoch, connectionStore.epoch);
  const snapshot = discoverySnapshot(model, capability);
  const contextSnapshot = JSON.stringify([epoch, discoveryContextSnapshot(context)]);
  const current = useRef({ snapshot, contextSnapshot });
  current.current = { snapshot, contextSnapshot };
  useEffect(() => {
    sequence.current += 1;
    controller.current?.abort();
    setPending(false);
    setResult(undefined);
    setError(undefined);
  }, [snapshot, contextSnapshot]);
  useEffect(() => () => { sequence.current += 1; controller.current?.abort(); }, []);

  const discover = async (preferredProtocol?: string) => {
    const input = capabilityInputFromDraft(capability);
    if (!input || !model.trim()) return;
    const run = ++sequence.current;
    const captured = { snapshot, contextSnapshot };
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setPending(true);
    setResult(undefined);
    setError(undefined);
    try {
      const request = { model: model.trim(), capability: input,
        apply_recommended_defaults: discoveryAppliesDefaults(capability),
        ...(preferredProtocol ? { preferred_protocol: preferredProtocol } : {}) };
      const options = { signal: abort.signal, expectedEpoch: epoch };
      const response = context.providerId
        ? await discoverProviderModelProtocols(context.providerId, request, options)
        : await discoverModelProtocols({ ...request, platform: context.platform,
            base_url: context.baseUrl.trim(), auth_scheme: context.authScheme.trim(), credentials: context.credentials ?? {},
            ...(context.connections ? { connections: context.connections } : {}),
            ...(context.bedrockConfig ? { bedrock_config: context.bedrockConfig } : {}) }, options);
      if (run !== sequence.current || current.current.snapshot !== captured.snapshot || current.current.contextSnapshot !== captured.contextSnapshot) return;
      setTestedSnapshot(snapshot);
      setTestedContext(contextSnapshot);
      setResult(response);
    } catch (reason) {
      if (run === sequence.current && !abort.signal.aborted) setError(reason);
    } finally {
      if (run === sequence.current) setPending(false);
    }
  };
  return { result: testedSnapshot === snapshot && testedContext === contextSnapshot ? result : undefined, error, pending, testedSnapshot, discover };
}
