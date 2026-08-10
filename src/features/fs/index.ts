/**
 * Public surface of the filesystem feature.
 *
 * Other features should import from here (or from the specific module) — the
 * directory picker and `isRiskyWorkspacePath` are the two pieces the
 * project-session screens need.
 */
export {
  FS_BROWSE_PATH,
  FS_DIRECTORY_PATH,
  FsError,
  SYSTEM_INFO_KEY,
  browseDirectory,
  browseKey,
  createDirectory,
  fsErrorMessage,
  resolveDirectory,
  systemInfo,
  type FsErrorContext,
} from '@/features/fs/api';
export { hasEdgeWhitespaceSegment, isRiskyWorkspacePath } from '@/features/fs/risky-path';
export {
  MAX_BROWSE_ITEMS,
  WINDOWS_ROOT_SENTINEL,
  type BrowseEntry,
  type BrowseResult,
  type SystemInfo,
} from '@/features/fs/types';
export {
  useBrowse,
  useInvalidateBrowse,
  useSystemInfo,
  type BrowseState,
  type SystemInfoState,
} from '@/features/fs/hooks';
export {
  DirectoryPicker,
  type DirectoryPickerProps,
} from '@/features/fs/components/directory-picker';
