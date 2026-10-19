import { describe, expect, test } from 'bun:test';
import { createTransportClient } from '@/api/transport-client';
import { ApiError, StaleConnectionError } from '@/api/types';
import type { ModelRef, TextToSpeechConfig } from '@/features/models/types';
import { createCompanionProfileApi, type CompanionProfileRequestOptions } from './companion-profile-api';
import {
  COMPANION_MODEL_SLOTS, companionModelPatch, companionModelRef, companionModelRequirements,
  type CompanionModelSlot,
} from './model-settings';
import type { CompanionProfile, CompanionProfilePatch } from './types';

const ref: ModelRef = { provider_id: 'provider-a', model: 'model-a' };
const profile = (): CompanionProfile => ({
  companion_id: 'companion-a', seq: 1, name: '波波', character: 'mochi',
  persona: { preset: 'lively', custom: '' },
  model: null, fallback_model: null, vision_model: null,
  voice: { asr: null, tts: null, vad: { engine: 'silero', sensitivity: 0.5, min_silence_ms: 500 } },
  learn: { enabled: true, interval_minutes: 60, model: null },
  evolve: { enabled: true, interval_minutes: 120, model: null, auto_activate: false },
  skills: { enabled: [], disabled_auto: [] },
  appearance: { companion_enabled: true, quiet_start: '', quiet_end: '' },
  created_at: 1,
});

const expectedPatch = (slot: CompanionModelSlot, value: ModelRef | null): CompanionProfilePatch => {
  if (slot === 'asr' || slot === 'tts') return { voice: { [slot]: value } };
  if (slot === 'learn' || slot === 'evolve') return { [slot]: { model: value } };
  return { [slot]: value };
};

describe('companion model contract', () => {
  test('offers exactly the seven existing Desktop slots with their catalog requirements', () => {
    expect(COMPANION_MODEL_SLOTS).toEqual(['model', 'fallback_model', 'vision_model', 'asr', 'tts', 'learn', 'evolve']);
    for (const slot of ['model', 'fallback_model', 'learn', 'evolve'] as const) {
      expect(companionModelRequirements(slot)).toEqual({ task: 'chat' });
    }
    expect(companionModelRequirements('vision_model')).toEqual({ task: 'chat', requiredTraits: ['vision_input'] });
    expect(companionModelRequirements('asr')).toEqual({ task: 'speech_recognition' });
    expect(companionModelRequirements('tts')).toEqual({ task: 'speech_synthesis' });
  });

  for (const slot of COMPANION_MODEL_SLOTS) {
    test(`${slot} writes only the selected persisted field and strips runtime/catalog metadata`, () => {
      const pickerRow = { ...ref, use_model: 'runtime-only', display_name: 'Alias', voice: 'provider-voice', secret: true };
      const expected = slot === 'tts'
        ? { voice: { tts: { ...ref, voice: 'provider-voice' } } }
        : expectedPatch(slot, ref);
      expect(companionModelPatch(slot, pickerRow)).toEqual(expected);
      expect(pickerRow.use_model).toBe('runtime-only');
    });

    test(`${slot} clears only its slot with explicit null`, () => {
      expect(companionModelPatch(slot, null)).toEqual(expectedPatch(slot, null));
    });
  }

  test('TTS distinguishes retained voice, provider-default voice and cleared selection', () => {
    expect(companionModelPatch('tts', ref)).toEqual({ voice: { tts: ref } });
    expect(companionModelPatch('tts', { ...ref, voice: 'alloy' })).toEqual({ voice: { tts: { ...ref, voice: 'alloy' } } });
    expect(companionModelPatch('tts', { ...ref, voice: null })).toEqual({ voice: { tts: { ...ref, voice: null } } });
    expect(companionModelPatch('tts', null)).toEqual({ voice: { tts: null } });
    expect(JSON.stringify(companionModelPatch('tts', ref))).not.toContain('"voice":null');
  });

  test('reads the exact saved slot, including TTS voice, and preserves unconfigured values', () => {
    const saved = profile();
    const refs = Object.fromEntries(COMPANION_MODEL_SLOTS.map(slot => [slot, { provider_id: `provider-${slot}`, model: `model-${slot}` }]));
    saved.model = refs.model;
    saved.fallback_model = refs.fallback_model;
    saved.vision_model = refs.vision_model;
    saved.voice.asr = refs.asr;
    saved.voice.tts = { ...refs.tts, voice: 'alloy' } as TextToSpeechConfig;
    saved.learn.model = refs.learn;
    saved.evolve.model = refs.evolve;
    for (const slot of COMPANION_MODEL_SLOTS) {
      expect(companionModelRef(saved, slot)).toEqual(slot === 'tts' ? { ...refs.tts, voice: 'alloy' } : refs[slot]);
      expect(companionModelRef(profile(), slot)).toBeNull();
    }
  });
});

describe('companion PATCH HTTP boundary', () => {
  const envelope = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), {
    status, headers: { 'Content-Type': 'application/json' },
  });

  function transport(fetcher: typeof fetch, epoch = () => 4, sameOrigin = false) {
    return createTransportClient({
      binding: () => ({ baseUrl: sameOrigin ? '' : 'http://desktop.example:25808', token: 'paired-token', user: null }),
      epoch, markAuthExpired: () => {}, sameOrigin, fetch: fetcher,
    });
  }

  test('serializes exact URL, PATCH and minimal DTO through the production HTTP transport', async () => {
    const saved = { ...profile(), companion_id: 'companion/a b', model: ref };
    const calls: Array<{ url: string; options: RequestInit | undefined }> = [];
    const http = transport((async (url, options) => {
      calls.push({ url: String(url), options });
      return envelope(saved);
    }) as typeof fetch);
    const result = await createCompanionProfileApi(http.api).patchCompanion('companion/a b', companionModelPatch('model', ref), { expectedEpoch: 4 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://desktop.example:25808/api/companion/companions/companion%2Fa%20b');
    expect(calls[0].options?.method).toBe('PATCH');
    expect(JSON.parse(calls[0].options?.body as string)).toEqual({ model: ref });
    expect(calls[0].options?.headers).toMatchObject({ Authorization: 'Bearer paired-token', 'Content-Type': 'application/json' });
    expect(result).toEqual(saved);
    expect('status' in result).toBe(false);
  });

  test('preserves existing non-model profile edits and relative web routing', async () => {
    let requestedBody: unknown;
    const patch: CompanionProfilePatch = {
      name: '新的名字', persona: { custom: '保留设定' },
      learn: { enabled: false, interval_minutes: 90 },
      appearance: { companion_enabled: false, quiet_start: '23:00', quiet_end: '07:00' },
    };
    const http = transport((async (url, options) => {
      expect(String(url)).toBe('/api/companion/companions/companion-a');
      requestedBody = JSON.parse(options?.body as string);
      return envelope(profile());
    }) as typeof fetch, () => 4, true);
    await createCompanionProfileApi(http.api).patchCompanion('companion-a', patch);
    expect(requestedBody).toEqual(patch);
  });

  test('request options cannot replace the method, DTO or Desktop destination', async () => {
    const http = transport((async (url, options) => {
      expect(String(url)).toBe('http://desktop.example:25808/api/companion/companions/companion-a');
      expect(options?.method).toBe('PATCH');
      expect(JSON.parse(options?.body as string)).toEqual({ voice: { tts: { ...ref, voice: null } } });
      return envelope(profile());
    }) as typeof fetch);
    const options = { expectedEpoch: 4, method: 'DELETE', body: { name: 'overwritten' }, baseUrl: 'https://unrelated.example' };
    await createCompanionProfileApi(http.api).patchCompanion('companion-a', companionModelPatch('tts', { ...ref, voice: null }), options);
  });

  test('forwards cancellation and expected epoch without widening request options', async () => {
    const signal = new AbortController().signal;
    let actualOptions: CompanionProfileRequestOptions | undefined;
    const api = createCompanionProfileApi(async <T>(_path: string, options?: CompanionProfileRequestOptions) => {
      actualOptions = options;
      return profile() as T;
    });
    await api.patchCompanion('companion-a', { model: ref }, { expectedEpoch: 4, signal });
    expect(actualOptions?.expectedEpoch).toBe(4);
    expect(actualOptions?.signal).toBe(signal);
  });

  test('rejects an old connection epoch before any request reaches the new Desktop', async () => {
    let requested = false;
    const http = transport((async () => { requested = true; return envelope(profile()); }) as typeof fetch);
    const result = await createCompanionProfileApi(http.api).patchCompanion('companion-a', { model: ref }, { expectedEpoch: 3 }).catch(error => error);
    expect(result).toBeInstanceOf(StaleConnectionError);
    expect(requested).toBe(false);
  });

  test('rejects a response from a Desktop that was disconnected during saving', async () => {
    let epoch = 4;
    const http = transport((async () => { epoch = 5; return envelope(profile()); }) as typeof fetch, () => epoch);
    const result = await createCompanionProfileApi(http.api).patchCompanion('companion-a', { model: ref }, { expectedEpoch: 4 }).catch(error => error);
    expect(result).toBeInstanceOf(StaleConnectionError);
  });

  test('preserves Desktop validation errors instead of turning them into missing-model state', async () => {
    const http = transport((async () => new Response(JSON.stringify({ code: 'BAD_REQUEST', error: 'model is disabled' }), { status: 400 })) as typeof fetch);
    try {
      await createCompanionProfileApi(http.api).patchCompanion('companion-a', { model: ref });
      throw new Error('expected Desktop rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 400, code: 'BAD_REQUEST', message: 'model is disabled' });
    }
  });

  test('rejects successful envelopes with missing data or another companion identity', async () => {
    for (const response of [undefined, null, [], {}, { ...profile(), companion_id: 'another-companion' }]) {
      const http = transport((async () => envelope(response)) as typeof fetch);
      const result = await createCompanionProfileApi(http.api).patchCompanion('companion-a', { name: '波波' }).catch(error => error);
      expect(result).toBeInstanceOf(ApiError);
      expect(result).toMatchObject({ status: 200, code: 'INVALID_API_RESPONSE' });
    }
  });

  test('rejects partial save receipts that omit any persisted model slot', async () => {
    for (const slot of COMPANION_MODEL_SLOTS) {
      const response = structuredClone(profile()) as unknown as Record<string, unknown>;
      if (slot === 'asr' || slot === 'tts') delete (response.voice as Record<string, unknown>)[slot];
      else if (slot === 'learn' || slot === 'evolve') delete (response[slot] as Record<string, unknown>).model;
      else delete response[slot];
      const http = transport((async () => envelope(response)) as typeof fetch);
      const result = await createCompanionProfileApi(http.api).patchCompanion('companion-a', { model: ref }).catch(error => error);
      expect(result).toMatchObject({ code: 'INVALID_API_RESPONSE' });
    }
  });

  test('rejects malformed model references and TTS voice without rejecting valid null slots', async () => {
    const responses = [
      { ...profile(), model: {} },
      { ...profile(), fallback_model: { provider_id: ' ', model: 'a' } },
      { ...profile(), vision_model: { provider_id: 'p', model: '' } },
      { ...profile(), voice: null },
      { ...profile(), voice: { ...profile().voice, asr: { provider_id: 'p' } } },
      { ...profile(), voice: { ...profile().voice, tts: ref } },
      { ...profile(), voice: { ...profile().voice, tts: { ...ref, voice: 42 } } },
      { ...profile(), learn: { model: [] } },
      { ...profile(), evolve: { model: 'model-a' } },
    ];
    for (const response of responses) {
      const http = transport((async () => envelope(response)) as typeof fetch);
      const result = await createCompanionProfileApi(http.api).patchCompanion('companion-a', { model: ref }).catch(error => error);
      expect(result).toMatchObject({ code: 'INVALID_API_RESPONSE' });
    }
    const http = transport((async () => envelope(profile())) as typeof fetch);
    expect(await createCompanionProfileApi(http.api).patchCompanion('companion-a', { name: '波波' })).toEqual(profile());
  });
});
