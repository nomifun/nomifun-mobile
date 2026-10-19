import type { ModelRef, ModelTask, ModelTrait, TextToSpeechConfig } from '@/features/models/types';
import type { CompanionProfile, CompanionProfilePatch } from './types';

/** Each slot maps directly to an existing Desktop profile field. */
export const COMPANION_MODEL_SLOTS = [
  'model', 'fallback_model', 'vision_model', 'asr', 'tts', 'learn', 'evolve',
] as const;

export type CompanionModelSlot = (typeof COMPANION_MODEL_SLOTS)[number];

export function companionModelRef(profile: CompanionProfile, slot: 'tts'): TextToSpeechConfig | null;
export function companionModelRef(profile: CompanionProfile, slot: CompanionModelSlot): ModelRef | TextToSpeechConfig | null;
export function companionModelRef(profile: CompanionProfile, slot: CompanionModelSlot): ModelRef | TextToSpeechConfig | null {
  switch (slot) {
    case 'model':
    case 'fallback_model':
    case 'vision_model':
      return profile[slot];
    case 'asr':
    case 'tts':
      return profile.voice[slot];
    case 'learn':
    case 'evolve':
      return profile[slot].model;
  }
}

export function companionModelRequirements(slot: CompanionModelSlot): {
  task: ModelTask;
  requiredTraits?: readonly ModelTrait[];
} {
  switch (slot) {
    case 'vision_model':
      return { task: 'chat', requiredTraits: ['vision_input'] };
    case 'asr':
      return { task: 'speech_recognition' };
    case 'tts':
      return { task: 'speech_synthesis' };
    default:
      return { task: 'chat' };
  }
}

/**
 * Build one RFC 7396 field update. Project the persisted wire fields explicitly:
 * picker/catalog rows can contain metadata that Desktop rejects on this route.
 */
export function companionModelPatch(
  slot: CompanionModelSlot,
  value: ModelRef | TextToSpeechConfig | null,
): CompanionProfilePatch {
  const ref = value === null ? null : { provider_id: value.provider_id, model: value.model };
  switch (slot) {
    case 'model':
    case 'fallback_model':
    case 'vision_model':
      return { [slot]: ref };
    case 'asr':
      return { voice: { asr: ref } };
    case 'tts':
      // An omitted voice retains the current value under merge-patch semantics.
      // Explicit null resets just the voice; null selection clears the TTS slot.
      return { voice: { tts: value === null ? null : {
        provider_id: value.provider_id,
        model: value.model,
        ...('voice' in value && value.voice !== undefined ? { voice: value.voice } : {}),
      } } };
    case 'learn':
    case 'evolve':
      return { [slot]: { model: ref } };
  }
}
