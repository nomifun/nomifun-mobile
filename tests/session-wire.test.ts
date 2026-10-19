import { describe, expect, it } from 'bun:test';
import { ApiError } from '@/api/types';
import { conversationListResponse, conversationResponse, createdConversationId } from '@/features/sessions/wire';

const row = () => ({
  conversation_id: 'session-a', name: '新会话', type: 'nomi', created_at: 1, modified_at: 2,
  runtime: { state: 'idle', can_send_message: true, is_processing: false, active_turn_id: null, processing_started_at: null },
  extra: { workspace: '/desktop/project', is_temporary_workspace: false },
});

describe('session projections at the HTTP boundary', () => {
  it('accepts canonical nullable runtime fields and retains additive server fields', () => {
    const value = { ...row(), session_purpose: 'conversation', future_metadata: { version: 3 } };
    expect(conversationResponse(value)).toBe(value);
    expect(conversationListResponse({ items: [value], total: 1, has_more: false }).items).toEqual([value]);
    expect(conversationListResponse({ items: [], total: 0, has_more: false }).items).toEqual([]);
  });

  it('rejects missing/wrong list payloads instead of silently rendering no sessions', () => {
    for (const value of [undefined, null, [], {}, { success: true }, { items: {}, total: 1, has_more: false },
      { items: [], total: '0', has_more: false }, { items: [], total: 0, has_more: 'false' },
      { items: [], total: 1, has_more: true }, { items: [row()], total: 0, has_more: false },
      { items: [row(), row()], total: 2, has_more: false }]) {
      let failure: unknown;
      try { conversationListResponse(value); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).code).toBe('INVALID_API_RESPONSE');
    }
  });

  it('rejects malformed row identity, timestamps and display fields on list and detail reads', () => {
    const invalidRows = [
      { ...row(), conversation_id: '' }, { ...row(), name: null }, { ...row(), type: {} },
      { ...row(), created_at: '1' }, { ...row(), modified_at: Number.NaN },
      { ...row(), runtime: { is_processing: 'false' } }, { ...row(), model: [] },
      { ...row(), model: { use_model: 12 } }, { ...row(), extra: { workspace: [] } },
    ];
    for (const value of invalidRows) {
      expect(() => conversationResponse(value)).toThrow(ApiError);
      expect(() => conversationListResponse({ items: [value], total: 1, has_more: false })).toThrow(ApiError);
    }
  });

  it('requires the canonical creation receipt identity', () => {
    expect(createdConversationId({ agent_session_id: 'canonical-session' })).toBe('canonical-session');
    for (const value of [{}, null, { conversation_id: 'presentation-alias' }, { agent_session_id: ' ' }]) {
      expect(() => createdConversationId(value)).toThrow(ApiError);
    }
  });

  it('rejects a valid detail projection belonging to a different requested session', () => {
    expect(() => conversationResponse(row(), 'conversation', 'session-b')).toThrow(ApiError);
  });
});
