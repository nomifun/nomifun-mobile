/**
 * Wire shapes for `/api/companion/*` (snake_case, 1:1 with the Rust JSON).
 *
 * Mirrors `ui/src/common/adapter/ipcBridge.ts` in the desktop repo — see
 * docs/research/feature-companions.md §3. Retired fields (`scope_kind`,
 * `scope_companion_id`, `provenance`, `superseded_by`) are gone from the wire;
 * never reintroduce them.
 */

export type CompanionMood = 'happy' | 'content' | 'sleepy' | 'worried' | 'excited';
export type MemoryKind =
  | 'profile'
  | 'preference'
  | 'knowledge'
  | 'episode'
  | 'task'
  | 'affective';
export type MemoryStatus = 'active' | 'archived';
export type MemorySort = 'relevance' | 'time' | 'importance';
export type SkillStatus = 'draft' | 'active' | 'archived';
export type RobotPhase = 'offline' | 'idle' | 'listening' | 'speaking';
/** Built-in characters implemented in the desktop app (+ DIY `custom`). */
export type CharacterId = 'mochi' | 'ink' | 'bolt' | 'custom';

export interface ModelRef {
  provider_id: string;
  model: string;
  use_model?: string | null;
}

export interface TtsSelection {
  provider_id: string;
  model: string;
  voice: string | null;
}

export interface CustomFigureMeta {
  aspect: number;
  head_box: { x: number; y: number; w: number; h?: number };
  size_tier: 's' | 'm' | 'l';
  size_px?: number | null;
  /** Library figure UUIDv7; absent for legacy per-companion figures. */
  figure_id?: string;
}

export interface CompanionAppearance {
  companion_enabled: boolean;
  /** Desktop window position — desktop-only, never edited from mobile. */
  companion_x?: number | null;
  companion_y?: number | null;
  /** "HH:mm" */
  quiet_start: string;
  /** "HH:mm" */
  quiet_end: string;
  custom_figure?: CustomFigureMeta | null;
}

export interface CompanionProfile {
  companion_id: string;
  seq: number;
  name: string;
  character: string;
  persona: { preset: string; custom: string };
  model: ModelRef | null;
  fallback_model: ModelRef | null;
  vision_model: ModelRef | null;
  voice: {
    asr: ModelRef | null;
    tts: TtsSelection | null;
    vad: { engine: string; sensitivity: number; min_silence_ms: number };
  };
  learn: { enabled: boolean; interval_minutes: number; model: ModelRef | null };
  evolve: {
    enabled: boolean;
    interval_minutes: number;
    model: ModelRef | null;
    auto_activate: boolean;
  };
  skills: { enabled: string[]; disabled_auto: string[] };
  appearance: CompanionAppearance;
  order_index?: number | null;
  created_at: number;
}

export interface CompanionStatus {
  companion_id: string | null;
  xp: number;
  level: number;
  /** One of CompanionMood; typed loose because the wire says `string`. */
  mood: string;
  memories_active: number;
  memories_archived: number;
  model_configured: boolean;
  collect_any_enabled: boolean;
}

export type CompanionWithStatus = CompanionProfile & { status: CompanionStatus };

/** RFC 7396 merge patch — nested objects merge, `null` clears. */
export interface CompanionProfilePatch {
  name?: string;
  persona?: { preset?: string; custom?: string };
  learn?: { enabled?: boolean; interval_minutes?: number };
  appearance?: {
    companion_enabled?: boolean;
    quiet_start?: string;
    quiet_end?: string;
  };
}

/** Install-level config; only `default_companion_id` is read on mobile. */
export interface CompanionSharedConfig {
  default_companion_id: string | null;
  smart_collaboration: boolean;
}

export interface CompanionMemory {
  memory_id: string;
  kind: MemoryKind;
  content: string;
  tags: string[];
  importance: number;
  strength: number;
  pinned: boolean;
  source: string;
  status: MemoryStatus;
  created_at: number;
  updated_at: number;
  last_reinforced_at: number;
  companion_id: string | null;
  /** FTS highlight (`<b>…</b>`) — full-text query results only. */
  snippet?: string | null;
  rank?: number | null;
}

export interface CompanionMemoryPage {
  items: CompanionMemory[];
  total: number;
}

export interface CompanionSkill {
  companion_skill_id: string;
  skill_name: string;
  companion_id: string | null;
  status: SkillStatus;
  source: string;
  confidence: number;
  strength: number;
  version: number;
  usage_count: number;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
  description: string;
}

export interface CompanionSkillPage {
  items: CompanionSkill[];
  total: number;
}

export interface CompanionThread {
  conversation_id: string;
  companion_id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface CompanionLearnResult {
  status: string;
  events_processed: number;
  memories_added: number;
  error?: string | null;
  summary?: string | null;
}

export interface CompanionWeeklyDigest {
  since_ms: number;
  skills_learned: number;
  memories_added: number;
  new_skill_names: string[];
}

/** One ESP32 robot bound to a companion (`/api/robots`). */
export interface Robot {
  robot_id: string;
  name: string;
  companion_id: string | null;
  board: string;
  firmware_version: string;
  /** RFC 3339, or null when the device never reported in. */
  last_seen: string | null;
  created_at: string;
}

export interface RobotStatus {
  robot_id: string;
  companion_id: string | null;
  phase: RobotPhase;
  changed_at: number;
}
