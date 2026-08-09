/**
 * Wire types for `nomifun-cron` (定时任务).
 *
 * Mirrors `crates/backend/nomifun-api-types/src/cron.rs`. Both request DTOs are
 * `#[serde(deny_unknown_fields)]` on the server, so the payload builders in
 * `./api.ts` send exactly the documented keys — an extra field is a 400.
 */

export type CronRunStatus = 'ok' | 'error' | 'skipped' | 'missed';

/** `execution_mode` is immutable after creation. */
export type CronExecutionMode = 'existing' | 'new_conversation';

export type CronSchedule =
  | { kind: 'cron'; expr: string; tz?: string; description?: string }
  | { kind: 'every'; every_ms: number; description?: string }
  | { kind: 'at'; at_ms: number; description?: string };

export interface CronAgentConfig {
  /** ACP backend only; absent for Nomi jobs (they carry `provider_id`). */
  backend?: string;
  name: string;
  cli_path?: string;
  custom_agent_id?: string;
  preset_id?: string;
  preset_revision?: number;
  mode?: string;
  model?: string;
  provider_id?: string;
  config_options?: Record<string, string>;
  workspace?: string;
  clear_context_each_run?: boolean;
}

export interface CronJobMetadata {
  /** Absent until the backend materializes the first conversation. */
  conversation_id?: string;
  conversation_title?: string;
  agent_type: string;
  created_by: 'user' | 'agent' | string;
  created_at: number;
  updated_at: number;
  agent_config?: CronAgentConfig;
}

export interface CronJobState {
  next_run_at_ms?: number;
  last_run_at_ms?: number;
  last_status?: CronRunStatus | string;
  last_error?: string;
  run_count: number;
  retry_count: number;
  max_retries: number;
}

export interface CronJob {
  cron_job_id: string;
  name: string;
  description?: string;
  enabled: boolean;
  schedule: CronSchedule;
  /** The prompt handed to the agent on every trigger. */
  message: string;
  execution_mode: CronExecutionMode | string;
  metadata: CronJobMetadata;
  state: CronJobState;
}

/** One recorded run. The server keeps only the latest 7 per job. */
export interface CronJobRun {
  cron_job_run_id: string;
  cron_job_id: string;
  executed_at_ms: number;
  status: CronRunStatus | string;
}

/** Exactly the keys `UpdateCronJobRequest` accepts (minus the ones we never send). */
export interface CronJobUpdate {
  name?: string;
  description?: string;
  enabled?: boolean;
  schedule?: CronSchedule;
  message?: string;
  conversation_title?: string;
}

/** Exactly the keys `CreateCronJobRequest` accepts that mobile ever sends. */
export interface CronJobCreate {
  name: string;
  description?: string;
  schedule: CronSchedule;
  prompt: string;
  conversation_id?: string;
  conversation_title?: string;
  agent_type: string;
  created_by: 'user';
  execution_mode: CronExecutionMode;
}

/** Minimal projection of `GET /api/conversations` used by the create picker. */
export interface CronConversationOption {
  conversation_id: string;
  name: string;
  type: string;
  /** Resolved backend key used as `agent_type` when binding to this thread. */
  agent_type: string;
  modified_at: number;
}
