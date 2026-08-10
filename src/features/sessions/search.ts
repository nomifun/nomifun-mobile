/**
 * Global message search — `GET /api/messages/search?keyword=&page=&page_size=`.
 *
 * Contract facts that shape this module:
 *
 * - `SearchMessagesQuery` is `deny_unknown_fields` with exactly
 *   `keyword | page | page_size`. There is **no `conversation_id`**, so
 *   "search inside this chat" is not offered anywhere — the endpoint cannot do
 *   it, and faking it client-side would silently miss older pages.
 * - An empty/whitespace keyword is a 400 (`keyword must not be empty`), so the
 *   caller must not fire on an empty box.
 * - The query is `content LIKE '%keyword%'` over *every* message row (offset
 *   paging, `ORDER BY created_at DESC`) and `preview_text` is every string in
 *   the content JSON flattened together. That means: results include thinking /
 *   tool rows, previews can be long, and a big `page_size` is a full-table scan
 *   plus a lot of JSON — 20 stays.
 * - `%` and `_` in the keyword reach SQLite's LIKE unescaped; they behave as
 *   wildcards. Harmless here, but it explains "why did `a_b` match `axb`".
 */
import { useEffect, useMemo, useState } from 'react';
import useSWRInfinite from 'swr/infinite';

import type { Conversation, Paginated } from './api';

export const SEARCH_PAGE_SIZE = 20;

export interface MessageSearchItem {
  message_id: string;
  /** Row type: `text`, `thinking`, `tool_call`, … — not just chat text. */
  message_type: string;
  message_created_at: number;
  /** All strings in the message content, flattened and whitespace-normalized. */
  preview_text: string;
  conversation: Conversation;
}

/** SWR key === the request path. */
export function searchPath(keyword: string, page: number, pageSize = SEARCH_PAGE_SIZE): string {
  return (
    `/api/messages/search?keyword=${encodeURIComponent(keyword)}` +
    `&page=${page}&page_size=${pageSize}`
  );
}

/**
 * Window of `preview_text` around the first match, so a 4 KB flattened tool
 * payload does not push the hit off screen. Falls back to the head of the text
 * when the keyword is not literally present (LIKE wildcards, case folding).
 */
export function previewSnippet(preview: string, keyword: string, radius = 48): string {
  const text = preview.trim();
  const needle = keyword.trim();
  const limit = radius * 2;
  if (text.length <= limit) return text;
  const at = needle === '' ? -1 : text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return `${text.slice(0, limit).trimEnd()}…`;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + needle.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** Trailing-edge debounce, so typing does not fire a scan per keystroke. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

export interface MessageSearchState {
  items: MessageSearchItem[];
  total: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshing: boolean;
  hasMore: boolean;
  error: unknown;
  loadMore: () => void;
  refresh: () => Promise<unknown>;
  retry: () => void;
}

/**
 * Paged search results for an already-debounced keyword. An empty keyword
 * keeps the SWR key `null`, so nothing is requested and nothing is cached.
 */
export function useMessageSearch(keyword: string): MessageSearchState {
  const query = keyword.trim();

  const getKey = (index: number, previous: Paginated<MessageSearchItem> | null) => {
    if (query === '') return null;
    if (index > 0 && (!previous || !previous.has_more)) return null;
    return searchPath(query, index + 1);
  };

  const { data, error, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite<
    Paginated<MessageSearchItem>
  >(getKey, {
    revalidateFirstPage: false,
    parallel: false,
    // Results are a point-in-time scan; re-running it on every focus is a
    // full-table LIKE for no new information.
    revalidateOnFocus: false,
  });

  const [refreshing, setRefreshing] = useState(false);

  // Flattened once per page change: a fresh array on every render would give
  // FlatList a new `data` identity and re-render the whole result list.
  const items = useMemo(() => {
    const out: MessageSearchItem[] = [];
    const seen = new Set<string>();
    for (const page of data ?? []) {
      for (const row of page?.items ?? []) {
        if (seen.has(row.message_id)) continue;
        seen.add(row.message_id);
        out.push(row);
      }
    }
    return out;
  }, [data]);

  const lastPage = data && data.length > 0 ? data[data.length - 1] : undefined;
  const isLoadingMore = size > 0 && !!data && data.length === size && data[size - 1] === undefined;

  return {
    items,
    total: data?.[0]?.total ?? 0,
    isLoading: query !== '' && isLoading && !data,
    isLoadingMore: isLoadingMore || (isValidating && !!data && data.length < size),
    isRefreshing: refreshing,
    hasMore: lastPage?.has_more === true,
    error,
    loadMore: () => {
      if (lastPage?.has_more && !isLoadingMore) void setSize(size + 1);
    },
    refresh: async () => {
      setRefreshing(true);
      try {
        await setSize(1);
        return await mutate();
      } finally {
        setRefreshing(false);
      }
    },
    retry: () => void mutate(),
  };
}
