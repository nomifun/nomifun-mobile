/**
 * `src/features/sessions/confirmations.ts` — the tool-approval projection.
 *
 * What matters here is that the wire never lies about *which answer was sent*:
 * the nomi agent reads `data.value` and treats anything that is not `"cancel"`
 * as approval, so a normalizer that loses a value (or keeps a label instead)
 * turns a denial into a "yes". These tests lock the two wire shapes, the
 * option-value plumbing, and the discard rules for unusable payloads.
 */
import { describe, expect, it } from 'bun:test';

import {
  choiceFallbackLabel,
  choiceLabelKey,
  confirmBody,
  isAlwaysChoice,
  isDenyChoice,
  isRiskyConfirmation,
  normalizeConfirmation,
  normalizeConfirmations,
} from '@/features/sessions/confirmations';

/** What `GET /confirmations` and the nomi `acp_permission` frame carry. */
const confirmationWire = {
  id: '0190f5fe-7c00-7a00-8abc-012345678901',
  call_id: 'call-42',
  title: 'Execute wants to use: run_shell',
  action: 'run_shell',
  description: 'rm -rf ./build',
  command_type: 'exec',
  options: [
    { label: 'messages.confirmation.yesAllowOnce', value: 'proceed_once', params: null },
    { label: 'messages.confirmation.yesAllowAlways', value: 'proceed_always', params: null },
    { label: 'messages.confirmation.no', value: 'cancel', params: null },
  ],
};

/** What an ACP agent's permission request carries. */
const acpWire = {
  session_id: 'sess-1',
  tool_call: {
    tool_call_id: 'tool-1',
    title: 'Write file',
    kind: 'edit',
    raw_input: { file_path: '/tmp/a.txt', description: 'Create a.txt' },
  },
  options: [
    { option_id: 'allow', name: 'Allow', kind: 'allow_once' },
    { option_id: 'reject', name: 'Reject', kind: 'reject_once' },
  ],
};

describe('normalizeConfirmation — Confirmation wire shape', () => {
  it('keeps call_id, id and every option value', () => {
    const result = normalizeConfirmation(confirmationWire);
    expect(result).not.toBeNull();
    expect(result?.callId).toBe('call-42');
    expect(result?.id).toBe('0190f5fe-7c00-7a00-8abc-012345678901');
    expect(result?.action).toBe('run_shell');
    expect(result?.commandType).toBe('exec');
    expect(result?.description).toBe('rm -rf ./build');
    expect(result?.options.map((o) => o.value)).toEqual([
      'proceed_once',
      'proceed_always',
      'cancel',
    ]);
  });

  it('falls back to call_id when the row has no id', () => {
    const { id: _id, ...withoutId } = confirmationWire;
    expect(normalizeConfirmation(withoutId)?.id).toBe('call-42');
  });

  it('reads the camelCase aliases some payloads use', () => {
    const result = normalizeConfirmation({
      callId: 'call-9',
      commandType: 'edit',
      options: [{ label: 'Go', value: 'go' }],
    });
    expect(result?.callId).toBe('call-9');
    expect(result?.commandType).toBe('edit');
  });

  it('numbers are usable option values, structures are not', () => {
    const result = normalizeConfirmation({
      call_id: 'c',
      options: [
        { label: 'One', value: 1 },
        { label: 'Nested', value: { pick: 'me' } },
        { label: 'Missing' },
        { label: 'Null', value: null },
      ],
    });
    // Only the scalar survives: an option whose value cannot be replayed would
    // be sent as `undefined` and read by the agent as approval.
    expect(result?.options).toEqual([{ value: '1', label: 'One' }]);
  });

  it('labels an option by its value when the label is missing', () => {
    const result = normalizeConfirmation({ call_id: 'c', options: [{ value: 'cancel' }] });
    expect(result?.options[0].label).toBe('cancel');
  });
});

describe('normalizeConfirmation — ACP request wire shape', () => {
  it('projects tool_call/options the way the backend does', () => {
    const result = normalizeConfirmation(acpWire);
    expect(result?.callId).toBe('tool-1');
    // The backend's own `to_confirmation` uses tool_call_id for both fields.
    expect(result?.id).toBe('tool-1');
    expect(result?.title).toBe('Write file');
    expect(result?.commandType).toBe('edit');
    expect(result?.description).toBe('Create a.txt');
    expect(result?.options).toEqual([
      { value: 'allow', label: 'Allow', kind: 'allow_once' },
      { value: 'reject', label: 'Reject', kind: 'reject_once' },
    ]);
  });

  it('uses raw_input.command when there is no description', () => {
    const result = normalizeConfirmation({
      tool_call: { tool_call_id: 't', raw_input: { command: 'ls -al' } },
      options: [],
    });
    expect(result?.description).toBe('ls -al');
  });

  it('drops options with no option_id', () => {
    const result = normalizeConfirmation({
      tool_call: { tool_call_id: 't' },
      options: [{ name: 'Allow' }, { option_id: '', name: 'Empty' }, { optionId: 'ok', name: 'OK' }],
    });
    expect(result?.options).toEqual([{ value: 'ok', label: 'OK', kind: undefined }]);
  });
});

describe('normalizeConfirmation — unusable payloads', () => {
  it('returns null without a call id, because there is nothing to POST to', () => {
    for (const raw of [
      null,
      undefined,
      42,
      'confirmation',
      [],
      {},
      { id: 'only-an-id' },
      { call_id: '   ' },
      { tool_call: { title: 'no id' } },
      { tool_call: 'not-an-object' },
    ]) {
      expect(normalizeConfirmation(raw)).toBeNull();
    }
  });

  it('survives a missing/garbage options array', () => {
    expect(normalizeConfirmation({ call_id: 'c' })?.options).toEqual([]);
    expect(normalizeConfirmation({ call_id: 'c', options: 'nope' })?.options).toEqual([]);
    expect(normalizeConfirmation({ call_id: 'c', options: [null, 3] })?.options).toEqual([]);
  });

  it('trims strings and omits blank fields entirely', () => {
    const result = normalizeConfirmation({
      call_id: '  call-7  ',
      title: '   ',
      description: '  do it  ',
      options: [],
    });
    expect(result?.callId).toBe('call-7');
    expect(result?.title).toBeUndefined();
    expect(result?.description).toBe('do it');
  });
});

describe('normalizeConfirmations', () => {
  it('drops junk entries and de-duplicates by call id', () => {
    const list = normalizeConfirmations([
      confirmationWire,
      { ...confirmationWire, description: 'a later copy' },
      null,
      { no: 'call id' },
      acpWire,
    ]);
    expect(list).toHaveLength(2);
    expect(list[0].description).toBe('rm -rf ./build');
    expect(list[1].callId).toBe('tool-1');
  });

  it('returns an empty list for a non-array body', () => {
    expect(normalizeConfirmations(null)).toEqual([]);
    expect(normalizeConfirmations({ items: [] })).toEqual([]);
  });
});

describe('option semantics', () => {
  it('recognises denial on both platforms', () => {
    expect(isDenyChoice({ value: 'cancel', label: 'No' })).toBe(true);
    expect(isDenyChoice({ value: 'reject', label: 'Reject', kind: 'reject_once' })).toBe(true);
    expect(isDenyChoice({ value: 'r', label: 'Reject', kind: 'reject_always' })).toBe(true);
    expect(isDenyChoice({ value: 'proceed_once', label: 'Yes' })).toBe(false);
    // "Cancel the deployment" is an *action*, not the deny option.
    expect(isDenyChoice({ value: 'cancel_deploy', label: 'Cancel deploy' })).toBe(false);
  });

  it('flags exactly the always-scoped options', () => {
    expect(isAlwaysChoice({ value: 'proceed_always', label: '' })).toBe(true);
    expect(isAlwaysChoice({ value: 'x', label: '', kind: 'allow_always' })).toBe(true);
    expect(isAlwaysChoice({ value: 'proceed_once', label: '' })).toBe(false);
  });

  it('maps the backend label keys onto local copy', () => {
    expect(choiceLabelKey({ value: 'proceed_once', label: '' })).toBe('confirmation.allowOnce');
    expect(choiceLabelKey({ value: 'proceed_always', label: '' })).toBe('confirmation.allowAlways');
    expect(choiceLabelKey({ value: 'cancel', label: '' })).toBe('confirmation.deny');
    expect(choiceLabelKey({ value: 'allow', label: 'Allow' })).toBeUndefined();
  });

  it('never renders a foreign i18n key path as a button label', () => {
    expect(choiceFallbackLabel({ value: 'x', label: 'messages.confirmation.maybe' })).toBe('maybe');
    expect(choiceFallbackLabel({ value: 'x', label: 'Allow this once' })).toBe('Allow this once');
    expect(choiceFallbackLabel({ value: 'x', label: 'a.txt file' })).toBe('a.txt file');
    expect(choiceFallbackLabel({ value: 'fallback', label: '  ' })).toBe('fallback');
  });
});

describe('isRiskyConfirmation', () => {
  it('treats write/exec categories and tool names as destructive', () => {
    expect(isRiskyConfirmation(normalizeConfirmation(confirmationWire)!)).toBe(true);
    expect(isRiskyConfirmation(normalizeConfirmation(acpWire)!)).toBe(true);
    expect(
      isRiskyConfirmation({ id: 'i', callId: 'c', commandType: 'read', options: [] }),
    ).toBe(false);
    expect(
      isRiskyConfirmation({ id: 'i', callId: 'c', action: 'delete_branch', options: [] }),
    ).toBe(true);
  });
});

describe('confirmBody', () => {
  it('sends the option value (not the label) and derives always_allow', () => {
    const confirmation = normalizeConfirmation(confirmationWire)!;
    const [once, always, deny] = confirmation.options;

    expect(confirmBody(confirmation, once)).toEqual({
      msg_id: '0190f5fe-7c00-7a00-8abc-012345678901',
      data: { value: 'proceed_once' },
      always_allow: false,
    });
    expect(confirmBody(confirmation, always)).toEqual({
      msg_id: '0190f5fe-7c00-7a00-8abc-012345678901',
      data: { value: 'proceed_always' },
      always_allow: true,
    });
    // The agent's `is_cancel` check is `data["value"] == "cancel"` — this exact
    // string is the difference between denying and approving.
    expect(confirmBody(confirmation, deny)).toEqual({
      msg_id: '0190f5fe-7c00-7a00-8abc-012345678901',
      data: { value: 'cancel' },
      always_allow: false,
    });
  });

  it('uses the ACP option_id as the value', () => {
    const confirmation = normalizeConfirmation(acpWire)!;
    expect(confirmBody(confirmation, confirmation.options[0])).toEqual({
      msg_id: 'tool-1',
      data: { value: 'allow' },
      always_allow: false,
    });
  });
});
