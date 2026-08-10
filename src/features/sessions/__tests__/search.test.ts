/**
 * `src/features/sessions/search.ts` — the global message-search helpers.
 *
 * Two things are worth pinning: the query string (the endpoint is
 * `deny_unknown_fields` over exactly `keyword|page|page_size`, so an extra key
 * is a 400) and the snippet window, because `preview_text` is every string in
 * the message content flattened together and can be kilobytes long — a naive
 * head-of-string preview would hide the very match the user searched for.
 */
import { describe, expect, it } from 'bun:test';

import { SEARCH_PAGE_SIZE, previewSnippet, searchPath } from '@/features/sessions/search';

describe('searchPath', () => {
  it('sends exactly keyword, page and page_size', () => {
    expect(searchPath('rust', 1)).toBe('/api/messages/search?keyword=rust&page=1&page_size=20');
    expect(SEARCH_PAGE_SIZE).toBe(20);
  });

  it('percent-encodes the keyword', () => {
    // The server takes the keyword raw into a LIKE pattern, so `&`, spaces and
    // CJK all have to survive the query string intact.
    expect(searchPath('a b&c', 2)).toBe('/api/messages/search?keyword=a%20b%26c&page=2&page_size=20');
    expect(searchPath('中文', 1)).toContain('keyword=%E4%B8%AD%E6%96%87');
    expect(searchPath("'; DROP TABLE messages; --", 1)).toContain(
      "keyword='%3B%20DROP%20TABLE%20messages%3B%20--",
    );
  });

  it('paginates by page number (the endpoint is offset-based)', () => {
    expect(searchPath('x', 3)).toContain('page=3');
    expect(searchPath('x', 1, 5)).toContain('page_size=5');
  });
});

describe('previewSnippet', () => {
  it('returns short previews unchanged', () => {
    expect(previewSnippet('hello world', 'world')).toBe('hello world');
    expect(previewSnippet('  padded  ', 'padded')).toBe('padded');
  });

  it('centres the window on the match and marks both elisions', () => {
    const preview = `${'a'.repeat(200)} needle ${'b'.repeat(200)}`;
    const snippet = previewSnippet(preview, 'needle', 10);
    expect(snippet).toContain('needle');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThan(40);
  });

  it('matches case-insensitively, like the SQL LIKE that produced the row', () => {
    const preview = `${'x'.repeat(120)}NEEDLE${'y'.repeat(120)}`;
    expect(previewSnippet(preview, 'needle', 8)).toContain('NEEDLE');
  });

  it('falls back to the head when the keyword is not literally present', () => {
    // `%` and `_` reach SQLite unescaped, so a row can match without containing
    // the keyword verbatim.
    const preview = 'z'.repeat(300);
    const snippet = previewSnippet(preview, 'a_c', 10);
    expect(snippet).toBe(`${'z'.repeat(20)}…`);
  });

  it('does not elide the start when the match is at the beginning', () => {
    const snippet = previewSnippet(`needle ${'b'.repeat(300)}`, 'needle', 10);
    expect(snippet.startsWith('needle')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('tolerates an empty keyword without hunting for a match', () => {
    const snippet = previewSnippet('q'.repeat(300), '', 10);
    expect(snippet).toBe(`${'q'.repeat(20)}…`);
  });
});
