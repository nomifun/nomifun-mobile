/**
 * SWR hooks for the directory browser.
 *
 * One cache entry per directory (the key is the browse request path), and
 * `keepPreviousData` stays OFF on purpose: while drilling down quickly, showing
 * the previous directory's items under the new path would look like the tap
 * landed somewhere else. A missing directory renders as loading, never as stale
 * content.
 */
import { useCallback } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { SYSTEM_INFO_KEY, browseDirectory, browseKey, systemInfo } from '@/features/fs/api';
import type { BrowseResult, SystemInfo } from '@/features/fs/types';

export interface BrowseState {
  data?: BrowseResult;
  error?: unknown;
  /** First load of this directory (no cached copy to show). */
  isLoading: boolean;
  /** Revalidating a directory we already have — drives pull-to-refresh. */
  isRefreshing: boolean;
  refresh: () => void;
}

/**
 * Browse one directory level. `path === null` fetches nothing (used while the
 * picker sits on its start screen or is closed); `''` is a real request meaning
 * "server default / Windows drive page".
 */
export function useBrowse(path: string | null, showFiles = false): BrowseState {
  const key = path === null ? null : browseKey(path, showFiles);
  const swr = useSWR<BrowseResult>(key, () => browseDirectory(path ?? '', showFiles), {
    revalidateOnFocus: false,
    // A directory listing is cheap but not free, and re-reading it on every
    // re-entry makes back-navigation flicker. Pull-to-refresh is the escape.
    revalidateIfStale: false,
    keepPreviousData: false,
  });

  return {
    data: swr.data,
    error: swr.error,
    isLoading: swr.isLoading,
    isRefreshing: swr.isValidating && swr.data !== undefined,
    refresh: () => {
      void swr.mutate();
    },
  };
}

export interface SystemInfoState {
  info?: SystemInfo;
  isLoading: boolean;
  isRefreshing: boolean;
  refresh: () => void;
}

/**
 * `work_dir` + `platform`. Owner-only and purely decorative here: on failure the
 * workspace shortcut is simply not offered, so the error is swallowed — but the
 * caller can still offer a pull-to-refresh retry.
 */
export function useSystemInfo(enabled = true): SystemInfoState {
  const swr = useSWR<SystemInfo>(enabled ? SYSTEM_INFO_KEY : null, () => systemInfo(), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  });
  return {
    info: swr.data,
    isLoading: swr.isLoading,
    isRefreshing: swr.isValidating,
    refresh: () => {
      void swr.mutate();
    },
  };
}

/**
 * Drop one cached directory listing.
 *
 * Needed after creating a folder: with `revalidateIfStale` off, walking back up
 * would otherwise show the parent's pre-creation listing and the new folder
 * would look like it never happened.
 */
export function useInvalidateBrowse(): (path: string, showFiles?: boolean) => void {
  const { mutate } = useSWRConfig();
  return useCallback(
    (path: string, showFiles = false) => {
      void mutate(browseKey(path, showFiles));
    },
    [mutate],
  );
}
