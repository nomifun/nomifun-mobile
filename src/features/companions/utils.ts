/**
 * Pure helpers for the companion feature: level math, mood/character mapping,
 * figure URLs, roster ordering and the cross-platform destructive confirm.
 */
import { Alert, Platform } from 'react-native';
import type { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';

import { connectionStore } from '@/api/connection';

import type {
  CharacterId,
  CompanionMood,
  CompanionWithStatus,
  CustomFigureMeta,
  MemoryKind,
  RobotPhase,
} from './types';

type IoniconName = keyof typeof Ionicons.glyphMap;
type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

export const MEMORY_KINDS: MemoryKind[] = [
  'profile',
  'preference',
  'knowledge',
  'episode',
  'task',
  'affective',
];

export const PERSONA_PRESETS = ['lively', 'calm', 'sassy'] as const;
export const BUILT_IN_CHARACTERS: CharacterId[] = ['mochi', 'ink', 'bolt'];

/**
 * Level curve, client-side and identical to the desktop
 * (`AppearanceSection.tsx:68-72`): `Lv = floor(sqrt(xp/100)) + 1`, and level L
 * spans `[(L-1)²·100, L²·100)`.
 */
export function levelOf(xp: number): {
  level: number;
  floor: number;
  next: number;
  ratio: number;
} {
  const safeXp = Number.isFinite(xp) && xp > 0 ? xp : 0;
  const level = Math.floor(Math.sqrt(safeXp / 100)) + 1;
  const floor = (level - 1) ** 2 * 100;
  const next = level ** 2 * 100;
  const span = next - floor;
  return {
    level,
    floor,
    next,
    ratio: span > 0 ? Math.min(1, Math.max(0, (safeXp - floor) / span)) : 0,
  };
}

/** Level names are clamped at 5 (`nomi.levels.l1..l5`). */
export const levelNameKey = (level: number) => `levels.l${Math.min(Math.max(level, 1), 5)}`;

const MOODS: CompanionMood[] = ['happy', 'content', 'sleepy', 'worried', 'excited'];

export function moodOf(mood: string | undefined): CompanionMood {
  return MOODS.includes(mood as CompanionMood) ? (mood as CompanionMood) : 'content';
}

export const MOOD_VISUALS: Record<CompanionMood, { icon: IoniconName; tone: Tone }> = {
  happy: { icon: 'happy-outline', tone: 'success' },
  content: { icon: 'leaf-outline', tone: 'primary' },
  sleepy: { icon: 'moon-outline', tone: 'neutral' },
  worried: { icon: 'alert-circle-outline', tone: 'warning' },
  excited: { icon: 'sparkles-outline', tone: 'warning' },
};

export function characterOf(character: string | undefined): CharacterId {
  if (character === 'custom') return 'custom';
  return (BUILT_IN_CHARACTERS as string[]).includes(character ?? '')
    ? (character as CharacterId)
    : 'mochi';
}

/** Icon per character; colours come from the theme at render time. */
export const CHARACTER_ICONS: Record<CharacterId, IoniconName> = {
  mochi: 'flower-outline',
  ink: 'brush-outline',
  bolt: 'hardware-chip-outline',
  custom: 'image-outline',
};

export const MEMORY_KIND_ICONS: Record<MemoryKind, IoniconName> = {
  profile: 'person-outline',
  preference: 'heart-outline',
  knowledge: 'book-outline',
  episode: 'time-outline',
  task: 'checkbox-outline',
  affective: 'happy-outline',
};

export const ROBOT_PHASE_TONES: Record<RobotPhase, Tone> = {
  offline: 'neutral',
  idle: 'success',
  listening: 'primary',
  speaking: 'warning',
};

export function robotPhaseOf(phase: string | undefined): RobotPhase {
  return phase === 'idle' || phase === 'listening' || phase === 'speaking' ? phase : 'offline';
}

/**
 * Absolute URL for a library-backed figure image. That route is auth-exempt
 * (`companion_public_routes`), so a plain `<Image>` can load it; the `?v=` is
 * derived from the frame metadata to bust the cache after a re-frame. Legacy
 * per-companion figures (no `figure_id`) need auth headers — skipped on mobile.
 */
export function figureImageUri(meta: CustomFigureMeta | null | undefined): string | null {
  if (!meta?.figure_id) return null;
  const base = connectionStore.binding()?.baseUrl ?? '';
  const box = meta.head_box;
  const version = encodeURIComponent(
    `${meta.aspect}-${box?.x ?? 0}-${box?.y ?? 0}-${box?.w ?? 0}-${box?.h ?? 0}`,
  );
  return `${base}/api/companion/figures/${meta.figure_id}/image?v=${version}`;
}

/**
 * `order_index` when set, otherwise creation time. `seq` is a registry ordinal,
 * never a sort key (research §8.11).
 */
export function sortRoster(list: CompanionWithStatus[]): CompanionWithStatus[] {
  return [...list].sort((a, b) => {
    const ai = a.order_index ?? null;
    const bi = b.order_index ?? null;
    if (ai !== null && bi !== null && ai !== bi) return ai - bi;
    if (ai !== null && bi === null) return -1;
    if (ai === null && bi !== null) return 1;
    return a.created_at - b.created_at;
  });
}

/**
 * Which companion a `companion.*` event concerns. Several payloads carry an
 * optional `companion_id`; `config-updated` carries `scope` instead
 * (`'shared'` or the companion id). `undefined` = unscoped, treat as "everyone".
 */
export function eventCompanionId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const payload = data as Record<string, unknown>;
  if (typeof payload.companion_id === 'string') return payload.companion_id;
  if (typeof payload.scope === 'string' && payload.scope !== 'shared') return payload.scope;
  return undefined;
}

export function eventConcerns(data: unknown, companionId: string): boolean {
  const id = eventCompanionId(data);
  return id === undefined || id === companionId;
}

/** Destructive confirm — RN `Alert` is a no-op on web. */
export function confirmDestructive(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${opts.title}\n\n${opts.message}`)) opts.onConfirm();
    return;
  }
  Alert.alert(opts.title, opts.message, [
    { text: opts.cancelLabel, style: 'cancel' },
    { text: opts.confirmLabel, style: 'destructive', onPress: opts.onConfirm },
  ]);
}

/** Epoch-ms timestamp → short local label ("HH:mm" today, else "MM-DD HH:mm"). */
export function formatTimestamp(ms: number | null | undefined): string {
  if (!ms) return '';
  const d = dayjs(ms);
  if (!d.isValid()) return '';
  return d.isSame(dayjs(), 'day') ? d.format('HH:mm') : d.format('MM-DD HH:mm');
}

/** RFC 3339 (robot `last_seen`) → short local label. */
export function formatIsoTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = dayjs(iso);
  return d.isValid() ? d.format('MM-DD HH:mm') : '';
}

/** Strip the FTS `<b>…</b>` markers a search snippet carries. */
export function plainSnippet(snippet: string | null | undefined): string {
  return snippet ? snippet.replace(/<\/?b>/g, '') : '';
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isValidClockTime = (value: string) => TIME_RE.test(value.trim());

/** Model reference → "provider · model", or null when unset. */
export function modelLabel(
  ref: { provider_id: string; model: string } | null | undefined,
): string | null {
  if (!ref?.model) return null;
  return ref.provider_id ? `${ref.provider_id} · ${ref.model}` : ref.model;
}
