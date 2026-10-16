/**
 * File picking, web only.
 *
 * A hidden `<input type="file">` is created imperatively rather than rendered
 * into the React tree: react-native-web would need a raw DOM element inside a
 * RN view hierarchy, and a `.web.tsx` sibling would need a Metro cache clear to
 * even resolve (see AGENTS.md). One `Platform.OS` branch keeps both problems
 * away, at the cost of this module being a no-op on native.
 *
 * Native picking is deliberately unimplemented: it needs `expo-image-picker`
 * (a new dependency, photo-library permissions and a native rebuild). The
 * composer shows a "use the desktop or the web app" hint there instead.
 * TODO(native): expo-image-picker + `Photos`/`READ_MEDIA_IMAGES` usage strings.
 */
import { Platform } from 'react-native';

import { IMAGE_ACCEPT, MAX_ATTACHMENTS } from '@/features/fs/upload';

import type { PickedFile } from './attachments';

export const canPickFiles = Platform.OS === 'web';

/**
 * Open the browser file dialog and resolve with what the user chose.
 *
 * Resolves `[]` when the dialog is dismissed — a cancelled pick is not an
 * error. `limit` only decides whether multi-select is offered: **every** chosen
 * file is returned, because trimming here would drop the extras silently. The
 * cap is enforced *and reported* by {@link useAttachments}, which is also the
 * only place that knows how many slots are already taken.
 */
export async function pickImageFiles(limit = MAX_ATTACHMENTS): Promise<PickedFile[]> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return [];

  return new Promise<PickedFile[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMAGE_ACCEPT;
    input.multiple = limit > 1;
    input.style.display = 'none';

    let settled = false;
    const finish = (files: PickedFile[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => {
      const chosen = Array.from(input.files ?? []);
      finish(
        chosen.map((file) => ({
          name: file.name,
          size: file.size,
          blob: file,
        })),
      );
    });
    // Chromium fires `cancel` on dismissal; browsers without it leak one
    // detached input per cancelled dialog, which is why the node is appended
    // (and removed) rather than kept around.
    input.addEventListener('cancel', () => finish([]));

    document.body.appendChild(input);
    input.click();
  });
}
