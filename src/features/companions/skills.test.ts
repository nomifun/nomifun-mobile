/**
 * Unit tests for the skill-draft helpers (`bun test`).
 */
import { describe, expect, it } from 'bun:test';

import { applySkillDecision, decideSkillBody, partitionSkills } from './skills';
import type { CompanionSkill, CompanionSkillPage, SkillStatus } from './types';

const skill = (id: string, status: SkillStatus, createdAt = 0): CompanionSkill => ({
  companion_skill_id: id,
  skill_name: id,
  companion_id: 'c1',
  status,
  source: 'mined',
  confidence: 0.5,
  strength: 1,
  version: 1,
  usage_count: 0,
  last_used_at: null,
  created_at: createdAt,
  updated_at: createdAt,
  description: '',
});

const page = (items: CompanionSkill[]): CompanionSkillPage => ({ items, total: items.length });

describe('partitionSkills', () => {
  it('puts drafts first, newest draft on top', () => {
    const { drafts, settled } = partitionSkills([
      skill('a', 'active', 10),
      skill('d1', 'draft', 20),
      skill('d2', 'draft', 30),
      skill('z', 'archived', 5),
    ]);
    expect(drafts.map((s) => s.companion_skill_id)).toEqual(['d2', 'd1']);
    expect(settled.map((s) => s.companion_skill_id)).toEqual(['a', 'z']);
  });

  it('handles a page with no drafts', () => {
    const { drafts, settled } = partitionSkills([skill('a', 'active')]);
    expect(drafts).toEqual([]);
    expect(settled).toHaveLength(1);
  });
});

describe('applySkillDecision', () => {
  it('accepts a draft into active', () => {
    const next = applySkillDecision(page([skill('d1', 'draft')]), 'd1', true);
    expect(next.items[0]?.status).toBe('active');
  });

  it('rejects a draft into archived', () => {
    const next = applySkillDecision(page([skill('d1', 'draft')]), 'd1', false);
    expect(next.items[0]?.status).toBe('archived');
  });

  it('leaves already-decided rows and other ids untouched', () => {
    const source = page([skill('a', 'active'), skill('d1', 'draft')]);
    const next = applySkillDecision(source, 'a', false);
    expect(next.items[0]?.status).toBe('active');
    expect(next.items[1]?.status).toBe('draft');
    // total is presentation metadata; a decision never changes it
    expect(next.total).toBe(source.total);
  });
});

describe('decideSkillBody', () => {
  it('omits an empty reason', () => {
    expect(decideSkillBody(true)).toEqual({ accept: true });
    expect(decideSkillBody(false, '   ')).toEqual({ accept: false });
  });

  it('trims a provided reason', () => {
    expect(decideSkillBody(false, '  太啰嗦  ')).toEqual({ accept: false, reason: '太啰嗦' });
  });
});
