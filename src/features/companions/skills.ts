/**
 * Pure helpers for a companion's self-evolved skills.
 *
 * Draft approval (`POST …/skills/{companion_skill_id}/decide`) is the one
 * genuine "waiting on you" inbox in this feature, so drafts are pulled to the
 * front of the list instead of being buried after the active skills.
 *
 * The server semantics `applySkillDecision` mirrors locally (service.rs
 * `decide_companion_skill`): accept → `active`, reject → `archived` plus a
 * recorded rejection that suppresses the mined pattern from being proposed
 * again. Deciding a row that is no longer a draft is a no-op on both sides.
 *
 * No React, no I/O.
 */
import type { CompanionSkill, CompanionSkillPage } from './types';

/** Newest first — a review queue reads best with the freshest draft on top. */
function byNewest(a: CompanionSkill, b: CompanionSkill): number {
  return b.created_at - a.created_at;
}

/**
 * Split a skill page into the review queue and everything already decided.
 * `settled` keeps the server's ordering (active before archived by status
 * query, catalog order within it).
 */
export function partitionSkills(items: readonly CompanionSkill[]): {
  drafts: CompanionSkill[];
  settled: CompanionSkill[];
} {
  const drafts = items.filter((skill) => skill.status === 'draft').sort(byNewest);
  const settled = items.filter((skill) => skill.status !== 'draft');
  return { drafts, settled };
}

/**
 * Optimistic local patch of one decision. Only a `draft` row moves — the server
 * returns a non-draft row unchanged, so the UI must not either.
 */
export function applySkillDecision(
  page: CompanionSkillPage,
  companionSkillId: string,
  accept: boolean,
): CompanionSkillPage {
  return {
    ...page,
    items: page.items.map((skill) =>
      skill.companion_skill_id === companionSkillId && skill.status === 'draft'
        ? { ...skill, status: accept ? 'active' : 'archived' }
        : skill,
    ),
  };
}

/** Body for the decide call: `reason` is omitted unless the user typed one. */
export function decideSkillBody(
  accept: boolean,
  reason?: string,
): { accept: boolean; reason?: string } {
  const trimmed = reason?.trim();
  return trimmed ? { accept, reason: trimmed } : { accept };
}
