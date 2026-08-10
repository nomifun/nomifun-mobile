/**
 * Composer attachments: pick → upload → send as `files`.
 *
 * Two contracts meet here.
 *
 * 1. `POST /api/conversations/:id/messages` takes `files: string[]` of
 *    **absolute paths on the desktop machine** (see `features/fs/upload.ts`).
 *    The paths live in the OS temp dir, so they are valid only until the OS
 *    cleans up — they are held in memory for one send and never persisted.
 * 2. The desktop *also* appends its private marker to the message text
 *    (`buildDisplayMessage` in `ui/src/renderer/utils/file/messageFiles.ts`):
 *    `<text>\n\n[[NOMI_FILES]]\n<path>\n<path>`. The backend stores that text
 *    verbatim, so it is the only durable record that a turn had attachments —
 *    without it, reopening the chat (here or on the desktop) shows a bare
 *    message. We emit the same shape and strip it on render, exactly like the
 *    desktop's `parseMessageFileMarker`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  MAX_ATTACHMENTS,
  UploadError,
  uploadFile,
  validateUpload,
  type UploadFailure,
} from '@/features/fs/upload';

/** Private marker shared with the desktop renderer — do not localize. */
export const NOMI_FILES_MARKER = '[[NOMI_FILES]]';

/**
 * Message text plus the attachment manifest the desktop understands.
 * Returns `text` unchanged when there is nothing attached.
 */
export function buildMessageContent(text: string, paths: readonly string[]): string {
  const files = paths.map((path) => path.trim()).filter((path) => path !== '');
  if (files.length === 0) return text;
  return `${text}\n\n${NOMI_FILES_MARKER}\n${files.join('\n')}`;
}

export interface ParsedMessageContent {
  text: string;
  files: string[];
}

/**
 * Split the marker back out of a stored message.
 *
 * Only ever call this for user messages (`position: 'right'`). Assistant text
 * is untrusted: decoding it there would let a model forge attachment chips for
 * files nobody sent — the same reason the desktop gates on position.
 */
export function parseMessageContent(content: string): ParsedMessageContent {
  const at = content.indexOf(NOMI_FILES_MARKER);
  if (at === -1) return { text: content, files: [] };
  const text = content.slice(0, at).trimEnd();
  const rest = content.slice(at + NOMI_FILES_MARKER.length).trim();
  const files = rest
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return { text, files };
}

/** Trailing path component, for chips and error copy. */
export function baseName(path: string): string {
  const parts = path.split(/[/\\]/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? path;
}

// ── Composer state ─────────────────────────────────────────────────

export type AttachmentStatus = 'uploading' | 'ready' | 'error';

export interface Attachment {
  /** Local id; the server path is unknown until the upload lands. */
  id: string;
  name: string;
  size: number;
  status: AttachmentStatus;
  /** Absolute desktop path, once uploaded. */
  path?: string;
  /** Why it failed, for the retry hint. */
  reason?: UploadFailure;
}

/** What a picked file looks like, independent of how it was picked. */
export interface PickedFile {
  name: string;
  size: number;
  blob: Blob;
}

export interface AttachmentsState {
  items: Attachment[];
  /** Paths ready to go into `files`. */
  readyPaths: string[];
  /** An upload is still running — sending now would drop it. */
  uploading: boolean;
  /** Rejected before upload (`null` once acknowledged). */
  rejected: { name: string; reason: UploadFailure } | null;
  add: (files: readonly PickedFile[]) => void;
  remove: (id: string) => void;
  retry: (id: string) => void;
  clear: () => void;
  dismissRejection: () => void;
  /** Free slots left (`MAX_ATTACHMENTS` minus what is already held). */
  remaining: number;
}

let seq = 0;

export interface AttachmentPlan {
  /** Files that fit and passed {@link validateUpload}. */
  accepted: PickedFile[];
  /** The one refusal worth showing, or `null`. */
  rejection: { name: string; reason: UploadFailure } | null;
}

/**
 * Decide what a pick actually adds. Pure, so the cap is testable without a
 * renderer.
 *
 * `held` is how many chips already exist. A file that does not fit is refused
 * as `tooMany` **explicitly**: dropping it quietly is how a fifth image
 * disappears with no explanation, and the user only finds out when the desktop
 * never mentions it.
 *
 * The last refusal wins, and the overflow refusal ends the loop, so the notice
 * always names a file the user can act on.
 */
export function planAttachments(held: number, files: readonly PickedFile[]): AttachmentPlan {
  let room = MAX_ATTACHMENTS - held;
  const accepted: PickedFile[] = [];
  let rejection: { name: string; reason: UploadFailure } | null = null;
  for (const file of files) {
    if (room <= 0) {
      rejection = { name: file.name, reason: 'tooMany' };
      break;
    }
    const reason = validateUpload(file);
    if (reason) {
      rejection = { name: file.name, reason };
      continue;
    }
    accepted.push(file);
    room -= 1;
  }
  return { accepted, rejection };
}

/**
 * Upload-on-pick queue for one conversation.
 *
 * Failures never block a plain-text send: the failed chip stays visible with a
 * retry, and `readyPaths` simply omits it.
 */
export function useAttachments(conversationId: string | undefined): AttachmentsState {
  const [items, setItems] = useState<Attachment[]>([]);
  const [rejected, setRejected] = useState<{ name: string; reason: UploadFailure } | null>(null);
  /** Blobs are kept out of state: they are inert bytes, only needed on retry. */
  const blobs = useRef(new Map<string, Blob>());
  /** Latest items, readable from callbacks without re-creating them. */
  const itemsRef = useRef<Attachment[]>(items);
  itemsRef.current = items;

  // A path uploaded for one conversation belongs to that conversation's temp
  // directory, so switching chats (route reuse, not a fresh mount) drops them.
  useEffect(() => {
    blobs.current.clear();
    setItems([]);
    setRejected(null);
  }, [conversationId]);

  const run = useCallback(
    (id: string, name: string, blob: Blob) => {
      void uploadFile(blob, name, conversationId)
        .then((path) => {
          setItems((prev) =>
            prev.map((item) =>
              item.id === id ? { ...item, status: 'ready', path, reason: undefined } : item,
            ),
          );
        })
        .catch((error: unknown) => {
          const reason = error instanceof UploadError ? error.reason : 'request';
          setItems((prev) =>
            prev.map((item) => (item.id === id ? { ...item, status: 'error', reason } : item)),
          );
        });
    },
    [conversationId],
  );

  const add = useCallback(
    (files: readonly PickedFile[]) => {
      // Side effects (upload kickoff, rejection notice) stay OUT of the state
      // updater: React may invoke an updater twice in development, which would
      // fire every upload twice.
      const { accepted, rejection } = planAttachments(itemsRef.current.length, files);
      const queued: Attachment[] = accepted.map((file) => {
        const id = `att-${++seq}`;
        blobs.current.set(id, file.blob);
        return { id, name: file.name, size: file.size, status: 'uploading' };
      });
      // A previous rejection notice is stale the moment a new pick lands.
      setRejected(rejection);
      if (queued.length === 0) return;
      setItems((prev) => [...prev, ...queued]);
      for (const item of queued) {
        const blob = blobs.current.get(item.id);
        if (blob) run(item.id, item.name, blob);
      }
    },
    [run],
  );

  const remove = useCallback((id: string) => {
    blobs.current.delete(id);
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const retry = useCallback(
    (id: string) => {
      const blob = blobs.current.get(id);
      const target = itemsRef.current.find((item) => item.id === id);
      if (!blob || !target) return;
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status: 'uploading', reason: undefined } : item,
        ),
      );
      run(id, target.name, blob);
    },
    [run],
  );

  const clear = useCallback(() => {
    blobs.current.clear();
    setItems([]);
  }, []);

  return {
    items,
    readyPaths: items
      .filter((item) => item.status === 'ready' && item.path)
      .map((item) => item.path as string),
    uploading: items.some((item) => item.status === 'uploading'),
    rejected,
    add,
    remove,
    retry,
    clear,
    dismissRejection: () => setRejected(null),
    remaining: Math.max(0, MAX_ATTACHMENTS - items.length),
  };
}
