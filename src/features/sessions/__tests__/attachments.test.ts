/**
 * Composer attachments: the upload policy (`src/features/fs/upload.ts`) and the
 * `[[NOMI_FILES]]` marker (`src/features/sessions/attachments.ts`).
 *
 * Both are guardrails against server-side hard errors, so the tests pin the
 * *refusals* as tightly as the happy path:
 *
 * - the agent's `classify_extension` kills a whole turn on HEIC (the iPhone
 *   default) — it has to be refused before the upload;
 * - the effective per-image ceiling is 12 MiB (`MAX_SOURCE_BYTES`), not the
 *   30 MiB request-body cap;
 * - the marker is only decoded on user text, because doing it on model output
 *   would let a model forge attachment chips for files nobody sent.
 */
import * as bunTest from 'bun:test';
import { describe, expect, it } from 'bun:test';

/**
 * `src/features/fs/upload.ts` reaches `@/api/client`, which imports
 * `react-native` — Flow syntax that the Bun runner cannot parse. Stubbing the
 * module keeps the pure policy testable without a transport in the loop.
 * Cast rather than `declare module`: augmenting `tests/bun-test.d.ts` from here
 * would collide the day `mock` is declared there properly.
 */
const mockModule = (
  bunTest as unknown as {
    mock: { module: (specifier: string, factory: () => unknown) => void };
  }
).mock.module;

mockModule('react-native', () => ({
  Platform: { OS: 'web', select: (map: Record<string, unknown>) => map.web ?? map.default },
}));

type UploadModule = typeof import('@/features/fs/upload');
type AttachmentsModule = typeof import('@/features/sessions/attachments');

const loadUpload = (): Promise<UploadModule> => import('@/features/fs/upload');
const loadAttachments = (): Promise<AttachmentsModule> =>
  import('@/features/sessions/attachments');

describe('sanitizeFileName', () => {
  it('keeps only the last path component', async () => {
    const { sanitizeFileName } = await loadUpload();
    expect(sanitizeFileName('photo.png')).toBe('photo.png');
    expect(sanitizeFileName('  photo.png  ')).toBe('photo.png');
    expect(sanitizeFileName('/tmp/a/b/photo.png')).toBe('photo.png');
    expect(sanitizeFileName('C:\\Users\\me\\photo.png')).toBe('photo.png');
  });

  it('refuses names that are only traversal or whitespace', async () => {
    const { sanitizeFileName } = await loadUpload();
    for (const raw of ['', '   ', '.', '..', '/', '\\', '/tmp/']) {
      expect(sanitizeFileName(raw)).toBe('');
    }
  });
});

describe('fileExtension', () => {
  it('lowercases and drops the dot', async () => {
    const { fileExtension } = await loadUpload();
    expect(fileExtension('photo.PNG')).toBe('png');
    expect(fileExtension('archive.tar.gz')).toBe('gz');
    expect(fileExtension('/tmp/a.b/photo.JPEG')).toBe('jpeg');
  });

  it('has no extension for dotfiles or trailing dots', async () => {
    const { fileExtension } = await loadUpload();
    expect(fileExtension('README')).toBe('');
    expect(fileExtension('.gitignore')).toBe('');
    expect(fileExtension('photo.')).toBe('');
  });
});

describe('validateUpload — extensions', () => {
  it('accepts exactly what the agent can embed', async () => {
    const { validateUpload, SUPPORTED_IMAGE_EXTENSIONS } = await loadUpload();
    expect([...SUPPORTED_IMAGE_EXTENSIONS]).toEqual(['png', 'jpg', 'jpeg', 'webp']);
    for (const ext of SUPPORTED_IMAGE_EXTENSIONS) {
      expect(validateUpload({ name: `shot.${ext}`, size: 1024 })).toBeNull();
      expect(validateUpload({ name: `shot.${ext.toUpperCase()}`, size: 1024 })).toBeNull();
    }
  });

  it('refuses HEIC and the other image formats the agent hard-errors on', async () => {
    const { validateUpload, REJECTED_IMAGE_EXTENSIONS } = await loadUpload();
    // HEIC/HEIF are the ones that actually matter: they are the iPhone default
    // and reach `classify_extension` as an explicit turn-killing error.
    expect([...REJECTED_IMAGE_EXTENSIONS]).toContain('heic');
    expect([...REJECTED_IMAGE_EXTENSIONS]).toContain('heif');
    for (const ext of REJECTED_IMAGE_EXTENSIONS) {
      expect(validateUpload({ name: `photo.${ext}`, size: 1024 })).toBe('unsupportedImage');
    }
    expect(validateUpload({ name: 'IMG_0001.HEIC', size: 1024 })).toBe('unsupportedImage');
  });

  it('separates "wrong image format" from "not an image"', async () => {
    const { validateUpload } = await loadUpload();
    expect(validateUpload({ name: 'notes.pdf', size: 1024 })).toBe('notImage');
    expect(validateUpload({ name: 'main.rs', size: 1024 })).toBe('notImage');
    expect(validateUpload({ name: 'README', size: 1024 })).toBe('notImage');
  });

  it('reports an unusable name before anything else', async () => {
    const { validateUpload } = await loadUpload();
    expect(validateUpload({ name: '   ', size: 1024 })).toBe('name');
    expect(validateUpload({ name: '..', size: 1024 })).toBe('name');
  });

  it('classifies format before size, because converting is the fix', async () => {
    const { validateUpload } = await loadUpload();
    expect(validateUpload({ name: 'huge.heic', size: 40 * 1024 * 1024 })).toBe('unsupportedImage');
  });
});

describe('validateUpload — size', () => {
  it('enforces the 12 MiB per-image ceiling, not the 30 MiB body cap', async () => {
    const { validateUpload, IMAGE_MAX_BYTES, UPLOAD_MAX_BYTES } = await loadUpload();
    expect(IMAGE_MAX_BYTES).toBe(12 * 1024 * 1024);
    expect(UPLOAD_MAX_BYTES).toBe(30 * 1024 * 1024);

    expect(validateUpload({ name: 'a.png', size: IMAGE_MAX_BYTES })).toBeNull();
    expect(validateUpload({ name: 'a.png', size: IMAGE_MAX_BYTES + 1 })).toBe('tooLarge');
    // Well under the request-body cap, still refused by the agent's image path.
    expect(validateUpload({ name: 'a.png', size: 20 * 1024 * 1024 })).toBe('tooLarge');
  });

  it('refuses empty and nonsensical sizes', async () => {
    const { validateUpload } = await loadUpload();
    expect(validateUpload({ name: 'a.png', size: 0 })).toBe('empty');
    expect(validateUpload({ name: 'a.png', size: -1 })).toBe('empty');
    expect(validateUpload({ name: 'a.png', size: Number.NaN })).toBe('empty');
    expect(validateUpload({ name: 'a.png', size: 1 })).toBeNull();
  });

  it('caps attachments at the agent MAX_IMAGE_ATTACHMENTS limit', async () => {
    const { MAX_ATTACHMENTS } = await loadUpload();
    expect(MAX_ATTACHMENTS).toBe(4);
  });
});

describe('buildMessageContent', () => {
  it('leaves text alone when nothing is attached', async () => {
    const { buildMessageContent } = await loadAttachments();
    expect(buildMessageContent('hello', [])).toBe('hello');
  });

  it('appends the desktop marker followed by one path per line', async () => {
    const { buildMessageContent, NOMI_FILES_MARKER } = await loadAttachments();
    const content = buildMessageContent('look', ['/tmp/nomifun/a.png', '/tmp/nomifun/b.png']);
    expect(content).toBe(`look\n\n${NOMI_FILES_MARKER}\n/tmp/nomifun/a.png\n/tmp/nomifun/b.png`);
  });

  it('drops blank paths and still marks an attachment-only turn', async () => {
    const { buildMessageContent, NOMI_FILES_MARKER } = await loadAttachments();
    expect(buildMessageContent('x', ['', '  '])).toBe('x');
    expect(buildMessageContent('', ['/tmp/a.png'])).toBe(`\n\n${NOMI_FILES_MARKER}\n/tmp/a.png`);
  });
});

describe('parseMessageContent', () => {
  it('round-trips what buildMessageContent produced', async () => {
    const { buildMessageContent, parseMessageContent } = await loadAttachments();
    const paths = ['/tmp/nomifun/a.png', '/tmp/nomifun/b.png'];
    const parsed = parseMessageContent(buildMessageContent('look at these', paths));
    expect(parsed.text).toBe('look at these');
    expect(parsed.files).toEqual(paths);
  });

  it('returns the text untouched when there is no marker', async () => {
    const { parseMessageContent } = await loadAttachments();
    expect(parseMessageContent('just words')).toEqual({ text: 'just words', files: [] });
  });

  it('tolerates a marker with no paths, and trims stray whitespace', async () => {
    const { parseMessageContent, NOMI_FILES_MARKER } = await loadAttachments();
    expect(parseMessageContent(`hi\n\n${NOMI_FILES_MARKER}\n`)).toEqual({
      text: 'hi',
      files: [],
    });
    expect(
      parseMessageContent(`hi\n\n${NOMI_FILES_MARKER}\n  /tmp/a.png  \n\n/tmp/b.png\n`).files,
    ).toEqual(['/tmp/a.png', '/tmp/b.png']);
  });

  it('handles an attachment-only message (empty text)', async () => {
    const { parseMessageContent, NOMI_FILES_MARKER } = await loadAttachments();
    expect(parseMessageContent(`${NOMI_FILES_MARKER}\n/tmp/a.png`)).toEqual({
      text: '',
      files: ['/tmp/a.png'],
    });
  });
});

describe('baseName', () => {
  it('shows the file name for both path flavours', async () => {
    const { baseName } = await loadAttachments();
    expect(baseName('/tmp/nomifun/conv-1/shot.png')).toBe('shot.png');
    expect(baseName('C:\\Temp\\nomifun\\shot.png')).toBe('shot.png');
    expect(baseName('shot.png')).toBe('shot.png');
    expect(baseName('')).toBe('');
  });
});

describe('planAttachments', () => {
  /** `PickedFile` needs a Blob; only `.size`/`.name` are ever read here. */
  const pick = (name: string, size = 1024) =>
    ({ name, size, blob: { size } as Blob }) as import('@/features/sessions/attachments').PickedFile;

  it('accepts everything that fits', async () => {
    const { planAttachments } = await loadAttachments();
    const plan = planAttachments(0, [pick('a.png'), pick('b.jpg')]);
    expect(plan.accepted.map((f) => f.name)).toEqual(['a.png', 'b.jpg']);
    expect(plan.rejection).toBeNull();
  });

  it('counts the chips already held', async () => {
    const { planAttachments } = await loadAttachments();
    const plan = planAttachments(3, [pick('a.png'), pick('b.png')]);
    expect(plan.accepted.map((f) => f.name)).toEqual(['a.png']);
    expect(plan.rejection).toEqual({ name: 'b.png', reason: 'tooMany' });
  });

  it('names the overflowing file instead of dropping it silently', async () => {
    const { planAttachments } = await loadAttachments();
    const five = ['a', 'b', 'c', 'd', 'e'].map((n) => pick(`${n}.png`));
    const plan = planAttachments(0, five);
    expect(plan.accepted).toHaveLength(4);
    // The fifth image is refused *out loud*: the agent fails the whole turn on
    // a fifth attachment, so a quiet drop would be a message the user never
    // knows was incomplete.
    expect(plan.rejection).toEqual({ name: 'e.png', reason: 'tooMany' });
  });

  it('still reports per-file refusals, and they do not consume a slot', async () => {
    const { planAttachments } = await loadAttachments();
    const plan = planAttachments(0, [pick('photo.heic'), pick('a.png'), pick('doc.pdf')]);
    expect(plan.accepted.map((f) => f.name)).toEqual(['a.png']);
    expect(plan.rejection).toEqual({ name: 'doc.pdf', reason: 'notImage' });
  });

  it('refuses on capacity before validating, so a full box says "too many"', async () => {
    const { planAttachments } = await loadAttachments();
    const plan = planAttachments(4, [pick('photo.heic')]);
    expect(plan.accepted).toEqual([]);
    expect(plan.rejection).toEqual({ name: 'photo.heic', reason: 'tooMany' });
  });
});
