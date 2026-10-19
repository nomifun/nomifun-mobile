import type { RequestOptions } from '@/api/transport-client';
import { ApiError } from '@/api/types';
import type { CompanionProfile, CompanionProfilePatch } from './types';

type Request = <T>(path: string, options?: RequestOptions) => Promise<T>;
export type CompanionProfileRequestOptions = Pick<RequestOptions, 'expectedEpoch' | 'signal'>;

export const companionKey = (id: string) => `/api/companion/companions/${encodeURIComponent(id)}`;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function modelRef(value: unknown): boolean {
  return value === null || (record(value)
    && typeof value.provider_id === 'string' && value.provider_id.trim().length > 0
    && typeof value.model === 'string' && value.model.trim().length > 0);
}

/** Validate the identity and model projection before publishing a save receipt. */
function companionProfileResponse(value: unknown, companionId: string): CompanionProfile {
  if (!record(value) || value.companion_id !== companionId
    || !modelRef(value.model) || !modelRef(value.fallback_model) || !modelRef(value.vision_model)
    || !record(value.voice) || !modelRef(value.voice.asr) || !modelRef(value.voice.tts)
    || (value.voice.tts !== null && (!record(value.voice.tts)
      || (value.voice.tts.voice !== null && typeof value.voice.tts.voice !== 'string')))
    || !record(value.learn) || !modelRef(value.learn.model)
    || !record(value.evolve) || !modelRef(value.evolve.model)) {
    throw new ApiError('The Desktop returned an invalid companion profile', 200, 'INVALID_API_RESPONSE');
  }
  return value as unknown as CompanionProfile;
}

/** Injectable HTTP boundary; profile PATCH returns no runtime status projection. */
export function createCompanionProfileApi(request: Request) {
  return {
    async patchCompanion(id: string, patch: CompanionProfilePatch, options: CompanionProfileRequestOptions = {}) {
      const response = await request<unknown>(companionKey(id), {
        ...(options.expectedEpoch === undefined ? {} : { expectedEpoch: options.expectedEpoch }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        method: 'PATCH',
        body: patch,
      });
      return companionProfileResponse(response, id);
    },
  };
}
