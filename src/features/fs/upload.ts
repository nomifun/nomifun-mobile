/**
 * `POST /api/fs/upload` — the two-phase attachment upload.
 *
 * Contract facts (verified against `crates/backend/nomifun-file/src/routes.rs`
 * and `.../manager/nomi/image_attachments.rs`):
 *
 * - Multipart fields: `file` (required, the bytes), `file_name` (optional; the
 *   server falls back to the Content-Disposition filename) and
 *   `conversation_id` (optional; picks the temp sub-directory). Any other field
 *   is ignored. `file_name` must be a single path component — separators and
 *   `..` are rejected with 400.
 * - The response `data` is one **absolute path on the desktop machine**, under
 *   `<os-temp>/nomifun/<conversation_id | "general">/`. That is what
 *   `POST /api/conversations/:id/messages` wants in `files`.
 * - Request-body cap is `UPLOAD_MAX_SIZE` (30 MiB) — but an *image* attachment
 *   is additionally capped at 12 MiB by the agent when the turn is built, so
 *   the smaller limit is the one worth enforcing before wasting the upload.
 * - Extension policy is NOT the upload endpoint's: `classify_extension` in the
 *   agent hard-errors the whole turn on `heic`/`heif`/`gif`/`bmp`/`tif`/`tiff`/
 *   `ico`/`avif`/`svg` ("use PNG, JPEG, or WebP"). A HEIC photo — the iPhone
 *   default — would therefore upload fine and then kill the send, so it has to
 *   be refused client-side.
 * - Temp files are transient: never persist a returned path (OS temp cleanup
 *   invalidates it). Upload, then send.
 *
 * Failures are surfaced as {@link UploadError} carrying a machine-readable
 * `reason`; the caller owns the copy (this module is i18n-free so the
 * `sessions` namespace can phrase it in composer terms).
 */
import { api } from '@/api/client';
import { ApiError } from '@/api/types';

/** Hard body cap on the upload route (`UPLOAD_MAX_SIZE`, 30 MiB). */
export const UPLOAD_MAX_BYTES = 30 * 1024 * 1024;

/**
 * Per-image cap applied later, when the agent embeds the attachment
 * (`MAX_SOURCE_BYTES`). Lower than {@link UPLOAD_MAX_BYTES}, so images are
 * validated against this one.
 */
export const IMAGE_MAX_BYTES = 12 * 1024 * 1024;

/** Formats the agent can actually embed (`classify_extension` → Ok(Some)). */
export const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;

/**
 * Image-looking formats the agent refuses outright. Listed separately so the
 * UI can say "HEIC is not supported" instead of "not an image".
 */
export const REJECTED_IMAGE_EXTENSIONS = [
  'heic',
  'heif',
  'gif',
  'bmp',
  'tif',
  'tiff',
  'ico',
  'avif',
  'svg',
] as const;

/** `MAX_IMAGE_ATTACHMENTS` in the agent — a fifth image fails the turn. */
export const MAX_ATTACHMENTS = 4;

/** Accept filter for the web `<input type="file">`. */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';

export type UploadRejection =
  /** No usable file name once separators are stripped. */
  | 'name'
  /** Zero bytes — the server would store an empty file the agent cannot decode. */
  | 'empty'
  /** Over {@link IMAGE_MAX_BYTES}. */
  | 'tooLarge'
  /** Recognised image format the agent hard-errors on (HEIC & friends). */
  | 'unsupportedImage'
  /** Not an image at all — this version only attaches images. */
  | 'notImage'
  /**
   * Over {@link MAX_ATTACHMENTS} for this turn. Not a property of the file, so
   * {@link validateUpload} never returns it — only the composer queue, which is
   * the only thing that knows how many slots are already taken, does.
   */
  | 'tooMany';

export type UploadFailure = UploadRejection | 'request';

export class UploadError extends Error {
  readonly reason: UploadFailure;
  /** HTTP status when the server rejected the upload. */
  readonly status?: number;

  constructor(reason: UploadFailure, message?: string, status?: number) {
    super(message ?? reason);
    this.name = 'UploadError';
    this.reason = reason;
    this.status = status;
  }
}

/** Minimal view of a picked file — web `File`, or anything with these fields. */
export interface UploadCandidate {
  name: string;
  size: number;
}

/**
 * Last path component of a (possibly path-ish) file name, trimmed.
 * Mirrors the server's `sanitize_upload_filename`, so a name this returns is
 * one the server will also accept.
 */
export function sanitizeFileName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  const last = trimmed.split(/[/\\]/).pop() ?? '';
  const name = last.trim();
  // `.` / `..` survive the split but are traversal, not names.
  return name === '.' || name === '..' ? '' : name;
}

/** Lowercased extension without the dot; `''` when the name has none. */
export function fileExtension(name: string): string {
  const base = sanitizeFileName(name);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function isSupportedImage(name: string): boolean {
  return (SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(fileExtension(name));
}

export function isRejectedImage(name: string): boolean {
  return (REJECTED_IMAGE_EXTENSIONS as readonly string[]).includes(fileExtension(name));
}

/**
 * Pure pre-flight check. `null` = good to upload.
 *
 * Order matters: a nameless file cannot be classified, and a HEIC must read as
 * "unsupported format" even when it is also oversized, because converting is
 * the actionable advice.
 */
export function validateUpload(file: UploadCandidate): UploadRejection | null {
  if (sanitizeFileName(file.name) === '') return 'name';
  if (isRejectedImage(file.name)) return 'unsupportedImage';
  if (!isSupportedImage(file.name)) return 'notImage';
  if (!Number.isFinite(file.size) || file.size <= 0) return 'empty';
  if (file.size > IMAGE_MAX_BYTES) return 'tooLarge';
  return null;
}

/**
 * Upload one file and return its absolute path on the desktop machine.
 *
 * `body` is the raw bytes (a web `File`/`Blob`). `conversationId` only picks
 * the temp sub-directory — it is not an ownership check, and omitting it lands
 * the file in `<temp>/nomifun/general/`.
 */
export async function uploadFile(
  body: Blob,
  fileName: string,
  conversationId?: string,
): Promise<string> {
  const name = sanitizeFileName(fileName);
  const rejection = validateUpload({ name, size: body.size });
  if (rejection) throw new UploadError(rejection);

  const form = new FormData();
  // Send the name twice: `file_name` is authoritative server-side, the
  // Content-Disposition filename is the fallback for clients that cannot set it.
  form.append('file', body, name);
  form.append('file_name', name);
  if (conversationId) form.append('conversation_id', conversationId);

  let path: string;
  try {
    path = await api<string>('/api/fs/upload', { formData: form });
  } catch (error) {
    if (error instanceof ApiError) {
      throw new UploadError('request', error.message, error.status);
    }
    throw new UploadError(
      'request',
      error instanceof Error ? error.message : undefined,
    );
  }
  if (typeof path !== 'string' || path.trim() === '') {
    throw new UploadError('request', 'upload returned no path');
  }
  return path;
}
