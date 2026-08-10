/**
 * Tool-approval (confirmation) wire model — pure projection, no I/O.
 *
 * Wire truth, cross-checked against the desktop backend:
 *
 * - `GET /api/conversations/:id/confirmations` → `Vec<Confirmation>`
 *   (`{id, call_id, title, action, description, command_type, options:
 *   [{label, value, params}], screenshot}`). It answers `[]` when the
 *   conversation has no live runtime, so it is always safe to poll.
 * - `POST /api/conversations/:id/confirmations/:call_id/confirm`
 *   `{msg_id, data, always_allow}` — `deny_unknown_fields`, and `msg_id` must
 *   be a canonical UUIDv7. The Confirmation's own `id` is minted with
 *   `generate_id()` (UUIDv7), so it doubles as `msg_id` exactly like the
 *   desktop's `message.msg_id ?? content.id` fallback.
 * - `data` MUST be an object with a **string `value`**: the nomi agent reads
 *   `data["value"]` and treats *anything other than `"cancel"`* as approval
 *   (`is_cancel = value == "cancel"`), so sending a label — or an option whose
 *   value got lost — silently converts a denial into an approval. The ACP agent
 *   accepts the same `{value}` shape (`confirm_option_id` also probes
 *   `option_id`/`optionId`).
 * - `always_allow` is what selects `ApprovalScope::Always`; the option value
 *   alone does nothing, so it is derived from the chosen option
 *   ({@link isAlwaysChoice}).
 *
 * Two shapes arrive, and {@link normalizeConfirmation} eats both: the
 * Confirmation above, and the ACP permission request (`{session_id,
 * tool_call: {tool_call_id, title, kind, raw_input}, options: [{option_id,
 * name, kind}]}`). The projection mirrors the backend's own
 * `AcpPermissionRequestData::to_confirmation`.
 */

export interface ConfirmationChoice {
  /** What goes on the wire as `data.value`. Never the label. */
  value: string;
  /** Raw label; an i18n key on nomi confirmations, prose on ACP ones. */
  label: string;
  /** ACP option kind (`allow_once` | `allow_always` | `reject_*`). */
  kind?: string;
}

export interface PendingConfirmation {
  /** Confirmation identity; also sent as `msg_id`. */
  id: string;
  /** Path segment of the confirm endpoint, and the agent's approval key. */
  callId: string;
  title?: string;
  /** Tool name on nomi confirmations. */
  action?: string;
  description?: string;
  /** Tool category (`exec`/`edit`/`read`/`mcp`…) — drives the danger styling. */
  commandType?: string;
  options: ConfirmationChoice[];
  /** Base64 page preview (browser takeover only); not rendered on mobile. */
  screenshot?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function optional(value: unknown): string | undefined {
  const text = str(value);
  return text === '' ? undefined : text;
}

/** `{label, value}` options (nomi Confirmation form). */
function confirmationOptions(raw: unknown): ConfirmationChoice[] {
  if (!Array.isArray(raw)) return [];
  const out: ConfirmationChoice[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    // A non-scalar value cannot be replayed as `data.value`; dropping the
    // option is safer than guessing, because a wrong value means "approved".
    const value = str(entry.value);
    if (value === '') continue;
    out.push({ value, label: str(entry.label) || value });
  }
  return out;
}

/** `{option_id, name, kind}` options (ACP request form). */
function acpOptions(raw: unknown): ConfirmationChoice[] {
  if (!Array.isArray(raw)) return [];
  const out: ConfirmationChoice[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const value = str(entry.option_id) || str(entry.optionId);
    if (value === '') continue;
    out.push({ value, label: str(entry.name) || value, kind: optional(entry.kind) });
  }
  return out;
}

/**
 * Project either wire shape onto {@link PendingConfirmation}; `null` when the
 * payload cannot identify a tool call (no `call_id` / `tool_call_id`), because
 * without one there is nothing to POST to.
 */
export function normalizeConfirmation(raw: unknown): PendingConfirmation | null {
  if (!isRecord(raw)) return null;

  const toolCall = isRecord(raw.tool_call) ? raw.tool_call : undefined;
  if (toolCall) {
    const callId = str(toolCall.tool_call_id) || str(toolCall.toolCallId);
    if (callId === '') return null;
    const rawInput = isRecord(toolCall.raw_input) ? toolCall.raw_input : undefined;
    return {
      // The desktop uses the tool_call_id for both; there is no separate id.
      id: str(raw.id) || callId,
      callId,
      title: optional(toolCall.title),
      action: optional(toolCall.title),
      description: optional(rawInput?.description) ?? optional(rawInput?.command),
      commandType: optional(toolCall.kind),
      options: acpOptions(raw.options),
      screenshot: optional(raw.screenshot),
    };
  }

  const callId = str(raw.call_id) || str(raw.callId);
  if (callId === '') return null;
  return {
    id: str(raw.id) || callId,
    callId,
    title: optional(raw.title),
    action: optional(raw.action),
    description: optional(raw.description),
    commandType: optional(raw.command_type) ?? optional(raw.commandType),
    options: confirmationOptions(raw.options),
    screenshot: optional(raw.screenshot),
  };
}

/** List projection: drops unusable rows and de-duplicates by call id. */
export function normalizeConfirmations(raw: unknown): PendingConfirmation[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingConfirmation[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const item = normalizeConfirmation(entry);
    if (!item || seen.has(item.callId)) continue;
    seen.add(item.callId);
    out.push(item);
  }
  return out;
}

// ── Option semantics ───────────────────────────────────────────────

/** Denial. Nomi only recognises the literal `"cancel"`; ACP uses `reject_*`. */
export function isDenyChoice(choice: ConfirmationChoice): boolean {
  const value = choice.value.toLowerCase();
  const kind = (choice.kind ?? '').toLowerCase();
  return value === 'cancel' || value.startsWith('reject') || kind.startsWith('reject');
}

/** Whether picking this option should also set `always_allow`. */
export function isAlwaysChoice(choice: ConfirmationChoice): boolean {
  const value = choice.value.toLowerCase();
  const kind = (choice.kind ?? '').toLowerCase();
  return value.endsWith('_always') || kind.endsWith('_always');
}

/**
 * Translation key for the three labels the nomi backend emits (they are i18n
 * keys in the *desktop's* catalog, so they cannot be rendered raw).
 */
export function choiceLabelKey(choice: ConfirmationChoice): string | undefined {
  switch (choice.value) {
    case 'proceed_once':
      return 'confirmation.allowOnce';
    case 'proceed_always':
      return 'confirmation.allowAlways';
    case 'cancel':
      return 'confirmation.deny';
    default:
      return undefined;
  }
}

/**
 * Human label for an option we have no key for. A dotted, space-free label is
 * an untranslated i18n key from another catalog (`messages.confirmation.x`) —
 * showing the last segment beats showing the whole path.
 */
export function choiceFallbackLabel(choice: ConfirmationChoice): string {
  const label = choice.label.trim();
  if (label === '') return choice.value;
  if (!/\s/.test(label) && /^[a-z][\w-]*(\.[\w-]+)+$/i.test(label)) {
    return label.split('.').pop() ?? label;
  }
  return label;
}

/** Destructive tool categories — the card leans on `warning` for these. */
const RISKY_CATEGORIES = new Set(['exec', 'execute', 'edit', 'write', 'delete', 'shell', 'bash']);

export function isRiskyConfirmation(confirmation: PendingConfirmation): boolean {
  const category = (confirmation.commandType ?? '').toLowerCase();
  if (RISKY_CATEGORIES.has(category)) return true;
  const action = (confirmation.action ?? '').toLowerCase();
  return /exec|shell|bash|command|write|edit|delete|remove|rm\b/.test(action);
}

/** Body for the confirm endpoint. Exported so the shape is testable. */
export function confirmBody(
  confirmation: PendingConfirmation,
  choice: ConfirmationChoice,
): { msg_id: string; data: { value: string }; always_allow: boolean } {
  return {
    msg_id: confirmation.id,
    data: { value: choice.value },
    always_allow: isAlwaysChoice(choice),
  };
}
